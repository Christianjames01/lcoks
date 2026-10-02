// ============================================================================
// SECURITY-CRITICAL MODULE — cryptography for the Android app.
//
// Implements EXACTLY the same vault file format as the desktop app
// (src/main/security/vaultFile.ts), so encrypted backups move freely between
// desktop and phone:
//
//   * Argon2id (RFC 9106) via hash-wasm, same parameters and bounds as desktop.
//   * AES-256-GCM via WebCrypto (crypto.subtle), 96-bit random nonce, 128-bit tag.
//   * The header is bound as additional authenticated data (AAD).
//
// The session key is imported as a NON-EXTRACTABLE CryptoKey: after unlock, page
// JavaScript cannot read the raw key bytes back out — it can only ask the
// browser engine to encrypt/decrypt with it. Raw Argon2 output is wiped
// immediately after import.
// ============================================================================

import { argon2id } from 'hash-wasm';

export const KEY_LENGTH = 32;
export const NONCE_LENGTH = 12;
export const TAG_LENGTH = 16;
export const SALT_LENGTH = 32;
export const FILE_FORMAT = 'VAULTLOCKS';
export const FILE_VERSION = 1;
export const MAX_HINT_LENGTH = 200;
export const MAX_FILE_CHARS = 64 * 1024 * 1024;

export const DEFAULT_KDF = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 4 } as const;
const LIMITS = {
  memoryKiB: { min: 19 * 1024, max: 1024 * 1024 },
  iterations: { min: 2, max: 20 },
  parallelism: { min: 1, max: 16 },
  salt: { min: 16, max: 64 }
} as const;

export interface KdfParams {
  name: 'argon2id';
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  salt: Uint8Array;
}

export type FileKind = 'vault' | 'backup';

export interface Header {
  kind: FileKind;
  createdAt: string;
  kdf: KdfParams;
  hint: string | null;
}

export interface ParsedFile extends Header {
  nonce: Uint8Array;
  tag: Uint8Array;
  ciphertext: Uint8Array;
}

/** Generic errors only — never reveal which check failed. */
export class MobileCryptoError extends Error {
  constructor(readonly code: 'AUTH_FAILED' | 'BAD_PARAMS' | 'INVALID_FORMAT' | 'KDF_FAILED') {
    super(code);
    this.name = 'MobileCryptoError';
  }
}

const subtle = () => globalThis.crypto.subtle;

export function wipe(b: Uint8Array | null | undefined): void {
  if (!b || b.length === 0) return;
  globalThis.crypto.getRandomValues(b.subarray(0, Math.min(b.length, 65536)) as Uint8Array<ArrayBuffer>);
  b.fill(0);
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

// ---------------------------------------------------------------- base64 ----

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(value: unknown, maxLen = Number.MAX_SAFE_INTEGER): Uint8Array {
  if (typeof value !== 'string' || value.length > maxLen || value.length % 4 !== 0 || !B64.test(value)) {
    throw new MobileCryptoError('INVALID_FORMAT');
  }
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

// ------------------------------------------------------------------- KDF ----

export function newKdfParams(): KdfParams {
  return { name: 'argon2id', ...DEFAULT_KDF, salt: randomBytes(SALT_LENGTH) };
}

export function validateKdfParams(p: KdfParams): void {
  const within = (v: number, r: { min: number; max: number }) => Number.isInteger(v) && v >= r.min && v <= r.max;
  if (
    p.name !== 'argon2id' ||
    !within(p.memoryKiB, LIMITS.memoryKiB) ||
    !within(p.iterations, LIMITS.iterations) ||
    !within(p.parallelism, LIMITS.parallelism) ||
    !(p.salt instanceof Uint8Array) ||
    !within(p.salt.length, LIMITS.salt) ||
    p.memoryKiB < 8 * p.parallelism
  ) {
    throw new MobileCryptoError('BAD_PARAMS');
  }
}

/**
 * Derive the AES key from the master password (NFC-normalized UTF-8, identical
 * to desktop) and import it as a non-extractable AES-GCM CryptoKey.
 */
export async function deriveKey(password: string, params: KdfParams): Promise<CryptoKey> {
  validateKdfParams(params);
  const pw = enc.encode(password.normalize('NFC'));
  let raw: Uint8Array | undefined;
  try {
    raw = await argon2id({
      password: pw,
      salt: params.salt,
      iterations: params.iterations,
      parallelism: params.parallelism,
      memorySize: params.memoryKiB,
      hashLength: KEY_LENGTH,
      outputType: 'binary'
    });
    return await subtle().importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } catch (e) {
    if (e instanceof MobileCryptoError) throw e;
    throw new MobileCryptoError('KDF_FAILED');
  } finally {
    wipe(pw);
    wipe(raw);
  }
}

// ---------------------------------------------------------------- format ----

/** Canonical AAD — byte-for-byte identical to the desktop implementation. */
export function headerAad(h: Header): Uint8Array {
  return enc.encode(
    JSON.stringify([
      FILE_FORMAT,
      FILE_VERSION,
      h.kind,
      h.createdAt,
      h.kdf.name,
      h.kdf.memoryKiB,
      h.kdf.iterations,
      h.kdf.parallelism,
      toB64(h.kdf.salt),
      'aes-256-gcm',
      h.hint
    ])
  );
}

/** Encrypt the payload JSON and produce the serialized file (fresh nonce every call). */
export async function buildFile(header: Header, key: CryptoKey, payloadJson: string): Promise<string> {
  const nonce = randomBytes(NONCE_LENGTH);
  const plain = enc.encode(payloadJson);
  try {
    const out = new Uint8Array(
      await subtle().encrypt(
        { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: headerAad(header) as BufferSource, tagLength: TAG_LENGTH * 8 },
        key,
        plain as BufferSource
      )
    );
    // WebCrypto appends the tag to the ciphertext; the file stores them separately.
    const ciphertext = out.subarray(0, out.length - TAG_LENGTH);
    const tag = out.subarray(out.length - TAG_LENGTH);
    return JSON.stringify(
      {
        format: FILE_FORMAT,
        version: FILE_VERSION,
        kind: header.kind,
        createdAt: header.createdAt,
        kdf: {
          name: header.kdf.name,
          memoryKiB: header.kdf.memoryKiB,
          iterations: header.kdf.iterations,
          parallelism: header.kdf.parallelism,
          salt: toB64(header.kdf.salt)
        },
        cipher: { name: 'aes-256-gcm', nonce: toB64(nonce), tag: toB64(tag) },
        hint: header.hint,
        ciphertext: toB64(ciphertext)
      },
      null,
      2
    );
  } finally {
    wipe(plain);
  }
}

export function parseFile(raw: string): ParsedFile {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_FILE_CHARS) throw new MobileCryptoError('INVALID_FORMAT');
  let doc: any;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new MobileCryptoError('INVALID_FORMAT');
  }
  const bad = () => new MobileCryptoError('INVALID_FORMAT');
  if (!doc || typeof doc !== 'object' || doc.format !== FILE_FORMAT || doc.version !== FILE_VERSION) throw bad();
  if (doc.kind !== 'vault' && doc.kind !== 'backup') throw bad();
  if (typeof doc.createdAt !== 'string' || doc.createdAt.length > 64) throw bad();
  if (doc.hint !== null && (typeof doc.hint !== 'string' || doc.hint.length > MAX_HINT_LENGTH)) throw bad();
  const { kdf, cipher } = doc;
  if (!kdf || kdf.name !== 'argon2id' || !cipher || cipher.name !== 'aes-256-gcm') throw bad();
  for (const k of ['memoryKiB', 'iterations', 'parallelism']) if (!Number.isInteger(kdf[k])) throw bad();
  return {
    kind: doc.kind,
    createdAt: doc.createdAt,
    hint: doc.hint,
    kdf: { name: 'argon2id', memoryKiB: kdf.memoryKiB, iterations: kdf.iterations, parallelism: kdf.parallelism, salt: fromB64(kdf.salt, 128) },
    nonce: fromB64(cipher.nonce, 64),
    tag: fromB64(cipher.tag, 64),
    ciphertext: fromB64(doc.ciphertext)
  };
}

/**
 * Decrypt and return the payload JSON. WebCrypto verifies the GCM tag and
 * rejects before returning ANY plaintext if the key, ciphertext, nonce, tag or
 * header was wrong/modified.
 */
export async function openFile(file: ParsedFile, key: CryptoKey): Promise<string> {
  if (file.nonce.length !== NONCE_LENGTH || file.tag.length !== TAG_LENGTH) throw new MobileCryptoError('AUTH_FAILED');
  const joined = new Uint8Array(file.ciphertext.length + TAG_LENGTH);
  joined.set(file.ciphertext);
  joined.set(file.tag, file.ciphertext.length);
  let plain: Uint8Array | undefined;
  try {
    plain = new Uint8Array(
      await subtle().decrypt(
        { name: 'AES-GCM', iv: file.nonce as BufferSource, additionalData: headerAad(file) as BufferSource, tagLength: TAG_LENGTH * 8 },
        key,
        joined as BufferSource
      )
    );
    return dec.decode(plain);
  } catch {
    throw new MobileCryptoError('AUTH_FAILED');
  } finally {
    wipe(plain);
  }
}
