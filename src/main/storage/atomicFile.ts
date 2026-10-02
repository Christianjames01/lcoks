// Crash-safe file writes.
//
// The vault is written to a temporary file in the same directory, fsync'd, and
// then atomically renamed over the original. If the app crashes or the disk
// write is interrupted mid-way, the previous vault file remains intact.

import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const TMP_SUFFIX = '.tmp';

export async function writeFileAtomic(target: string, data: Buffer): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${randomBytes(6).toString('hex')}${TMP_SUFFIX}`);
  // 0o600: owner read/write only (honoured on POSIX; Windows uses the profile ACLs).
  const handle = await fs.open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** On Windows, antivirus/indexers can briefly lock files; retry a few times. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e: any) {
      lastErr = e;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(e?.code)) throw e;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Remove leftover temp files from an interrupted write. */
export async function cleanupTempFiles(target: string): Promise<void> {
  const dir = path.dirname(target);
  const prefix = `.${path.basename(target)}.`;
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((n) => n.startsWith(prefix) && n.endsWith(TMP_SUFFIX))
      .map((n) => fs.rm(path.join(dir, n), { force: true }).catch(() => undefined))
  );
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
