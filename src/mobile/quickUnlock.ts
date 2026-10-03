// ============================================================================
// SECURITY-CRITICAL MODULE — fingerprint & PIN quick unlock (Android).
//
// Both methods store a WRAPPED copy of the raw vault key in app-private storage:
//
//   Fingerprint:  rawKey ─AES-GCM(Keystore key, requires strong biometric)→ quick_bio.json
//
//   PIN:          rawKey ─AES-GCM(Argon2id(PIN, salt))→ inner
//                 inner  ─AES-GCM(Keystore device key, non-exportable)→ quick_pin.json
//
// The device-key layer means the 4-digit PIN cannot be brute-forced offline on
// another machine: every guess must go through this phone's Keystore. Inside the
// app, the attempt counter is incremented BEFORE each try and PIN unlock is
// erased after MAX_PIN_ATTEMPTS failures (master password required).
//
// Enrolling always requires the master password. Changing the master password,
// restoring a backup or creating a vault erases all quick-unlock data.
// ============================================================================

import { MAX_PIN_ATTEMPTS, type QuickUnlockStatus } from '../shared/api';
import { ValidationError } from '../core/schema';
import { CryptoError, deriveKey, fromB64, newKdfParams, openBytes, sealBytes, toB64, wipe, type KdfParams } from '../core/crypto';
import { AppError, type VaultCore } from '../core/vault';
import type { NativeVault } from './native';

const BIO_FILE = 'quick_bio.json';
const PIN_FILE = 'quick_pin.json';

interface PinRecord {
  v: 1;
  kdf: { memoryKiB: number; iterations: number; parallelism: number; salt: string };
  iv: string;
  data: string;
  attempts: number;
}

function nativeCode(e: unknown): string {
  return typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
}

export class QuickUnlock {
  constructor(
    private readonly native: NativeVault,
    private readonly vault: VaultCore
  ) {}

  private async readJson<T>(name: string): Promise<T | null> {
    try {
      const raw = await this.native.read(name);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async status(): Promise<QuickUnlockStatus> {
    let hw = { available: false, biometric: false, deviceCredential: false };
    try {
      hw = await this.native.biometricStatus();
    } catch {
      /* ignore */
    }
    const pin = await this.readJson<PinRecord>(PIN_FILE);
    const bio = await this.readJson<{ dc?: boolean }>(BIO_FILE);
    return {
      supported: true,
      biometricAvailable: hw.available,
      deviceCredentialAvailable: hw.deviceCredential,
      biometric: bio !== null,
      // Keys enrolled before v1.0.19 accept biometrics only.
      deviceCredential: bio !== null && bio.dc === true && hw.deviceCredential,
      pin: pin !== null,
      pinAttemptsLeft: pin ? Math.max(0, MAX_PIN_ATTEMPTS - (pin.attempts ?? 0)) : 0
    };
  }

  // ------------------------------------------------------------ fingerprint --

  async enableBiometric(masterPassword: string): Promise<void> {
    const hw = await this.native.biometricStatus().catch(() => ({ available: false, deviceCredential: false }));
    if (!hw.available) {
      throw new AppError('NO_BIOMETRIC', 'No fingerprint, face or screen lock is set up on this phone. Add one in Android Settings first.');
    }
    const raw = await this.vault.rawKeyForEnrollment(masterPassword);
    try {
      const sealed = await this.native.bioEncrypt(toB64(raw));
      await this.native.writeAtomic(BIO_FILE, JSON.stringify({ v: 1, iv: sealed.iv, data: sealed.data, dc: hw.deviceCredential }));
    } catch (e) {
      if (nativeCode(e) === 'CANCELED') throw new AppError('CANCELED', 'Quick unlock setup was canceled.');
      throw new AppError('BIOMETRIC_FAILED', 'Could not turn on face / fingerprint unlock.');
    } finally {
      wipe(raw);
    }
  }

  async unlockBiometric(mode: 'biometric' | 'credential' = 'biometric'): Promise<void> {
    const rec = await this.readJson<{ iv: string; data: string; dc?: boolean }>(BIO_FILE);
    if (!rec) throw new AppError('NOT_ENABLED', 'Face / fingerprint unlock is not enabled.');
    if (mode === 'credential' && rec.dc !== true) {
      throw new AppError('NOT_ENABLED', 'Turn quick unlock off and on again in Settings to use the device passcode.');
    }
    let rawB64: string;
    try {
      rawB64 = await this.native.bioDecrypt(rec.iv, rec.data, rec.dc === true ? mode : 'biometric');
    } catch (e) {
      const code = nativeCode(e);
      if (code === 'CANCELED') throw new AppError('CANCELED', 'Unlock canceled.');
      if (code === 'NOT_VISIBLE') throw new AppError('NOT_VISIBLE', 'Open the app to unlock.');
      if (code === 'INVALIDATED') {
        await this.disableBiometric();
        throw new AppError('INVALIDATED', 'Fingerprints or the screen lock on this phone changed, so quick unlock was turned off. Use your master password.');
      }
      throw new AppError('BIOMETRIC_FAILED', 'Not recognized. Try again or use your master password.');
    }
    try {
      await this.vault.unlockWithRawKey(fromB64(rawB64));
    } catch (e) {
      if (e instanceof AppError && e.code === 'QUICK_STALE') await this.disableAll();
      throw e;
    }
  }

  async disableBiometric(): Promise<void> {
    await this.native.remove(BIO_FILE);
    await this.native.resetKey('biometric').catch(() => undefined);
  }

  // -------------------------------------------------------------------- PIN --

  private static validPin(pin: unknown): string {
    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw new ValidationError('pin', 'Enter exactly 4 digits.');
    return pin;
  }

  private static pinKdf(rec: PinRecord): KdfParams {
    return { name: 'argon2id', memoryKiB: rec.kdf.memoryKiB, iterations: rec.kdf.iterations, parallelism: rec.kdf.parallelism, salt: fromB64(rec.kdf.salt, 128) };
  }

  async enablePin(masterPassword: string, pin: string): Promise<void> {
    const p = QuickUnlock.validPin(pin);
    if (/^(\d)\1{3}$/.test(p) || ['1234', '4321', '0123', '1212', '2580', '1111', '0000'].includes(p)) {
      throw new ValidationError('pin', 'This PIN is too easy to guess. Choose another.');
    }
    const raw = await this.vault.rawKeyForEnrollment(masterPassword);
    try {
      const kdf = newKdfParams();
      const pinKey = await deriveKey(p, kdf);
      const inner = await sealBytes(pinKey, raw);
      const outer = await this.native.deviceEncrypt(toB64(inner));
      const rec: PinRecord = {
        v: 1,
        kdf: { memoryKiB: kdf.memoryKiB, iterations: kdf.iterations, parallelism: kdf.parallelism, salt: toB64(kdf.salt) },
        iv: outer.iv,
        data: outer.data,
        attempts: 0
      };
      await this.native.writeAtomic(PIN_FILE, JSON.stringify(rec));
    } catch (e) {
      if (e instanceof ValidationError || e instanceof AppError) throw e;
      throw new AppError('PIN_FAILED', 'Could not enable PIN unlock.');
    } finally {
      wipe(raw);
    }
  }

  async unlockPin(pin: string): Promise<void> {
    const p = QuickUnlock.validPin(pin);
    const rec = await this.readJson<PinRecord>(PIN_FILE);
    if (!rec) throw new AppError('NOT_ENABLED', 'PIN unlock is not enabled.');
    if ((rec.attempts ?? 0) >= MAX_PIN_ATTEMPTS) {
      await this.disablePin();
      throw new AppError('PIN_LOCKED', 'Too many wrong PINs. PIN unlock was turned off — use your master password.');
    }
    // Count the attempt BEFORE trying, so killing the app mid-attempt can't bypass the limit.
    rec.attempts = (rec.attempts ?? 0) + 1;
    await this.native.writeAtomic(PIN_FILE, JSON.stringify(rec));

    let raw: Uint8Array;
    try {
      const inner = fromB64(await this.native.deviceDecrypt(rec.iv, rec.data));
      raw = await openBytes(await deriveKey(p, QuickUnlock.pinKdf(rec)), inner);
    } catch (e) {
      if (nativeCode(e) === 'INVALIDATED') {
        await this.disablePin();
        throw new AppError('INVALIDATED', 'PIN unlock is no longer valid on this phone. Use your master password.');
      }
      if (!(e instanceof CryptoError)) throw new AppError('PIN_FAILED', 'PIN unlock failed. Use your master password.');
      const left = MAX_PIN_ATTEMPTS - rec.attempts;
      if (left <= 0) {
        await this.disablePin();
        throw new AppError('PIN_LOCKED', 'Too many wrong PINs. PIN unlock was turned off — use your master password.');
      }
      throw new AppError('WRONG_PIN', `Wrong PIN. ${left} attempt${left === 1 ? '' : 's'} left.`);
    }
    try {
      await this.vault.unlockWithRawKey(raw);
    } catch (e) {
      if (e instanceof AppError && e.code === 'QUICK_STALE') await this.disableAll();
      throw e;
    }
    rec.attempts = 0;
    await this.native.writeAtomic(PIN_FILE, JSON.stringify(rec));
  }

  async disablePin(): Promise<void> {
    await this.native.remove(PIN_FILE);
  }

  async disableAll(): Promise<void> {
    await this.disableBiometric().catch(() => undefined);
    await this.disablePin().catch(() => undefined);
  }
}
