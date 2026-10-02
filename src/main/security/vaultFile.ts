// ============================================================================
// SECURITY-CRITICAL MODULE — on-disk vault/backup file format.
//
// File layout (JSON, UTF-8):
//   {
//     "format":    "VAULTLOCKS",
//     "version":   1,
//     "kind":      "vault" | "backup",
//     "createdAt": ISO-8601,
//     "kdf":       { name:"argon2id", memoryKiB, iterations, parallelism, salt },
//     "cipher":    { name:"aes-256-gcm", nonce, tag },
//     "hint":      string | null,      // user-chosen, optional, NOT secret
//     "ciphertext": base64              // AES-256-GCM(JSON payload)
//   }
//
// Everything outside `ciphertext` is public metadata needed to derive the key and
// decrypt. ALL of it (except nonce/tag themselves) is bound into the GCM
// additional-authenticated-data, so modifying any header field — e.g. lowering
// the KDF cost or swapping the hint — causes authentication to fail.
// The file never contains the password, the key, or any plaintext credentials.
// ============================================================================

import { CryptoError, open, seal, type KdfParams, type Sealed } from './crypto';

export const FILE_FORMAT = 'VAULTLOCKS';
export const FILE_VERSION = 1;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_HINT_LENGTH = 200;

export type FileKind = 'vault' | 'backup';

export interface VaultFileHeader {
  kind: FileKind;
  createdAt: string;
  kdf: KdfParams;
  hint: string | null;
}

export interface ParsedVaultFile extends VaultFileHeader {
  version: number;
  sealed: Sealed;
}

export class VaultFormatError extends Error {
  constructor() {
    super('INVALID_FORMAT');
    this.name = 'VaultFormatError';
  }
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

function b64(value: unknown, maxLen = Number.MAX_SAFE_INTEGER): Buffer {
  if (typeof value !== 'string' || value.length > maxLen || value.length % 4 !== 0 || !B64.test(value)) {
    throw new VaultFormatError();
  }
  return Buffer.from(value, 'base64');
}

/** Canonical, order-stable encoding of the header used as GCM AAD. */
export function headerAad(h: VaultFileHeader): Buffer {
  return Buffer.from(
    JSON.stringify([
      FILE_FORMAT,
      FILE_VERSION,
      h.kind,
      h.createdAt,
      h.kdf.name,
      h.kdf.memoryKiB,
      h.kdf.iterations,
      h.kdf.parallelism,
      h.kdf.salt.toString('base64'),
      'aes-256-gcm',
      h.hint
    ]),
    'utf8'
  );
}

/** Encrypt `plaintext` under `key` and produce the serialized file contents. */
export function buildVaultFile(header: VaultFileHeader, key: Buffer, plaintext: Buffer): Buffer {
  const sealed = seal(key, plaintext, headerAad(header));
  const doc = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    kind: header.kind,
    createdAt: header.createdAt,
    kdf: {
      name: header.kdf.name,
      memoryKiB: header.kdf.memoryKiB,
      iterations: header.kdf.iterations,
      parallelism: header.kdf.parallelism,
      salt: header.kdf.salt.toString('base64')
    },
    cipher: {
      name: 'aes-256-gcm',
      nonce: sealed.nonce.toString('base64'),
      tag: sealed.tag.toString('base64')
    },
    hint: header.hint,
    ciphertext: sealed.ciphertext.toString('base64')
  };
  return Buffer.from(JSON.stringify(doc, null, 2), 'utf8');
}

/**
 * Strictly parse a file. Any structural problem → VaultFormatError (reported to
 * the user with the same generic "incorrect password or corrupted" message).
 */
export function parseVaultFile(raw: Buffer): ParsedVaultFile {
  if (raw.length === 0 || raw.length > MAX_FILE_BYTES) throw new VaultFormatError();
  let doc: any;
  try {
    doc = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new VaultFormatError();
  }
  if (!doc || typeof doc !== 'object' || doc.format !== FILE_FORMAT) throw new VaultFormatError();
  if (doc.version !== FILE_VERSION) throw new VaultFormatError();
  if (doc.kind !== 'vault' && doc.kind !== 'backup') throw new VaultFormatError();
  if (typeof doc.createdAt !== 'string' || doc.createdAt.length > 64) throw new VaultFormatError();
  if (doc.hint !== null && (typeof doc.hint !== 'string' || doc.hint.length > MAX_HINT_LENGTH)) {
    throw new VaultFormatError();
  }
  const kdf = doc.kdf;
  const cipher = doc.cipher;
  if (!kdf || typeof kdf !== 'object' || kdf.name !== 'argon2id') throw new VaultFormatError();
  if (!cipher || typeof cipher !== 'object' || cipher.name !== 'aes-256-gcm') throw new VaultFormatError();
  for (const k of ['memoryKiB', 'iterations', 'parallelism']) {
    if (!Number.isInteger(kdf[k])) throw new VaultFormatError();
  }
  return {
    version: doc.version,
    kind: doc.kind,
    createdAt: doc.createdAt,
    hint: doc.hint,
    kdf: {
      name: 'argon2id',
      memoryKiB: kdf.memoryKiB,
      iterations: kdf.iterations,
      parallelism: kdf.parallelism,
      salt: b64(kdf.salt, 128)
    },
    sealed: {
      nonce: b64(cipher.nonce, 64),
      tag: b64(cipher.tag, 64),
      ciphertext: b64(doc.ciphertext)
    }
  };
}

/**
 * Decrypt a parsed file. Throws CryptoError('AUTH_FAILED') if the key is wrong or
 * if any byte of the ciphertext, tag, nonce or header was modified.
 */
export function openVaultFile(file: ParsedVaultFile, key: Buffer): Buffer {
  try {
    return open(key, file.sealed, headerAad(file));
  } catch (e) {
    if (e instanceof CryptoError) throw e;
    throw new CryptoError('AUTH_FAILED');
  }
}
