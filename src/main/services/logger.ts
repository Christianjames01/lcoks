// SECURITY: diagnostic logger that cannot leak secrets.
//
// Callers may only log an event NAME plus a small set of allow-listed,
// non-sensitive metadata keys with primitive values. Free-form strings, error
// messages and stack traces are never written, because they could contain user
// data. Passwords, keys, field values, titles and search queries are never
// accepted.

import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import path from 'node:path';

const ALLOWED_META = new Set(['code', 'count', 'mode', 'reason', 'ok', 'seconds', 'minutes', 'kind']);
const MAX_LOG_BYTES = 512 * 1024;

export type LogMeta = Record<string, string | number | boolean>;

let logFile: string | null = null;

export function initLogger(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'vaultlocks.log');
  } catch {
    logFile = null;
  }
}

/** Keep only allow-listed keys; strings are restricted to short [A-Z0-9_-] codes. */
export function sanitizeMeta(meta: LogMeta | undefined): LogMeta {
  const out: LogMeta = {};
  if (!meta) return out;
  for (const [k, v] of Object.entries(meta)) {
    if (!ALLOWED_META.has(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v)) out[k] = v;
  }
  return out;
}

export function formatLine(event: string, meta?: LogMeta): string {
  const safeEvent = /^[a-z0-9_.-]{1,60}$/i.test(event) ? event : 'invalid_event';
  return `${new Date().toISOString()} ${safeEvent} ${JSON.stringify(sanitizeMeta(meta))}\n`;
}

export function log(event: string, meta?: LogMeta): void {
  const line = formatLine(event, meta);
  if (process.env.NODE_ENV === 'development') process.stdout.write(line);
  if (!logFile) return;
  try {
    try {
      if (statSync(logFile).size > MAX_LOG_BYTES) renameSync(logFile, logFile + '.1');
    } catch {
      /* file may not exist yet */
    }
    appendFileSync(logFile, line, { mode: 0o600 });
  } catch {
    /* logging must never crash the app */
  }
}
