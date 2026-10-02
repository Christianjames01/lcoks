// ============================================================================
// SECURITY-CRITICAL MODULE — cryptographic primitives.
//
//   * Key derivation:  Argon2id (RFC 9106) via hash-wasm (audited WASM build of
//                      the reference implementation).
//   * Encryption:      AES-256-GCM via Node/BoringSSL (authenticated encryption).
//   * Randomness:      crypto.randomBytes (OS CSPRNG) for salts and nonces.
//
// No custom cryptography is implemented here; this module only wires standard,
// well-reviewed primitives together. Nothing in this file may log, print or
// otherwise expose key material, passwords or plaintext.
// ============================================================================

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2id } from 'hash-wasm';
import { wipe } from './memory';

export const KEY_LENGTH = 32; // 256-bit key
export const NONCE_LENGTH = 12; // 96-bit GCM nonce (NIST SP 800-38D recommendation)
export const TAG_LENGTH = 16; // 128-bit authentication tag
export const SALT_LENGTH = 32;

export interface KdfParams {
  name: 'argon2id';
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  salt: Buffer;
}

/**
 * Default Argon2id cost: 64 MiB memory, 3 passes, 4 lanes.
 * This is the second recommended option in RFC 9106 §4 and well above the
 * OWASP minimum (19 MiB, t=2, p=1).
 */
export const DEFAULT_KDF = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 4 } as const;

/**
 * Accepted ranges when *reading* a file. The lower bounds stop downgrade to
 * trivially brute-forceable parameters; the upper bounds stop a malicious backup
 * file from exhausting memory/CPU (denial of service) when it is opened.
 */
export const KDF_LIMITS = {
  memoryKiB: { min: 19 * 1024, max: 1024 * 1024 },
  iterations: { min: 2, max: 20 },
  parallelism: { min: 1, max: 16 },
  salt: { min: 16, max: 64 }
} as const;

export class CryptoError extends Error {
  constructor(readonly code: 'AUTH_FAILED' | 'BAD_PARAMS' | 'KDF_FAILED' | 'ENCRYPT_FAILED') {
    // Message intentionally generic — never include crypto internals.
    super(code);
    this.name = 'CryptoError';
  }
}

export function newKdfParams(): KdfParams {
  return { name: 'argon2id', ...DEFAULT_KDF, salt: randomBytes(SALT_LENGTH) };
}

export function validateKdfParams(p: KdfParams): void {
  const within = (v: number, r: { min: number; max: number }) => Number.isInteger(v) && v >= r.min && v <= r.max;
  if (
    p.name !== 'argon2id' ||
    !within(p.memoryKiB, KDF_LIMITS.memoryKiB) ||
    !within(p.iterations, KDF_LIMITS.iterations) ||
    !within(p.parallelism, KDF_LIMITS.parallelism) ||
    !Buffer.isBuffer(p.salt) ||
    !within(p.salt.length, KDF_LIMITS.salt) ||
    p.memoryKiB < 8 * p.parallelism
  ) {
    throw new CryptoError('BAD_PARAMS');
  }
}

/**
 * Normalize a password to Unicode NFC and encode as UTF-8 bytes, so that the same
 * visible password typed on different keyboards/IMEs derives the same key.
 * The caller owns the returned buffer and must wipe() it.
 */
export function passwordToBytes(password: string): Buffer {
  return Buffer.from(password.normalize('NFC'), 'utf8');
}

/**
 * Derive a 256-bit key from the master password with Argon2id.
 * `passwordBytes` is NOT wiped here; the caller wipes it in a finally block.
 * Returns a Buffer the caller must wipe() when done (e.g. on vault lock).
 */
export async function deriveKey(passwordBytes: Uint8Array, params: KdfParams): Promise<Buffer> {
  validateKdfParams(params);
  let raw: Uint8Array | undefined;
  try {
    raw = await argon2id({
      password: passwordBytes,
      salt: params.salt,
      iterations: params.iterations,
      parallelism: params.parallelism,
      memorySize: params.memoryKiB,
      hashLength: KEY_LENGTH,
      outputType: 'binary'
    });
    if (raw.length !== KEY_LENGTH) throw new CryptoError('KDF_FAILED');
    return Buffer.from(raw); // copy into a Buffer we control
  } catch (e) {
    if (e instanceof CryptoError) throw e;
    throw new CryptoError('KDF_FAILED');
  } finally {
    if (raw) wipe(raw);
  }
}

export interface Sealed {
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

/**
 * AES-256-GCM encrypt. A fresh random 96-bit nonce is generated for EVERY call,
 * so a (key, nonce) pair is never reused. `aad` (additional authenticated data)
 * binds the unencrypted file header to the ciphertext: any change to the header
 * (KDF params, salt, version, hint…) makes decryption fail.
 */
export function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Sealed {
  if (key.length !== KEY_LENGTH) throw new CryptoError('ENCRYPT_FAILED');
  try {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LENGTH });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { nonce, ciphertext, tag };
  } catch {
    throw new CryptoError('ENCRYPT_FAILED');
  }
}

/**
 * AES-256-GCM decrypt. `decipher.final()` verifies the authentication tag and
 * throws if the ciphertext, nonce, tag, AAD or key is wrong — so NO plaintext is
 * ever returned unless authentication succeeded. A wrong password and a tampered
 * file are deliberately indistinguishable (both → AUTH_FAILED).
 */
export function open(key: Buffer, sealed: Sealed, aad: Buffer): Buffer {
  if (
    key.length !== KEY_LENGTH ||
    sealed.nonce.length !== NONCE_LENGTH ||
    sealed.tag.length !== TAG_LENGTH
  ) {
    throw new CryptoError('AUTH_FAILED');
  }
  let out: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce, { authTagLength: TAG_LENGTH });
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.tag);
    out = decipher.update(sealed.ciphertext);
    const final = decipher.final(); // ← throws on authentication failure
    return Buffer.concat([out, final]);
  } catch {
    // Discard any partially-decrypted (unauthenticated) bytes.
    throw new CryptoError('AUTH_FAILED');
  } finally {
    if (out) wipe(out);
  }
}

/** Constant-time comparison of two keys (used to verify the current password). */
export function keysEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
