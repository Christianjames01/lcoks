// SECURITY-SENSITIVE: password / passphrase generation.
//
// All randomness comes from `crypto.getRandomValues` (Web Crypto CSPRNG, available
// in both Electron's renderer and Node). Never use Math.random for this (not a CSPRNG).
// Index selection uses rejection sampling so every character/word is chosen with
// exactly uniform probability (no modulo bias).

import { EFF_WORDS } from './wordlist';

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 128;

export const CHARSETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>/?~'
} as const;

/** Characters easily confused with each other in many fonts. */
export const AMBIGUOUS = new Set([...'Il1O0o|`\'"{}[]()/\\;:.,']);

export interface PasswordOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
}

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 24,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false
};

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: 6,
  separator: '-',
  capitalize: false,
  includeNumber: false
};

/** Uniform random integer in [0, max) using rejection sampling over 32-bit values. */
export function secureRandomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0x100000000) throw new RangeError('invalid max');
  const limit = Math.floor(0x100000000 / max) * max; // largest multiple of max <= 2^32
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    const v = buf[0]!;
    if (v < limit) {
      buf[0] = 0;
      return v % max;
    }
  }
}

function filtered(set: string, avoidAmbiguous: boolean): string {
  return avoidAmbiguous ? [...set].filter((c) => !AMBIGUOUS.has(c)).join('') : set;
}

export function generatePassword(opts: PasswordOptions): string {
  const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.floor(opts.length)));
  const groups: string[] = [];
  if (opts.upper) groups.push(filtered(CHARSETS.upper, opts.avoidAmbiguous));
  if (opts.lower) groups.push(filtered(CHARSETS.lower, opts.avoidAmbiguous));
  if (opts.digits) groups.push(filtered(CHARSETS.digits, opts.avoidAmbiguous));
  if (opts.symbols) groups.push(filtered(CHARSETS.symbols, opts.avoidAmbiguous));
  if (groups.length === 0) throw new Error('Select at least one character type.');

  const all = groups.join('');
  const out: string[] = [];
  // Guarantee at least one character from each selected group...
  for (const g of groups) out.push(g[secureRandomInt(g.length)]!);
  // ...fill the rest from the full alphabet...
  while (out.length < length) out.push(all[secureRandomInt(all.length)]!);
  // ...then Fisher–Yates shuffle so the guaranteed characters are not positional.
  for (let i = out.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.join('');
}

export function generatePassphrase(opts: PassphraseOptions): string {
  const count = Math.min(20, Math.max(3, Math.floor(opts.words)));
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    let w = EFF_WORDS[secureRandomInt(EFF_WORDS.length)]!;
    if (opts.capitalize) w = w[0]!.toUpperCase() + w.slice(1);
    words.push(w);
  }
  if (opts.includeNumber) {
    const idx = secureRandomInt(words.length);
    words[idx] = words[idx]! + String(secureRandomInt(10));
  }
  return words.join(opts.separator.slice(0, 3));
}

/** Theoretical entropy (bits) of the generator's output — shown in the UI. */
export function passwordEntropyBits(opts: PasswordOptions): number {
  let pool = 0;
  if (opts.upper) pool += filtered(CHARSETS.upper, opts.avoidAmbiguous).length;
  if (opts.lower) pool += filtered(CHARSETS.lower, opts.avoidAmbiguous).length;
  if (opts.digits) pool += filtered(CHARSETS.digits, opts.avoidAmbiguous).length;
  if (opts.symbols) pool += filtered(CHARSETS.symbols, opts.avoidAmbiguous).length;
  return pool ? Math.floor(opts.length * Math.log2(pool)) : 0;
}

export function passphraseEntropyBits(opts: PassphraseOptions): number {
  return Math.floor(opts.words * Math.log2(EFF_WORDS.length) + (opts.includeNumber ? Math.log2(10 * opts.words) : 0));
}
