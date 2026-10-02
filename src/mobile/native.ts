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
  /** Strong biometric (fingerprint) hardware present and enrolled. */
  biometricAvailable(): Promise<boolean>;
  /** Encrypt with the fingerprint-bound Keystore key (shows the fingerprint prompt). */
  bioEncrypt(dataB64: string): Promise<{ iv: string; data: string }>;
  /** Decrypt with the fingerprint-bound Keystore key (shows the fingerprint prompt). */
  bioDecrypt(iv: string, dataB64: string): Promise<string>;
  /** Encrypt/decrypt with the device-bound Keystore key (no prompt). */
  deviceEncrypt(dataB64: string): Promise<{ iv: string; data: string }>;
  deviceDecrypt(iv: string, dataB64: string): Promise<string>;
  resetKey(kind: 'biometric' | 'device'): Promise<void>;
  readClipboard(): Promise<string>;
  takeSharedText(): Promise<string | null>;
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
  biometricStatus(): Promise<{ available: boolean }>;
  bioEncrypt(o: { data: string }): Promise<{ iv: string; data: string }>;
  bioDecrypt(o: { iv: string; data: string }): Promise<{ data: string }>;
  deviceEncrypt(o: { data: string }): Promise<{ iv: string; data: string }>;
  deviceDecrypt(o: { iv: string; data: string }): Promise<{ data: string }>;
  resetKey(o: { kind: string }): Promise<void>;
  readClipboard(): Promise<{ text: string }>;
  takeSharedText(): Promise<{ text: string | null }>;
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
  clearClipboard: () => Plugin.clearClipboard(),
  biometricAvailable: async () => (await Plugin.biometricStatus()).available,
  bioEncrypt: (data) => Plugin.bioEncrypt({ data }),
  bioDecrypt: async (iv, data) => (await Plugin.bioDecrypt({ iv, data })).data,
  deviceEncrypt: (data) => Plugin.deviceEncrypt({ data }),
  deviceDecrypt: async (iv, data) => (await Plugin.deviceDecrypt({ iv, data })).data,
  resetKey: (kind) => Plugin.resetKey({ kind }),
  readClipboard: async () => (await Plugin.readClipboard()).text ?? '',
  takeSharedText: async () => (await Plugin.takeSharedText()).text ?? null
};
