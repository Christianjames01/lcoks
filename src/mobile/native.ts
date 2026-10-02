// Bridge to the app's own native Android plugin (android/app/src/main/java/.../VaultNativePlugin.java).
//
// Storage lives in the app's PRIVATE internal storage (Context.getFilesDir()),
// which other apps cannot read and which is excluded from Android cloud/device
// backups (allowBackup=false). Writes are atomic: temp file + fsync + rename.

import { registerPlugin } from '@capacitor/core';

export interface NativeVault {
  read(name: string): Promise<string | null>;
  writeAtomic(name: string, data: string): Promise<void>;
  remove(name: string): Promise<void>;
  stat(name: string): Promise<{ size: number; mtime: number } | null>;
  /** Write a file into the private cache "exports" folder for the share sheet; returns its file:// URI. */
  writeExport(name: string, data: string): Promise<string>;
  clearExports(): Promise<void>;
  /** Copy to clipboard flagged as sensitive; cleared natively after `seconds` if still ours. */
  copySecret(text: string, seconds: number): Promise<void>;
  clearClipboard(): Promise<void>;
}

interface VaultNativePlugin {
  read(o: { name: string }): Promise<{ data: string | null }>;
  writeAtomic(o: { name: string; data: string }): Promise<void>;
  remove(o: { name: string }): Promise<void>;
  stat(o: { name: string }): Promise<{ exists: boolean; size: number; mtime: number }>;
  writeExport(o: { name: string; data: string }): Promise<{ uri: string }>;
  clearExports(): Promise<void>;
  copySecret(o: { text: string; clearAfterSeconds: number }): Promise<void>;
  clearClipboard(): Promise<void>;
}

const Plugin = registerPlugin<VaultNativePlugin>('VaultNative');

export const capacitorNative: NativeVault = {
  read: async (name) => (await Plugin.read({ name })).data ?? null,
  writeAtomic: (name, data) => Plugin.writeAtomic({ name, data }),
  remove: (name) => Plugin.remove({ name }),
  stat: async (name) => {
    const s = await Plugin.stat({ name });
    return s.exists ? { size: s.size, mtime: s.mtime } : null;
  },
  writeExport: async (name, data) => (await Plugin.writeExport({ name, data })).uri,
  clearExports: () => Plugin.clearExports(),
  copySecret: (text, seconds) => Plugin.copySecret({ text, clearAfterSeconds: seconds }),
  clearClipboard: () => Plugin.clearClipboard()
};
