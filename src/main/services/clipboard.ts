// SECURITY-SENSITIVE: clipboard handling.
//
// Secrets are copied by the main process (the renderer never needs the value to
// copy it). We remember only a SHA-256 fingerprint of what we copied — not the
// value itself — and clear the clipboard after the timeout ONLY if it still
// contains our value (so we never wipe something the user copied afterwards).
//
// On Windows we additionally attach the "ExcludeClipboardContentFromMonitorProcessing"
// format, which tells Windows Clipboard History (Win+V) and Cloud Clipboard sync
// not to record the value.

import { createHash } from 'node:crypto';

export interface ClipboardLike {
  /** Write text, marking it as sensitive where the platform supports it. */
  writeSecret(text: string): Promise<void>;
  readText(): Promise<string>;
  clear(): void;
}

function fingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export class ClipboardManager {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private copiedHash: string | null = null;

  constructor(private readonly clipboard: ClipboardLike) {}

  /** Copy a value and schedule automatic clearing. Returns the timeout used. */
  async copySecret(value: string, clearAfterSeconds: number): Promise<number> {
    const seconds = Math.min(120, Math.max(10, Math.floor(clearAfterSeconds)));
    this.cancelTimer();
    await this.clipboard.writeSecret(value);
    this.copiedHash = fingerprint(value);
    this.timer = setTimeout(() => void this.clearIfOurs(), seconds * 1000);
    return seconds;
  }

  /** Clear the clipboard if it still holds the value we put there. */
  async clearIfOurs(): Promise<void> {
    this.cancelTimer();
    const expected = this.copiedHash;
    if (!expected) return;
    this.copiedHash = null;
    try {
      if (fingerprint(await this.clipboard.readText()) === expected) this.clipboard.clear();
    } catch {
      /* clipboard unavailable — nothing more we can do */
    }
  }

  get pending(): boolean {
    return this.copiedHash !== null;
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Adapter for Electron's (async, W3C-style) clipboard module. */
export function electronClipboard(cb: Electron.Clipboard, ItemCtor: typeof Electron.ClipboardItem, platform: string): ClipboardLike {
  const EXCLUDE = 'electron application/osclipboard;format="ExcludeClipboardContentFromMonitorProcessing"';
  return {
    async writeSecret(text) {
      if (platform === 'win32') {
        try {
          // Windows only checks for the format's presence; the conventional payload is a
          // zero DWORD. (An empty payload is silently dropped by Electron, so use 4 bytes.)
          await cb.write([new ItemCtor({ 'text/plain': text, [EXCLUDE]: new Blob([new Uint8Array(4)]) })]);
          return;
        } catch {
          /* fall back to plain text below */
        }
      }
      await cb.writeText(text);
    },
    readText: () => cb.readText(),
    clear: () => cb.clear()
  };
}
