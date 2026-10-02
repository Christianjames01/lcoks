// Android implementation of the VaultApi that the React UI talks to (on desktop
// the same API is provided by the Electron preload). Errors are mapped to safe,
// user-facing messages exactly like the desktop IPC layer.

import { App } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { Share } from '@capacitor/share';
import { PLAINTEXT_CONFIRM_PHRASE, type VaultApi } from '../shared/api';
import type { BackupSummary, Result, VaultPayload } from '../shared/types';
import { ValidationError, validateMasterPassword } from '../main/vault/schema';
import { AppError, MobileVault } from './mobileVault';
import type { NativeVault } from './native';

const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

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

export function createMobileApi(native: NativeVault): VaultApi {
  const vault = new MobileVault(native);
  const pending = new Map<string, { name: string; raw: string; decrypted?: VaultPayload }>();
  let lastActivity = Date.now();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  // The share sheet / file picker put the app in the background; don't lock for that.
  let externalUiOpen = false;

  const lock = () => {
    const was = vault.isUnlocked;
    vault.lock();
    pending.clear();
    if (idleTimer) clearTimeout(idleTimer);
    void native.clearClipboard().catch(() => undefined);
    // Reloading discards the whole JS heap, including any revealed secrets.
    if (was) window.location.reload();
  };

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    const minutes = vault.settings.autoLockMinutes;
    if (vault.isUnlocked && minutes > 0) idleTimer = setTimeout(lock, minutes * 60_000);
  };

  // ---- Android lifecycle -----------------------------------------------------
  void App.addListener('pause', () => {
    if (vault.isUnlocked && vault.settings.lockOnMinimize && !externalUiOpen) lock();
  });
  void App.addListener('resume', () => {
    // JS timers may not run in the background — enforce auto-lock on return.
    const minutes = vault.settings.autoLockMinutes;
    if (vault.isUnlocked && minutes > 0 && Date.now() - lastActivity > minutes * 60_000 && !externalUiOpen) lock();
  });
  void App.addListener('backButton', () => {
    const dialogs = document.querySelectorAll<HTMLElement>('.dialog');
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

  // Remove leftover share files (e.g. a plaintext export) from previous sessions.
  void native.clearExports().catch(() => undefined);

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
          armIdle();
        }),
      unlock: (pw) =>
        wrap(async () => {
          await vault.unlock(validateMasterPassword(pw));
          lastActivity = Date.now();
          armIdle();
        }),
      lock: async () => lock(),
      changePassword: (cur, next, hint) =>
        wrap(() => vault.changePassword(validateMasterPassword(cur, 'current'), validateMasterPassword(next, 'next'), hint))
    },
    vault: {
      snapshot: () => wrap(() => vault.snapshot()),
      saveEntry: (i) => wrap(() => vault.saveEntry(i)),
      deleteEntry: (id) => wrap(() => vault.deleteEntry(id)),
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
          return s;
        }),
      databaseInfo: () => wrap(() => vault.databaseInfo()),
      showVaultFolder: async () => undefined
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
          const { payload, file } = await MobileVault.decryptFile(p.raw, validateMasterPassword(password));
          p.decrypted = payload;
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
          pending.delete(token);
          lastActivity = Date.now();
          armIdle();
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
    events: {
      onCommand: () => () => undefined
    }
  };
}
