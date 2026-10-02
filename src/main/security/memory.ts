// SECURITY: best-effort memory hygiene helpers.
//
// Limitation (documented in SECURITY.md): JavaScript strings are immutable and
// garbage-collected, so they cannot be reliably erased. We therefore keep keys and
// password bytes in Buffers/Uint8Arrays (which CAN be overwritten) and wipe them
// as soon as they are no longer needed, and keep the lifetime of plaintext
// strings as short as possible.

import { randomFillSync } from 'node:crypto';

/** Overwrite a buffer with random bytes, then zeros. */
export function wipe(buf: Uint8Array | null | undefined): void {
  if (!buf || buf.length === 0) return;
  try {
    randomFillSync(buf);
  } catch {
    /* ignore */
  }
  buf.fill(0);
}
