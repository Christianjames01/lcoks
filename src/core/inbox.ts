// Quick-add inbox: lets an expense be recorded while the vault is LOCKED without
// ever weakening the vault itself.
//
//   * On unlock the vault holds an ECDH P-256 key pair. The private key lives only
//     inside the encrypted vault payload; the public key is written next to the
//     vault as `inbox.pub` (it can encrypt, never decrypt).
//   * A locked device (lock screen box, Android notification reply) encrypts each
//     entry to that public key: ephemeral ECDH → HKDF-SHA256 → AES-256-GCM, and
//     stores it as its own write-once file `inbox-<id>.box`.
//   * The next unlock opens every box with the private key, adds the entries as
//     expense records and deletes the files.
//
// The Android notification receiver (QuickAddCrypto.java) implements the same
// format byte for byte.

import { fromB64, toB64 } from './crypto';

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
export const INBOX_INFO = 'VaultLocks inbox v1';
const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;

/**
 * What a box holds: the typed text ("lunch 150") or the pop-up's choices, and the
 * local day it was entered on. k/a/c/acc present = structured entry from the pop-up.
 */
export interface InboxEntry {
  t: string;
  day: string;
  at: string;
  k?: 'expense' | 'income';
  /** Amount, minor units. */
  a?: number;
  c?: string;
  acc?: string;
}

export interface InboxKeys {
  /** Private key (JWK), stored only in the encrypted payload. */
  priv: JsonWebKey;
  /** Public key: base64 of the 65-byte uncompressed point. */
  pub: string;
}

export async function generateInboxKeys(): Promise<InboxKeys> {
  const pair = (await subtle().generateKey(CURVE, true, ['deriveBits'])) as CryptoKeyPair;
  const priv = await subtle().exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  return { priv, pub: toB64(pub) };
}

async function aesKey(shared: ArrayBuffer, epk: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const ikm = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: epk as BufferSource, info: enc.encode(INBOX_INFO) }, ikm, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

/** Encrypt one entry to the inbox public key. Returns the box file content. */
export async function sealInbox(pubB64: string, entry: InboxEntry): Promise<string> {
  const pubRaw = fromB64(pubB64, 200);
  if (pubRaw.length !== 65 || pubRaw[0] !== 4) throw new Error('bad inbox key');
  const pub = await subtle().importKey('raw', pubRaw as BufferSource, CURVE, false, []);
  const eph = (await subtle().generateKey(CURVE, true, ['deriveBits'])) as CryptoKeyPair;
  const epk = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  const shared = await subtle().deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256);
  const key = await aesKey(shared, epk, 'encrypt');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(INBOX_INFO) }, key, enc.encode(JSON.stringify(entry))));
  return JSON.stringify({ v: 1, epk: toB64(epk), iv: toB64(iv), ct: toB64(ct) });
}

/** Decrypt one box with the private key. Throws if it was not made for this key or was altered. */
export async function openInbox(priv: JsonWebKey, box: string): Promise<InboxEntry> {
  const b = JSON.parse(box) as { v?: unknown; epk?: unknown; iv?: unknown; ct?: unknown };
  if (b.v !== 1) throw new Error('bad box');
  const epk = fromB64(b.epk, 200);
  const iv = fromB64(b.iv, 64);
  const ct = fromB64(b.ct, 8192);
  if (epk.length !== 65 || iv.length !== 12) throw new Error('bad box');
  const key = await subtle().importKey('jwk', priv, CURVE, false, ['deriveBits']);
  const ephPub = await subtle().importKey('raw', epk as BufferSource, CURVE, false, []);
  const shared = await subtle().deriveBits({ name: 'ECDH', public: ephPub }, key, 256);
  const aes = await aesKey(shared, epk, 'decrypt');
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(INBOX_INFO) }, aes, ct as BufferSource);
  const e = JSON.parse(new TextDecoder().decode(plain)) as Partial<InboxEntry>;
  if (typeof e.t !== 'string' || typeof e.day !== 'string') throw new Error('bad entry');
  const out: InboxEntry = { t: e.t.slice(0, 200), day: e.day, at: typeof e.at === 'string' ? e.at : '' };
  if ((e.k === 'expense' || e.k === 'income') && Number.isInteger(e.a)) {
    out.k = e.k;
    out.a = e.a;
    if (typeof e.c === 'string') out.c = e.c;
    if (typeof e.acc === 'string') out.acc = e.acc;
  }
  return out;
}
