import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  deriveKey,
  keysEqual,
  newKdfParams,
  open,
  passwordToBytes,
  seal,
  validateKdfParams,
  type KdfParams
} from '../src/main/security/crypto';
import { wipe } from '../src/main/security/memory';
import { buildVaultFile, headerAad, openVaultFile, parseVaultFile, VaultFormatError } from '../src/main/security/vaultFile';

// Cheaper (but still valid) params for fast tests of the primitives.
const fastParams = (): KdfParams => ({ name: 'argon2id', memoryKiB: 19 * 1024, iterations: 2, parallelism: 1, salt: randomBytes(32) });

describe('Argon2id key derivation', () => {
  it('is deterministic for the same password and salt', async () => {
    const p = fastParams();
    const a = await deriveKey(passwordToBytes('correct horse'), p);
    const b = await deriveKey(passwordToBytes('correct horse'), p);
    expect(a.length).toBe(32);
    expect(keysEqual(a, b)).toBe(true);
  });

  it('produces different keys for different salts and passwords', async () => {
    const p1 = fastParams();
    const p2 = { ...p1, salt: randomBytes(32) };
    const a = await deriveKey(passwordToBytes('pw'), p1);
    const b = await deriveKey(passwordToBytes('pw'), p2);
    const c = await deriveKey(passwordToBytes('pw2'), p1);
    expect(keysEqual(a, b)).toBe(false);
    expect(keysEqual(a, c)).toBe(false);
  });

  it('normalizes Unicode so NFC and NFD forms of a password derive the same key', async () => {
    const p = fastParams();
    const nfc = 'café-пароль-密码'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    expect(keysEqual(await deriveKey(passwordToBytes(nfc), p), await deriveKey(passwordToBytes(nfd), p))).toBe(true);
  });

  it('uses the default cost of 64 MiB / 3 passes / 4 lanes with a 256-bit salt', () => {
    const p = newKdfParams();
    expect(p).toMatchObject({ name: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 4 });
    expect(p.salt.length).toBe(32);
    expect(newKdfParams().salt.equals(p.salt)).toBe(false);
  });

  it('rejects downgraded or denial-of-service parameters', () => {
    const base = fastParams();
    for (const bad of [
      { ...base, memoryKiB: 1024 },
      { ...base, memoryKiB: 8 * 1024 * 1024 },
      { ...base, iterations: 1 },
      { ...base, iterations: 1000 },
      { ...base, parallelism: 0 },
      { ...base, salt: randomBytes(4) },
      { ...base, name: 'argon2i' as 'argon2id' }
    ]) {
      expect(() => validateKdfParams(bad)).toThrow(CryptoError);
    }
  });
});

describe('AES-256-GCM', () => {
  const key = randomBytes(32);
  const aad = Buffer.from('header');
  const msg = Buffer.from('top secret 🔐 data');

  it('round-trips', () => {
    const s = seal(key, msg, aad);
    expect(open(key, s, aad).equals(msg)).toBe(true);
  });

  it('uses a unique random nonce on every encryption', () => {
    const nonces = new Set(Array.from({ length: 200 }, () => seal(key, msg, aad).nonce.toString('hex')));
    expect(nonces.size).toBe(200);
  });

  it('fails authentication with the wrong key', () => {
    const s = seal(key, msg, aad);
    expect(() => open(randomBytes(32), s, aad)).toThrow(CryptoError);
  });

  it('detects modified ciphertext, tag, nonce and AAD', () => {
    const s = seal(key, msg, aad);
    const flip = (b: Buffer, i = 0) => {
      const c = Buffer.from(b);
      c[i] = c[i]! ^ 0x01;
      return c;
    };
    expect(() => open(key, { ...s, ciphertext: flip(s.ciphertext) }, aad)).toThrow('AUTH_FAILED');
    expect(() => open(key, { ...s, tag: flip(s.tag) }, aad)).toThrow('AUTH_FAILED');
    expect(() => open(key, { ...s, nonce: flip(s.nonce) }, aad)).toThrow('AUTH_FAILED');
    expect(() => open(key, s, Buffer.from('other header'))).toThrow('AUTH_FAILED');
    expect(() => open(key, { ...s, tag: s.tag.subarray(0, 8) }, aad)).toThrow('AUTH_FAILED');
  });

  it('wipe() overwrites buffers with zeros', () => {
    const b = Buffer.from('sensitive');
    wipe(b);
    expect([...b].every((x) => x === 0)).toBe(true);
  });
});

describe('vault file format', () => {
  const header = () => ({ kind: 'vault' as const, createdAt: new Date().toISOString(), kdf: fastParams(), hint: 'my hint' });

  it('serializes, parses and decrypts', () => {
    const h = header();
    const key = randomBytes(32);
    const file = buildVaultFile(h, key, Buffer.from('{"hello":"world"}'));
    const parsed = parseVaultFile(file);
    expect(openVaultFile(parsed, key).toString()).toBe('{"hello":"world"}');
    expect(headerAad(parsed).equals(headerAad(h))).toBe(true);
  });

  it('contains no plaintext', () => {
    const key = randomBytes(32);
    const file = buildVaultFile(header(), key, Buffer.from('password = "mypassword123"'));
    expect(file.toString()).not.toContain('mypassword123');
  });

  it('authenticates every header field (tampering is detected)', () => {
    const key = randomBytes(32);
    const raw = buildVaultFile(header(), key, Buffer.from('{}'));
    const tamper = (fn: (d: any) => void) => {
      const d = JSON.parse(raw.toString());
      fn(d);
      return parseVaultFile(Buffer.from(JSON.stringify(d)));
    };
    for (const fn of [
      (d: any) => (d.hint = 'evil hint'),
      (d: any) => (d.kdf.iterations = 2 + (d.kdf.iterations === 2 ? 1 : 0)),
      (d: any) => (d.createdAt = '2000-01-01T00:00:00.000Z'),
      (d: any) => (d.kind = 'backup')
    ]) {
      expect(() => openVaultFile(tamper(fn), key)).toThrow('AUTH_FAILED');
    }
  });

  it('rejects malformed / corrupted files', () => {
    const key = randomBytes(32);
    const good = buildVaultFile(header(), key, Buffer.from('{}')).toString();
    for (const bad of ['', 'not json', '{}', good.slice(0, good.length / 2), good.replace('"version": 1', '"version": 99'), good.replace(/"ciphertext": "[^"]*"/, '"ciphertext": "@@@"')]) {
      expect(() => parseVaultFile(Buffer.from(bad))).toThrow(VaultFormatError);
    }
  });
});
