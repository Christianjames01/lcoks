// Bridge to the app's own native Android plugin (android/app/src/main/java/.../VaultNativePlugin.java).
//
// Storage lives in the app's PRIVATE internal storage (Context.getFilesDir()),
// which other apps cannot read and which is excluded from Android cloud/device
// backups (allowBackup=false). Writes are atomic: temp file + fsync + rename.

import { registerPlugin } from '@capacitor/core';
import type { PhoneCalendarInfo, PhoneCalendarItem } from '../shared/phoneCalendar';

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
  /** Ongoing "Add expense" notification (encrypts replies to inbox.pub natively, see QuickAdd.java). */
  quickAddNotification(): Promise<boolean>;
  setQuickAddNotification(on: boolean): Promise<void>;
  /** Android: may VaultLocks write its own device-only calendar (for the phone's calendar widgets)? */
  phoneCalendarStatus(): Promise<boolean>;
  requestPhoneCalendar(): Promise<boolean>;
  /** on: replace the VaultLocks calendar with these items; off: delete it. */
  /** Returns how many were written and the calendar Android really used (0 = VaultLocks' own; null on iPhone). */
  syncPhoneCalendar(on: boolean, items: PhoneCalendarItem[], target?: number): Promise<{ count: number; target: number | null }>;
  openPhoneCalendar(): Promise<void>;
  listPhoneCalendars(): Promise<PhoneCalendarInfo[]>;
  /** Double tap on the back of the phone → add-expense pop-up (KnockService.java). */
  knockStatus(): Promise<KnockStatus>;
  setKnock(on: boolean, sensitivity: number): Promise<void>;
  /** Open the add-expense pop-up now. */
  openQuickAdd(): Promise<void>;
  openQuickAddPermissions(which: 'overlay' | 'fullscreen' | 'app'): Promise<void>;
  /** Tell the native side whether the vault is unlocked (a double tap then opens the in-app form). */
  setVaultState(unlocked: boolean): Promise<void>;
  /** Double tap while VaultLocks is open and unlocked. */
  onQuickAdd(cb: (cash: boolean) => void): void;
}

export interface KnockStatus {
  on: boolean;
  /** 0 low · 1 normal · 2 high */
  sensitivity: number;
  /** "Display over other apps" granted: the pop-up can open straight away. */
  canPopUp: boolean;
  /** Android 14+: full-screen notifications allowed (pop-up on the lock screen without overlay permission). */
  fullScreen: boolean;
  xiaomi: boolean;
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
  quickAddNotification(): Promise<{ on: boolean }>;
  setQuickAddNotification(o: { on: boolean }): Promise<void>;
  phoneCalendarStatus(): Promise<{ granted: boolean }>;
  requestPhoneCalendar(): Promise<{ granted: boolean }>;
  syncPhoneCalendar(o: { on: boolean; items: PhoneCalendarItem[]; target?: number }): Promise<{ count?: number; target?: number }>;
  openPhoneCalendar(): Promise<void>;
  listPhoneCalendars(): Promise<{ calendars?: PhoneCalendarInfo[] }>;
  knockStatus(): Promise<KnockStatus>;
  setKnock(o: { on: boolean; sensitivity: number }): Promise<void>;
  openQuickAdd(): Promise<void>;
  openQuickAddPermissions(o: { which: string }): Promise<void>;
  setVaultState(o: { unlocked: boolean }): Promise<void>;
  addListener(event: 'quickAdd', cb: (data: { cash?: boolean }) => void): Promise<unknown>;
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
  purgeCaptures: () => Plugin.purgeCaptures(),
  quickAddNotification: async () => (await Plugin.quickAddNotification()).on === true,
  setQuickAddNotification: (on) => Plugin.setQuickAddNotification({ on }),
  phoneCalendarStatus: async () => (await Plugin.phoneCalendarStatus()).granted === true,
  requestPhoneCalendar: async () => (await Plugin.requestPhoneCalendar()).granted === true,
  syncPhoneCalendar: async (on, items, target) => {
    const r = await Plugin.syncPhoneCalendar({ on, items, target: target ?? 0 });
    return { count: r.count ?? 0, target: typeof r.target === 'number' ? r.target : null };
  },
  listPhoneCalendars: async () => (await Plugin.listPhoneCalendars()).calendars ?? [],
  openPhoneCalendar: () => Plugin.openPhoneCalendar(),
  knockStatus: () => Plugin.knockStatus(),
  setKnock: (on, sensitivity) => Plugin.setKnock({ on, sensitivity }),
  openQuickAdd: () => Plugin.openQuickAdd(),
  openQuickAddPermissions: (which) => Plugin.openQuickAddPermissions({ which }),
  setVaultState: (unlocked) => Plugin.setVaultState({ unlocked }),
  onQuickAdd: (cb) => void Plugin.addListener('quickAdd', (d) => cb(d?.cash === true))
};
