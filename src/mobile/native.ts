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
  list(): Promise<{ name: string; size: number }[]>;
  rename(from: string, to: string): Promise<void>;
  /** Free bytes on the device, or null if unknown. */
  freeSpace(): Promise<number | null>;
  /** Binary (base64) file in the private export cache; returns its file:// URI. */
  writeExportBase64(name: string, dataB64: string): Promise<string>;
  /** Open in another app through a temporary content:// grant (explicit user action). */
  openFile(name: string, dataB64: string, mime: string): Promise<void>;
  /** Render PDF pages to JPEG data URLs inside the app. */
  renderPdf(dataB64: string): Promise<{ pages: string[]; total: number }>;
  /** Screenshot / screen-recording protection. */
  setSecure(secure: boolean): Promise<void>;
  /** Write a file into the private cache "exports" folder for the share sheet; returns its file:// URI. */
  writeExport(name: string, data: string): Promise<string>;
  clearExports(): Promise<void>;
  /** Copy to clipboard flagged as sensitive; cleared natively after `seconds` if still ours. */
  copySecret(text: string, seconds: number): Promise<void>;
  clearClipboard(): Promise<void>;
  /** Quick unlock hardware: strong biometrics and (Android 11+) the device passcode. */
  biometricStatus(): Promise<{ available: boolean; biometric: boolean; deviceCredential: boolean }>;
  /** Encrypt with the fingerprint-bound Keystore key (shows the fingerprint prompt). */
  bioEncrypt(dataB64: string): Promise<{ iv: string; data: string }>;
  /** Decrypt with the fingerprint-bound Keystore key (shows the fingerprint prompt). */
  bioDecrypt(iv: string, dataB64: string, mode?: 'any' | 'biometric' | 'credential'): Promise<string>;
  /** Encrypt/decrypt with the device-bound Keystore key (no prompt). */
  deviceEncrypt(dataB64: string): Promise<{ iv: string; data: string }>;
  deviceDecrypt(iv: string, dataB64: string): Promise<string>;
  resetKey(kind: 'biometric' | 'device'): Promise<void>;
  readClipboard(): Promise<string>;
  takeSharedText(): Promise<string | null>;
  /** Delete temporary (unencrypted) camera photos. */
  purgeCaptures(): Promise<void>;
}

interface VaultNativePlugin {
  read(o: { name: string }): Promise<{ data: string | null }>;
  writeAtomic(o: { name: string; data: string }): Promise<void>;
  remove(o: { name: string }): Promise<void>;
  stat(o: { name: string }): Promise<{ exists: boolean; size: number; mtime: number }>;
  list(): Promise<{ files: { name: string; size: number }[] }>;
  rename(o: { from: string; to: string }): Promise<void>;
  freeSpace(): Promise<{ bytes: number }>;
  writeExportBase64(o: { name: string; data: string }): Promise<{ uri: string }>;
  openFile(o: { name: string; data: string; mime: string }): Promise<void>;
  renderPdf(o: { data: string; maxPages?: number; width?: number }): Promise<{ pages: string[]; total: number }>;
  setSecure(o: { secure: boolean }): Promise<void>;
  writeExport(o: { name: string; data: string }): Promise<{ uri: string }>;
  clearExports(): Promise<void>;
  copySecret(o: { text: string; clearAfterSeconds: number }): Promise<void>;
  clearClipboard(): Promise<void>;
  biometricStatus(): Promise<{ available: boolean; biometric?: boolean; deviceCredential?: boolean }>;
  bioEncrypt(o: { data: string }): Promise<{ iv: string; data: string }>;
  bioDecrypt(o: { iv: string; data: string; mode?: string }): Promise<{ data: string }>;
  deviceEncrypt(o: { data: string }): Promise<{ iv: string; data: string }>;
  deviceDecrypt(o: { iv: string; data: string }): Promise<{ data: string }>;
  resetKey(o: { kind: string }): Promise<void>;
  readClipboard(): Promise<{ text: string }>;
  takeSharedText(): Promise<{ text: string | null }>;
  purgeCaptures(): Promise<void>;
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
  list: async () => (await Plugin.list()).files ?? [],
  rename: (from, to) => Plugin.rename({ from, to }),
  freeSpace: async () => {
    const b = (await Plugin.freeSpace()).bytes;
    return typeof b === 'number' && b >= 0 ? b : null;
  },
  writeExportBase64: async (name, data) => (await Plugin.writeExportBase64({ name, data })).uri,
  openFile: (name, data, mime) => Plugin.openFile({ name, data, mime }),
  renderPdf: (data) => Plugin.renderPdf({ data, maxPages: 30, width: 1200 }),
  setSecure: (secure) => Plugin.setSecure({ secure }),
  writeExport: async (name, data) => (await Plugin.writeExport({ name, data })).uri,
  clearExports: () => Plugin.clearExports(),
  copySecret: (text, seconds) => Plugin.copySecret({ text, clearAfterSeconds: seconds }),
  clearClipboard: () => Plugin.clearClipboard(),
  biometricStatus: async () => {
    const s = await Plugin.biometricStatus();
    return { available: s.available, biometric: s.biometric ?? s.available, deviceCredential: s.deviceCredential ?? false };
  },
  bioEncrypt: (data) => Plugin.bioEncrypt({ data }),
  bioDecrypt: async (iv, data, mode = 'any') => (await Plugin.bioDecrypt({ iv, data, mode })).data,
  deviceEncrypt: (data) => Plugin.deviceEncrypt({ data }),
  deviceDecrypt: async (iv, data) => (await Plugin.deviceDecrypt({ iv, data })).data,
  resetKey: (kind) => Plugin.resetKey({ kind }),
  readClipboard: async () => (await Plugin.readClipboard()).text ?? '',
  takeSharedText: async () => (await Plugin.takeSharedText()).text ?? null,
  purgeCaptures: () => Plugin.purgeCaptures()
};
