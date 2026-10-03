// Android implementation of the VaultApi that the React UI talks to (on desktop
// the same API is provided by the Electron preload). Both platforms run the same
// vault core (src/core/vault.ts). Errors are mapped to safe, user-facing
// messages exactly like the desktop IPC layer.

import { App } from '@capacitor/app';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';
import { PLAINTEXT_CONFIRM_PHRASE, type QuickUnlockStatus, type VaultApi } from '../shared/api';
import type { BackupSummary, Result } from '../shared/types';
import { ValidationError, validateMasterPassword } from '../core/schema';
import { AppError, VaultCore, type OpenedBackup } from '../core/vault';
import type { NativeVault } from './native';
import { NativeStorage } from './nativeStorage';
import { QuickUnlock } from './quickUnlock';

/** Backups carry attachments; the cap keeps a huge file from exhausting memory. */
const MAX_IMPORT_BYTES = 300 * 1024 * 1024;

function toError(e: unknown): Result<never> {
  if (e instanceof AppError) return { ok: false, code: e.code, message: e.userMessage };
  if (e instanceof ValidationError) return { ok: false, code: `VALIDATION:${e.field}`, message: e.userMessage };
  return { ok: false, code: 'INTERNAL', message: 'Something went wrong. Your vault data has not been changed.' };
}

async function wrap<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return toError(e);
  }
}

const REMINDER_CHANNEL = 'reminders';
let channelReady = false;
async function ensureChannel(): Promise<void> {
  if (channelReady) return;
  await LocalNotifications.createChannel({ id: REMINDER_CHANNEL, name: 'Reminders', description: 'Expiry, renewal and payment reminders', importance: 4, visibility: 0 });
  channelReady = true;
}

function nativeCode(e: unknown): string {
  return typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
}

/** File names the native export cache accepts. */
function exportName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-100);
  return clean || 'attachment';
}

export function createMobileApi(native: NativeVault): VaultApi {
  const vault = new VaultCore(new NativeStorage(native));
  const quick = new QuickUnlock(native, vault);
  const pending = new Map<string, { name: string; raw: string; decrypted?: OpenedBackup }>();
  let lastActivity = Date.now();
  let backgroundSince: number | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  // The share sheet / file picker put the app in the background; don't lock for that.
  let externalUiOpen = false;

  // The lock screen is always protected from screenshots; once unlocked, the user's setting applies.
  const applySecure = () => void native.setSecure(!vault.isUnlocked || vault.settings.screenshotProtection).catch(() => undefined);

  const lock = () => {
    const was = vault.isUnlocked;
    vault.lock();
    pending.clear();
    if (idleTimer) clearTimeout(idleTimer);
    void native.clearClipboard().catch(() => undefined);
    void native.clearExports().catch(() => undefined);
    // Reloading discards the whole JS heap, including any revealed secrets.
    if (was) window.location.reload();
  };

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    const minutes = vault.settings.autoLockMinutes;
    if (vault.isUnlocked && minutes > 0) idleTimer = setTimeout(lock, minutes * 60_000);
  };

  const unlocked = () => {
    lastActivity = Date.now();
    armIdle();
    applySecure();
  };

  // ---- Android lifecycle -----------------------------------------------------
  // Lock when the app goes to the background: immediately or after the chosen delay.
  void App.addListener('pause', () => {
    if (!vault.isUnlocked || externalUiOpen) return;
    if (vault.settings.backgroundLockMinutes === 0) lock();
    else backgroundSince = Date.now();
  });
  void App.addListener('resume', () => {
    const since = backgroundSince;
    backgroundSince = null;
    if (!vault.isUnlocked || externalUiOpen) return;
    const bg = vault.settings.backgroundLockMinutes;
    if (since !== null && bg > 0 && Date.now() - since >= bg * 60_000) return lock();
    // JS timers may not run in the background — enforce auto-lock on return.
    const minutes = vault.settings.autoLockMinutes;
    if (minutes > 0 && Date.now() - lastActivity > minutes * 60_000) lock();
  });
  void App.addListener('backButton', () => {
    const dialogs = document.querySelectorAll<HTMLElement>('.dialog, .viewer');
    if (dialogs.length) {
      dialogs[dialogs.length - 1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    const ev = new CustomEvent('vault:back', { cancelable: true });
    window.dispatchEvent(ev);
    if (!ev.defaultPrevented) void App.minimizeApp();
  });

  const withExternalUi = async <T>(fn: () => Promise<T>): Promise<T> => {
    externalUiOpen = true;
    try {
      return await fn();
    } finally {
      lastActivity = Date.now();
      setTimeout(() => (externalUiOpen = false), 1500);
    }
  };

  const shareFile = async (name: string, data: string, title: string) => {
    await native.clearExports();
    const uri = await native.writeExport(name, data);
    await withExternalUi(() => Share.share({ title, dialogTitle: title, files: [uri] }).then(() => undefined));
  };

  const pickFile = () =>
    withExternalUi(
      () =>
        new Promise<File | null>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '*/*';
          input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
          input.addEventListener('cancel', () => resolve(null), { once: true });
          input.click();
        })
    );

  const requireUnlocked = () => {
    if (!vault.isUnlocked) throw new AppError('LOCKED', 'The vault is locked.');
  };
  const getPending = (token: unknown) => {
    const p = typeof token === 'string' ? pending.get(token) : undefined;
    if (!p) throw new AppError('EXPIRED', 'This file selection has expired. Please choose the file again.');
    return p;
  };
  const attachmentMeta = (entryId: string, id: string) => {
    const meta = vault.listAttachments(entryId).find((a) => a.id === id);
    if (!meta) throw new AppError('NOT_FOUND', 'Attachment not found.');
    return meta;
  };

  // Remove leftover share files (e.g. a plaintext export) and camera photos from previous sessions.
  applySecure();
  void native.clearExports().catch(() => undefined);
  void native.purgeCaptures().catch(() => undefined);

  return {
    app: {
      async getState() {
        const exists = await vault.exists();
        let version = '';
        try {
          version = (await App.getInfo()).version;
        } catch {
          /* ignore */
        }
        return {
          status: vault.isUnlocked ? 'unlocked' : exists ? 'locked' : 'no-vault',
          hasHint: exists ? (await vault.getHint()) !== null : false,
          platform: 'android',
          version
        };
      },
      getHint: () => wrap(() => vault.getHint()),
      readClipboardText: () =>
        wrap(async () => {
          requireUnlocked();
          return (await native.readClipboard()).slice(0, 1_000_000);
        }),
      takeSharedText: async () => {
        try {
          return await native.takeSharedText();
        } catch {
          return null;
        }
      },
      suspendAutoLock(on: boolean) {
        if (on) {
          externalUiOpen = true;
          return;
        }
        lastActivity = Date.now();
        setTimeout(() => (externalUiOpen = false), 1500);
        // The camera wrote an unencrypted photo to app storage: delete it now.
        void native.purgeCaptures().catch(() => undefined);
      },
      setAppearance(dark: boolean) {
        void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
      },
      reportActivity() {
        lastActivity = Date.now();
        armIdle();
      },
      openExternal: (url) =>
        wrap(async () => {
          let parsed: URL;
          try {
            parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
          } catch {
            throw new AppError('INVALID', 'Invalid link.');
          }
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new AppError('INVALID', 'Only web links can be opened.');
          await withExternalUi(() => AppLauncher.openUrl({ url: parsed.toString() }).then(() => undefined));
        })
    },
    auth: {
      create: (pw, hint) =>
        wrap(async () => {
          await vault.create(validateMasterPassword(pw), hint);
          await quick.disableAll();
          unlocked();
        }),
      unlock: (pw) =>
        wrap(async () => {
          await vault.unlock(validateMasterPassword(pw));
          unlocked();
        }),
      lock: async () => lock(),
      changePassword: (cur, next, hint) =>
        wrap(async () => {
          await vault.changePassword(validateMasterPassword(cur, 'current'), validateMasterPassword(next, 'next'), hint);
          // The wrapped key belongs to the old password: require re-enrollment.
          await quick.disableAll();
        })
    },
    vault: {
      snapshot: () => wrap(() => vault.snapshot()),
      saveEntry: (i) => wrap(() => vault.saveEntry(i)),
      importEntries: (inputs) => wrap(async () => ({ count: await vault.importEntries(inputs) })),
      deleteEntry: (id) => wrap(() => vault.deleteEntry(id)),
      restoreEntry: (id) => wrap(() => vault.restoreEntry(id)),
      purgeEntry: (id) => wrap(() => vault.purgeEntry(id)),
      emptyTrash: () => wrap(() => vault.emptyTrash()),
      findDuplicates: () => wrap(() => vault.findDuplicates()),
      mergeEntries: (keepId, otherIds) => wrap(() => vault.mergeEntries(keepId, otherIds)),
      dismissDuplicate: (key) => wrap(() => vault.dismissDuplicate(key)),
      duplicateEntry: (id) => wrap(() => vault.duplicateEntry(id)),
      setFavorite: (id, f) => wrap(() => vault.setFavorite(id, f === true)),
      reorderFavorites: (ids) => wrap(() => vault.reorderFavorites(ids)),
      getForEdit: (id) => wrap(() => vault.getEntryForEdit(id)),
      reveal: (id, key) => wrap(() => vault.getSecret(id, key)),
      copyField: (id, key) =>
        wrap(async () => {
          const value = vault.getSecret(id, key);
          if (!value) throw new AppError('EMPTY', 'Nothing to copy.');
          const seconds = Math.min(120, Math.max(10, vault.settings.clipboardClearSeconds));
          await native.copySecret(value, seconds);
          return { seconds };
        }),
      copyText: (text) =>
        wrap(async () => {
          requireUnlocked();
          if (typeof text !== 'string' || !text || text.length > 200_000) throw new AppError('EMPTY', 'Nothing to copy.');
          const seconds = Math.min(120, Math.max(10, vault.settings.clipboardClearSeconds));
          await native.copySecret(text, seconds);
          return { seconds };
        }),
      saveCategory: (i) => wrap(() => vault.saveCategory(i)),
      deleteCategory: (id) => wrap(() => vault.deleteCategory(id)),
      updateSettings: (patch) =>
        wrap(async () => {
          const s = await vault.updateSettings(patch);
          armIdle();
          applySecure();
          return s;
        }),
      databaseInfo: () => wrap(() => vault.databaseInfo()),
      showVaultFolder: async () => undefined
    },
    attachments: {
      list: (entryId) => wrap(() => vault.listAttachments(entryId)),
      add: (entryId, input) => wrap(() => vault.addAttachment(entryId, input)),
      read: (entryId, id) => wrap(() => vault.readAttachment(entryId, id)),
      update: (entryId, id, patch) => wrap(() => vault.updateAttachment(entryId, id, patch)),
      remove: (entryId, id) => wrap(() => vault.deleteAttachment(entryId, id)),
      storageInfo: () => wrap(() => vault.storageInfo()),
      /** SECURITY: explicit export only, through the Android share sheet. */
      exportFile: (entryId, id) =>
        wrap(async () => {
          const meta = attachmentMeta(entryId, id);
          const data = await vault.readAttachment(entryId, id);
          await native.clearExports();
          const name = exportName(meta.name);
          const uri = await native.writeExportBase64(name, data);
          await withExternalUi(() => Share.share({ title: meta.name, dialogTitle: 'Export attachment', files: [uri] }).then(() => undefined));
          // The decrypted copy is removed from the private cache shortly after sharing.
          setTimeout(() => void native.clearExports().catch(() => undefined), 60_000);
          return name;
        }),
      openWith: (entryId, id) =>
        wrap(async () => {
          const meta = attachmentMeta(entryId, id);
          const data = await vault.readAttachment(entryId, id);
          await native.clearExports();
          try {
            await withExternalUi(() => native.openFile(exportName(meta.name), data, meta.mime || 'application/octet-stream'));
          } catch (e) {
            throw new AppError('OPEN_FAILED', nativeCode(e) === 'NO_APP' ? 'No app on this phone can open this file type.' : 'Could not open the file.');
          }
          // The temporary decrypted copy is deleted on lock, next export, or after 5 minutes.
          setTimeout(() => void native.clearExports().catch(() => undefined), 5 * 60_000);
        }),
      renderPdf: (entryId, id) =>
        wrap(async () => {
          attachmentMeta(entryId, id);
          const data = await vault.readAttachment(entryId, id);
          try {
            return (await native.renderPdf(data)).pages;
          } catch (e) {
            throw new AppError(
              'PDF_FAILED',
              nativeCode(e) === 'PDF_LOCKED' ? 'This PDF is password protected. Use "Open with" to view it.' : 'This PDF could not be displayed. Use "Open with" instead.'
            );
          }
        })
    },
    notifications: {
      status: async () => {
        try {
          const p = (await LocalNotifications.checkPermissions()).display;
          return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
        } catch {
          return 'unsupported';
        }
      },
      request: async () => {
        try {
          // The system permission dialog briefly backgrounds the app: don't lock for that.
          const p = (await withExternalUi(() => LocalNotifications.requestPermissions())).display;
          return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
        } catch {
          return 'unsupported';
        }
      },
      schedule: (items) =>
        wrap(async () => {
          requireUnlocked();
          if (!Array.isArray(items) || items.length > 100) throw new AppError('INVALID', 'Invalid reminders.');
          await ensureChannel();
          const pending = await LocalNotifications.getPending();
          if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
          if ((await LocalNotifications.checkPermissions()).display !== 'granted') return 0;
          const now = Date.now();
          const list = items
            .filter((r) => Number.isInteger(r.id) && r.id > 0 && r.id < 2 ** 31 && Number.isFinite(r.at) && r.at > now)
            .map((r) => ({
              id: r.id,
              title: String(r.title).slice(0, 120),
              body: String(r.body).slice(0, 240),
              channelId: REMINDER_CHANNEL,
              smallIcon: 'ic_stat_vault',
              iconColor: '#0A84FF',
              schedule: { at: new Date(r.at), allowWhileIdle: true }
            }));
          if (list.length) await LocalNotifications.schedule({ notifications: list });
          return list.length;
        }),
      test: () =>
        wrap(async () => {
          if ((await LocalNotifications.checkPermissions()).display !== 'granted') {
            throw new AppError('NO_PERMISSION', 'Allow notifications for VaultLocks first.');
          }
          await ensureChannel();
          await LocalNotifications.schedule({
            notifications: [
              {
                id: 7,
                title: 'Netflix: renews tomorrow',
                body: 'This is how VaultLocks reminders look.',
                channelId: REMINDER_CHANNEL,
                smallIcon: 'ic_stat_vault',
                iconColor: '#0A84FF',
                schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true }
              }
            ]
          });
        })
    },
    backup: {
      create: () =>
        wrap(async () => {
          requireUnlocked();
          const name = `vault-backup-${new Date().toISOString().slice(0, 10)}.vault`;
          const data = await vault.buildBackup();
          const verified = await vault.verifyBackup(data);
          if (!verified) throw new AppError('BACKUP_VERIFY_FAILED', 'The backup could not be verified. Please try again.');
          await shareFile(name, data, 'Save encrypted backup');
          await vault.markBackup(true);
          return { path: name, verified: true };
        }),
      chooseDirectory: () => wrap(async () => null),
      pickFile: () =>
        wrap(async () => {
          const file = await pickFile();
          if (!file) return null;
          if (file.size > MAX_IMPORT_BYTES) throw new AppError('INVALID_BACKUP', 'This file is too large to be a backup.');
          const token = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
          pending.set(token, { name: file.name, raw: await file.text() });
          return { token, fileName: file.name };
        }),
      open: (token, password) =>
        wrap(async (): Promise<BackupSummary> => {
          requireUnlocked();
          const p = getPending(token);
          const opened = await VaultCore.decryptFile(p.raw, validateMasterPassword(password));
          p.decrypted = opened;
          const { payload, file } = opened;
          return { token, fileName: p.name, itemCount: payload.entries.length, categoryCount: payload.customCategories.length, createdAt: file.createdAt, kind: file.kind };
        }),
      apply: (token, mode) =>
        wrap(async () => {
          const p = getPending(token);
          if (!p.decrypted) throw new AppError('NOT_VERIFIED', 'Open and verify the backup first.');
          if (mode !== 'replace' && mode !== 'merge') throw new AppError('INVALID', 'Invalid restore mode.');
          await vault.applyBackup(p.decrypted, mode);
          pending.delete(token);
        }),
      discard: async (token) => void pending.delete(token),
      restoreWhileLocked: (token, password) =>
        wrap(async () => {
          const p = getPending(token);
          await vault.restoreWhileLocked(p.raw, validateMasterPassword(password));
          await quick.disableAll();
          pending.delete(token);
          unlocked();
        }),
      exportPlaintext: (password, phrase) =>
        wrap(async () => {
          if (phrase !== PLAINTEXT_CONFIRM_PHRASE) throw new ValidationError('phrase', `Type ${PLAINTEXT_CONFIRM_PHRASE} to confirm.`);
          if (!(await vault.verifyPassword(validateMasterPassword(password)))) throw new ValidationError('password', 'Incorrect master password.');
          const name = `vault-PLAINTEXT-${new Date().toISOString().slice(0, 10)}.json`;
          await shareFile(name, JSON.stringify(vault.plaintextExport(), null, 2), 'Save UNENCRYPTED export');
          // Remove the plaintext copy from the app cache shortly after sharing.
          setTimeout(() => void native.clearExports().catch(() => undefined), 60_000);
          return name;
        })
    },
    quick: {
      status: (): Promise<QuickUnlockStatus> => quick.status(),
      enableBiometric: (master) =>
        wrap(() => withExternalUi(() => quick.enableBiometric(validateMasterPassword(master, 'master')))),
      enablePin: (master, pin) => wrap(() => quick.enablePin(validateMasterPassword(master, 'master'), pin)),
      disable: (kind) => wrap(() => (kind === 'biometric' ? quick.disableBiometric() : quick.disablePin())),
      unlockBiometric: (mode) =>
        wrap(async () => {
          await withExternalUi(() => quick.unlockBiometric(mode === 'credential' ? 'credential' : 'biometric'));
          unlocked();
        }),
      unlockPin: (pin) =>
        wrap(async () => {
          await quick.unlockPin(pin);
          unlocked();
        })
    },
    events: {
      onCommand: () => () => undefined
    }
  };
}
