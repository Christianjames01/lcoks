// Primitives of the shared crypto module (src/core/crypto.ts), used by both the
// desktop and the Android app.

import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  attachmentAad,
  buildFile,
  deriveKey,
  deriveRawKey,
  headerAad,
  importAesKey,
  newKdfParams,
  openBytes,
  openFile,
  parseFile,
  randomBytes,
  sealBytes,
  sha256Hex,
  toB64,
  validateKdfParams,
  wipe,
  type Header,
  type KdfParams
} from '../src/core/crypto';

// Cheaper (but still valid) params for fast tests of the primitives.
const fastParams = (): KdfParams => ({ ...newKdfParams(), memoryKiB: 19 * 1024, iterations: 2, parallelism: 1 });
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const aesKey = async () => importAesKey(randomBytes(32));

describe('Argon2id key derivation', () => {
  it('is deterministic for the same password and salt', async () => {
    const p = fastParams();
    const a = await deriveRawKey('correct horse', p);
    const b = await deriveRawKey('correct horse', p);
    expect(a.length).toBe(32);
    expect(eq(a, b)).toBe(true);
  });

  it('produces different keys for different salts and passwords', async () => {
    const p1 = fastParams();
    const p2 = { ...p1, salt: randomBytes(32) };
    const a = await deriveRawKey('pw', p1);
    expect(eq(a, await deriveRawKey('pw', p2))).toBe(false);
    expect(eq(a, await deriveRawKey('pw2', p1))).toBe(false);
  });

  it('normalizes Unicode so NFC and NFD forms of a password derive the same key', async () => {
    const p = fastParams();
    const nfc = 'café-пароль-密码'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    expect(eq(await deriveRawKey(nfc, p), await deriveRawKey(nfd, p))).toBe(true);
  });

  it('uses the default cost of 64 MiB / 3 passes / 4 lanes with a 256-bit salt', () => {
    const p = newKdfParams();
    expect(p).toMatchObject({ memoryKiB: 65536, iterations: 3, parallelism: 4 });
    expect(p.salt.length).toBe(32);
    expect(eq(newKdfParams().salt, p.salt)).toBe(false);
  });

  it('rejects downgraded or denial-of-service parameters', () => {
    const base = fastParams();
    for (const bad of [
      { ...base, memoryKiB: 1024 },
      { ...base, memoryKiB: 8 * 1024 * 1024 },
      { ...base, iterations: 1 },
      { ...base, iterations: 1000 },
      { ...base, parallelism: 0 },
      { ...base, salt: randomBytes(4) }
    ]) {
      expect(() => validateKdfParams(bad as KdfParams)).toThrow(CryptoError);
    }
  });
});

describe('AES-256-GCM', () => {
  const msg = new TextEncoder().encode('top secret 🔐 data');

  it('round-trips and binds the associated data', async () => {
    const key = await aesKey();
    const blob = await sealBytes(key, msg, 'aad-1');
    expect(eq(await openBytes(key, blob, 'aad-1'), msg)).toBe(true);
    await expect(openBytes(key, blob, 'aad-2')).rejects.toThrow();
    await expect(openBytes(key, blob)).rejects.toThrow();
  });

  it('uses a unique random nonce on every encryption', async () => {
    const key = await aesKey();
    const nonces = new Set<string>();
    for (let i = 0; i < 200; i++) nonces.add(toB64((await sealBytes(key, msg)).slice(0, 12)));
    expect(nonces.size).toBe(200);
  });

  it('fails with the wrong key and detects any modified byte', async () => {
    const key = await aesKey();
    const blob = await sealBytes(key, msg);
    await expect(openBytes(await aesKey(), blob)).rejects.toThrow();
    for (const i of [0, 13, blob.length - 1]) {
      const c = blob.slice();
      c[i] = c[i]! ^ 1;
      await expect(openBytes(key, c)).rejects.toThrow();
    }
    await expect(openBytes(key, blob.slice(0, 20))).rejects.toThrow();
  });

  it('attachments are bound to their id (cannot be swapped between attachments)', async () => {
    const key = await aesKey();
    const blob = await sealBytes(key, msg, attachmentAad('aaaaaaaa-1'));
    await expect(openBytes(key, blob, attachmentAad('bbbbbbbb-2'))).rejects.toThrow();
  });

  it('sha256Hex matches the known test vector', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('wipe() overwrites buffers with zeros', () => {
    const b = new TextEncoder().encode('sensitive');
    wipe(b);
    expect([...b].every((x) => x === 0)).toBe(true);
  });
});

describe('vault file format', () => {
  const header = (): Header => ({ kind: 'vault', createdAt: new Date().toISOString(), kdf: fastParams(), hint: 'my hint' });

  it('serializes, parses and decrypts; contains no plaintext', async () => {
    const h = header();
    const key = await deriveKey('pw-123', h.kdf);
    const raw = await buildFile(h, key, '{"password":"mypassword123"}');
    expect(raw).not.toContain('mypassword123');
    const parsed = parseFile(raw);
    expect(await openFile(parsed, key)).toBe('{"password":"mypassword123"}');
    expect(eq(headerAad(parsed), headerAad(h))).toBe(true);
  });

  it('authenticates every header field (tampering is detected)', async () => {
    const h = header();
    const key = await deriveKey('pw-123', h.kdf);
    const raw = await buildFile(h, key, '{}');
    for (const fn of [
      (d: any) => (d.hint = 'evil hint'),
      (d: any) => (d.createdAt = '2000-01-01T00:00:00.000Z'),
      (d: any) => (d.kind = 'backup')
    ]) {
      const d = JSON.parse(raw);
      fn(d);
      await expect(openFile(parseFile(JSON.stringify(d)), key)).rejects.toThrow();
    }
  });

  it('rejects malformed / corrupted files', async () => {
    const h = header();
    const good = await buildFile(h, await deriveKey('pw-123', h.kdf), '{}');
    for (const bad of ['', 'not json', '{}', good.slice(0, good.length / 2), good.replace(/"version":\s*1/, '"version": 99')]) {
      expect(() => parseFile(bad)).toThrow(CryptoError);
    }
  });
});
