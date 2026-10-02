// Tests for the Android vault implementation (runs on Node using the same
// WebCrypto + hash-wasm code the Android WebView uses), including full
// cross-compatibility of vault and backup files between desktop and phone.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFile } from '../src/mobile/crypto';
import { AppError, MobileVault, VAULT_FILE } from '../src/mobile/mobileVault';
import type { NativeVault } from '../src/mobile/native';
import { QuickUnlock } from '../src/mobile/quickUnlock';
import { BackupService } from '../src/main/vault/backupService';
import { VaultService } from '../src/main/vault/vaultService';

const PW = 'Phone-Master-Password-2026!';
const SECRET = 'm0bile-S3cret-✓-密码';

type Fake = NativeVault & {
  files: Map<string, string>;
  clipboard: string;
  failNextWrite: boolean;
  /** Next fingerprint prompt result. */
  bio: 'ok' | 'cancel' | 'invalidated';
  hasBiometric: boolean;
  keys: Map<string, CryptoKey>;
};

// Simulated Android Keystore: real AES-GCM keys that never leave this object.
async function ksEncrypt(self: Fake, alias: string, b64: string) {
  if (!self.keys.has(alias)) self.keys.set(alias, await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, self.keys.get(alias)!, Buffer.from(b64, 'base64'));
  return { iv: Buffer.from(iv).toString('base64'), data: Buffer.from(ct).toString('base64') };
}
async function ksDecrypt(self: Fake, alias: string, iv: string, b64: string) {
  const key = self.keys.get(alias);
  if (!key) throw Object.assign(new Error('missing'), { code: 'INVALIDATED' });
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(b64, 'base64'));
  return Buffer.from(pt).toString('base64');
}
function bioGate(self: Fake) {
  if (self.bio === 'cancel') throw Object.assign(new Error('c'), { code: 'CANCELED' });
  if (self.bio === 'invalidated') {
    self.keys.delete('bio');
    throw Object.assign(new Error('i'), { code: 'INVALIDATED' });
  }
}

function memoryNative() {
  const files = new Map<string, string>();
  const self: Fake = {
    files,
    clipboard: '',
    failNextWrite: false,
    bio: 'ok',
    hasBiometric: true,
    keys: new Map(),
    biometricAvailable: async () => self.hasBiometric,
    bioEncrypt: async (d) => {
      bioGate(self);
      return ksEncrypt(self, 'bio', d);
    },
    bioDecrypt: async (iv, d) => {
      bioGate(self);
      return ksDecrypt(self, 'bio', iv, d);
    },
    deviceEncrypt: (d) => ksEncrypt(self, 'device', d),
    deviceDecrypt: (iv, d) => ksDecrypt(self, 'device', iv, d),
    resetKey: async (k) => void self.keys.delete(k === 'biometric' ? 'bio' : 'device'),
    readClipboard: async () => self.clipboard,
    takeSharedText: async () => null,
    read: async (n) => files.get(n) ?? null,
    writeAtomic: async (n, d) => {
      if (self.failNextWrite) {
        self.failNextWrite = false;
        throw new Error('disk full');
      }
      files.set(n, d);
    },
    remove: async (n) => void files.delete(n),
    stat: async (n) => (files.has(n) ? { size: files.get(n)!.length, mtime: Date.now() } : null),
    writeExport: async (n, d) => {
      files.set(`exports/${n}`, d);
      return `file:///cache/exports/${n}`;
    },
    clearExports: async () => undefined,
    copySecret: async (t) => void (self.clipboard = t),
    clearClipboard: async () => void (self.clipboard = '')
  };
  return self;
}

async function phoneWithItem() {
  const native = memoryNative();
  const v = new MobileVault(native);
  await v.create(PW, 'phone hint');
  const e = await v.saveEntry({
    categoryId: 'banking',
    title: 'Phone Bank',
    fields: { bankName: 'BDO', password: SECRET, pin: '9876', accountNumber: '9999 8888 7777' },
    tags: ['bank'],
    favorite: true
  });
  return { native, v, e };
}

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-mobile-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('mobile vault', () => {
  it('creates, locks, unlocks; wrong password rejected generically', async () => {
    const { v } = await phoneWithItem();
    v.lock();
    await expect(v.unlock('wrong')).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
    await v.unlock(PW);
    expect(v.snapshot().entries[0]!.title).toBe('Phone Bank');
    expect(v.getSecret(v.snapshot().entries[0]!.id, 'password')).toBe(SECRET);
  });

  it('stores no plaintext and redacts secrets from snapshots', async () => {
    const { native, v } = await phoneWithItem();
    const raw = native.files.get(VAULT_FILE)!;
    for (const s of [SECRET, 'Phone Bank', 'BDO', '9876', PW]) expect(raw).not.toContain(s);
    const snap = JSON.stringify(v.snapshot());
    expect(snap).not.toContain(SECRET);
    expect(snap).not.toContain('9876');
    expect(v.snapshot().entries[0]!.secrets.accountNumber!.preview).toBe('•••• 7777');
  });

  it('detects tampering of ciphertext, tag and header', async () => {
    const { native, v } = await phoneWithItem();
    v.lock();
    const good = native.files.get(VAULT_FILE)!;
    for (const mutate of [
      (d: any) => (d.hint = 'evil'),
      (d: any) => (d.cipher.tag = Buffer.alloc(16, 1).toString('base64')),
      (d: any) => {
        const c = Buffer.from(d.ciphertext, 'base64');
        c[3] = c[3]! ^ 1;
        d.ciphertext = c.toString('base64');
      }
    ]) {
      const d = JSON.parse(good);
      mutate(d);
      native.files.set(VAULT_FILE, JSON.stringify(d));
      await expect(new MobileVault(native).unlock(PW)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
    }
  });

  it('keeps state unchanged when a write fails', async () => {
    const { native, v } = await phoneWithItem();
    const before = native.files.get(VAULT_FILE);
    native.failNextWrite = true;
    await expect(v.saveEntry({ categoryId: 'personal', title: 'X', fields: {}, tags: [], favorite: false })).rejects.toBeInstanceOf(AppError);
    expect(v.snapshot().entries).toHaveLength(1);
    expect(native.files.get(VAULT_FILE)).toBe(before);
  });

  it('changes the master password with a new salt and preserves the vault on failure', async () => {
    const { native, v } = await phoneWithItem();
    const before = native.files.get(VAULT_FILE)!;
    native.failNextWrite = true;
    await expect(v.changePassword(PW, 'Another-Strong-Pass-77', null)).rejects.toMatchObject({ code: 'REENCRYPT_FAILED' });
    expect(native.files.get(VAULT_FILE)).toBe(before);
    await expect(v.changePassword('nope', 'Another-Strong-Pass-77', null)).rejects.toThrow();
    await v.changePassword(PW, 'Another-Strong-Pass-77', null);
    expect(parseFile(native.files.get(VAULT_FILE)!).kdf.salt).not.toEqual(parseFile(before).kdf.salt);
    v.lock();
    await expect(v.unlock(PW)).rejects.toThrow();
    await v.unlock('Another-Strong-Pass-77');
    expect(v.snapshot().entries).toHaveLength(1);
  });

  it('creates verified backups and restores them while locked', async () => {
    const { native, v } = await phoneWithItem();
    const backup = await v.buildBackup();
    expect(await v.verifyBackup(backup)).toBe(true);
    v.lock();
    native.files.set(VAULT_FILE, 'corrupted');
    const fresh = new MobileVault(native);
    await expect(fresh.unlock(PW)).rejects.toThrow();
    await fresh.restoreWhileLocked(backup, PW);
    expect(fresh.snapshot().entries[0]!.title).toBe('Phone Bank');
  });
});

describe('desktop ⇄ Android compatibility', () => {
  it('a desktop backup opens and restores on the phone', async () => {
    const desktop = new VaultService(path.join(dir, 'vault', 'vault.vault'));
    await desktop.create(PW, null);
    await desktop.saveEntry({ categoryId: 'personal', title: 'From Desktop', fields: { password: SECRET }, tags: [], favorite: false });
    const target = path.join(dir, 'desk.vault');
    await new BackupService(desktop).createBackup(target);
    const raw = await fs.readFile(target, 'utf8');

    const phone = new MobileVault(memoryNative());
    await phone.restoreWhileLocked(raw, PW);
    const e = phone.snapshot().entries[0]!;
    expect(e.title).toBe('From Desktop');
    expect(phone.getSecret(e.id, 'password')).toBe(SECRET);
  });

  it('a phone backup and vault open on the desktop', async () => {
    const { native, v } = await phoneWithItem();
    const backupPath = path.join(dir, 'phone.vault');
    await fs.writeFile(backupPath, await v.buildBackup());
    const vaultPath = path.join(dir, 'vault', 'vault.vault');
    await fs.mkdir(path.dirname(vaultPath), { recursive: true });
    await fs.writeFile(vaultPath, native.files.get(VAULT_FILE)!);

    const desktop = new VaultService(vaultPath);
    await desktop.unlock(PW);
    const e = desktop.snapshot().entries[0]!;
    expect(e.title).toBe('Phone Bank');
    expect(desktop.getSecret(e.id, 'password')).toBe(SECRET);

    const b = new BackupService(desktop);
    const summary = await b.open(b.register(backupPath), PW);
    expect(summary.itemCount).toBe(1);
  });
});

describe('fingerprint & PIN quick unlock', () => {
  async function setup() {
    const { native, v } = await phoneWithItem();
    return { native, v, q: new QuickUnlock(native, v) };
  }

  it('PIN: requires the master password, unlocks, and counts wrong attempts', async () => {
    const { native, v, q } = await setup();
    await expect(q.enablePin('wrong-master', '2468')).rejects.toThrow();
    await expect(q.enablePin(PW, '12a4')).rejects.toThrow();
    await expect(q.enablePin(PW, '1111')).rejects.toThrow(); // too easy
    await q.enablePin(PW, '2468');
    expect(native.files.get('quick_pin.json')).not.toContain('2468');
    v.lock();
    await expect(q.unlockPin('9999')).rejects.toMatchObject({ code: 'WRONG_PIN', userMessage: 'Wrong PIN. 4 attempts left.' });
    expect((await q.status()).pinAttemptsLeft).toBe(4);
    await q.unlockPin('2468');
    expect(v.isUnlocked).toBe(true);
    expect((await q.status()).pinAttemptsLeft).toBe(5);
  });

  it('PIN: 5 wrong attempts turn PIN unlock off', async () => {
    const { v, q } = await setup();
    await q.enablePin(PW, '2468');
    v.lock();
    for (let i = 0; i < 4; i++) await expect(q.unlockPin('0001')).rejects.toMatchObject({ code: 'WRONG_PIN' });
    await expect(q.unlockPin('0001')).rejects.toMatchObject({ code: 'PIN_LOCKED' });
    expect((await q.status()).pin).toBe(false);
    await expect(q.unlockPin('2468')).rejects.toMatchObject({ code: 'NOT_ENABLED' });
  });

  it('PIN: useless without the device Keystore key (no offline brute force)', async () => {
    const { native, v, q } = await setup();
    await q.enablePin(PW, '2468');
    v.lock();
    native.keys.delete('device');
    await expect(q.unlockPin('2468')).rejects.toMatchObject({ code: 'INVALIDATED' });
    expect((await q.status()).pin).toBe(false);
  });

  it('fingerprint: enable, unlock, cancel, and invalidation when fingerprints change', async () => {
    const { native, v, q } = await setup();
    native.bio = 'cancel';
    await expect(q.enableBiometric(PW)).rejects.toMatchObject({ code: 'CANCELED' });
    native.bio = 'ok';
    await q.enableBiometric(PW);
    v.lock();
    native.bio = 'cancel';
    await expect(q.unlockBiometric()).rejects.toMatchObject({ code: 'CANCELED' });
    native.bio = 'ok';
    await q.unlockBiometric();
    expect(v.isUnlocked).toBe(true);
    v.lock();
    native.bio = 'invalidated';
    await expect(q.unlockBiometric()).rejects.toMatchObject({ code: 'INVALIDATED' });
    expect((await q.status()).biometric).toBe(false);
  });

  it('fingerprint: refused when no fingerprint is enrolled on the phone', async () => {
    const { native, q } = await setup();
    native.hasBiometric = false;
    await expect(q.enableBiometric(PW)).rejects.toMatchObject({ code: 'NO_BIOMETRIC' });
  });

  it('stale quick unlock after a master-password change is detected and removed', async () => {
    const { v, q } = await setup();
    await q.enablePin(PW, '2468');
    await v.changePassword(PW, 'Brand-New-Master-Pass-1', null);
    v.lock();
    await expect(q.unlockPin('2468')).rejects.toMatchObject({ code: 'QUICK_STALE' });
    expect(v.isUnlocked).toBe(false);
    expect((await q.status()).pin).toBe(false);
  });
});

describe('bulk import', () => {
  it('imports many items in one write, all-or-nothing (phone and desktop)', async () => {
    const { native, v } = await phoneWithItem();
    const before = native.files.get(VAULT_FILE);
    const n = await v.importEntries([
      { categoryId: 'personal', title: 'A', fields: { password: 'p1' }, tags: ['imported'], favorite: false },
      { categoryId: 'notes', title: 'B', fields: { content: 'secret note' }, tags: ['imported'], favorite: false }
    ]);
    expect(n).toBe(2);
    expect(native.files.get(VAULT_FILE)).not.toBe(before);
    expect(v.snapshot().entries.map((e) => e.title)).toEqual(['Phone Bank', 'A', 'B']);
    await expect(v.importEntries([{ categoryId: 'personal', title: '', fields: {}, tags: [], favorite: false }])).rejects.toThrow();
    expect(v.snapshot().entries).toHaveLength(3);

    const desktop = new VaultService(path.join(dir, 'vault', 'vault.vault'));
    await desktop.create(PW, null);
    expect(await desktop.importEntries([{ categoryId: 'others', title: 'Home', fields: { name: 'X', password: 'y' }, tags: [], favorite: false }])).toBe(1);
    expect(desktop.snapshot().entries[0]!.secrets.password!.set).toBe(true);
  });
});

