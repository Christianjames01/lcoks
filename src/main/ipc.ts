// IPC boundary between the (untrusted) renderer and the main process.
//
// SECURITY:
//  * Every handler checks that the message comes from our own app page.
//  * Every argument is validated here or in the service layer.
//  * Errors are converted to { code, message } with SAFE messages only — no stack
//    traces, crypto details or user data ever cross back to the renderer or logs.

import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { PLAINTEXT_CONFIRM_PHRASE } from '../shared/api';
import type { AppState, Result } from '../shared/types';
import { AutoLockTimer } from './services/autoLock';
import { ClipboardManager } from './services/clipboard';
import { log } from './services/logger';
import { writeFileAtomic } from './storage/atomicFile';
import { BackupService, backupFileName } from './vault/backupService';
import { ValidationError, validateMasterPassword } from './vault/schema';
import { VaultError, VaultService } from './vault/vaultService';

export interface IpcDeps {
  vault: VaultService;
  backups: BackupService;
  clipboard: ClipboardManager;
  autoLock: AutoLockTimer;
  getWindow(): BrowserWindow | null;
  isTrustedSender(event: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean;
  onUnlocked(): void;
  lockNow(reason: string): void;
  onSettingsChanged(): void;
}

function toError(e: unknown): Result<never> {
  if (e instanceof VaultError) {
    log('ipc.error', { code: e.code });
    return { ok: false, code: e.code, message: e.userMessage };
  }
  if (e instanceof ValidationError) {
    log('ipc.validation', { code: 'VALIDATION' });
    return { ok: false, code: `VALIDATION:${e.field}`, message: e.userMessage };
  }
  // Unknown error: do NOT forward its message/stack (could contain anything).
  log('ipc.internal_error', { code: 'INTERNAL' });
  return { ok: false, code: 'INTERNAL', message: 'Something went wrong. Your vault data has not been changed.' };
}

export function registerIpc(d: IpcDeps): void {
  const handle = <A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!d.isTrustedSender(event)) {
        log('ipc.rejected_sender');
        return { ok: false, code: 'FORBIDDEN', message: 'Forbidden.' } satisfies Result<never>;
      }
      try {
        return { ok: true, value: await fn(...(args as A)) } satisfies Result<T>;
      } catch (e) {
        return toError(e);
      }
    });
  };

  const settings = () => d.vault.settings;

  // ------------------------------------------------------------------ app ----
  ipcMain.handle('app.getState', async (event): Promise<AppState | null> => {
    if (!d.isTrustedSender(event)) return null;
    const exists = await d.vault.vaultExists();
    return {
      status: d.vault.isUnlocked ? 'unlocked' : exists ? 'locked' : 'no-vault',
      hasHint: exists ? (await d.vault.getHint()) !== null : false,
      platform: process.platform,
      version: app.getVersion()
    };
  });
  handle('app.getHint', () => d.vault.getHint());
  ipcMain.on('app.activity', (event) => {
    if (d.isTrustedSender(event) && d.vault.isUnlocked) d.autoLock.reset();
  });
  handle('app.openExternal', async (url: unknown) => {
    // Only http(s) links stored by the user, opened in the system browser.
    if (typeof url !== 'string' || url.length > 2048) throw new VaultError('INVALID', 'Invalid link.');
    let parsed: URL;
    try {
      parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
    } catch {
      throw new VaultError('INVALID', 'Invalid link.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new VaultError('INVALID', 'Only web links can be opened.');
    await shell.openExternal(parsed.toString());
  });

  // ----------------------------------------------------------------- auth ----
  handle('auth.create', async (password: unknown, hint: unknown) => {
    const pw = validateMasterPassword(password);
    await d.vault.create(pw, typeof hint === 'string' ? hint : null);
    log('vault.created');
    d.onUnlocked();
  });
  handle('auth.unlock', async (password: unknown) => {
    const pw = validateMasterPassword(password);
    try {
      await d.vault.unlock(pw);
    } catch (e) {
      log('vault.unlock_failed');
      throw e;
    }
    log('vault.unlocked');
    d.onUnlocked();
  });
  ipcMain.handle('auth.lock', (event) => {
    if (d.isTrustedSender(event)) d.lockNow('manual');
  });
  handle('auth.changePassword', async (current: unknown, next: unknown, hint: unknown) => {
    const cur = validateMasterPassword(current, 'current');
    const nxt = validateMasterPassword(next, 'next');
    await d.vault.changePassword(cur, nxt, typeof hint === 'string' ? hint : null);
    log('vault.password_changed');
  });

  // ---------------------------------------------------------------- vault ----
  handle('vault.snapshot', () => d.vault.snapshot());
  handle('vault.saveEntry', (input: unknown) => d.vault.saveEntry(input));
  handle('vault.importEntries', async (inputs: unknown) => {
    const count = await d.vault.importEntries(inputs);
    log('vault.imported', { count });
    return { count };
  });
  handle('vault.deleteEntry', (id: unknown) => d.vault.deleteEntry(id));
  handle('vault.duplicateEntry', (id: unknown) => d.vault.duplicateEntry(id));
  handle('vault.setFavorite', (id: unknown, fav: unknown) => d.vault.setFavorite(id, fav === true));
  handle('vault.reorderFavorites', (ids: unknown) => d.vault.reorderFavorites(ids));
  handle('vault.getForEdit', (id: unknown) => d.vault.getEntryForEdit(id));
  handle('vault.reveal', (id: unknown, key: unknown) => d.vault.getSecret(id, key));
  handle('vault.copyField', async (id: unknown, key: unknown) => {
    const value = d.vault.getSecret(id, key);
    if (!value) throw new VaultError('EMPTY', 'Nothing to copy.');
    return { seconds: await d.clipboard.copySecret(value, settings().clipboardClearSeconds) };
  });
  handle('vault.copyText', async (text: unknown) => {
    if (!d.vault.isUnlocked) throw new VaultError('LOCKED', 'The vault is locked.');
    if (typeof text !== 'string' || !text || text.length > 200_000) throw new VaultError('EMPTY', 'Nothing to copy.');
    return { seconds: await d.clipboard.copySecret(text, settings().clipboardClearSeconds) };
  });
  handle('vault.saveCategory', (input: unknown) => d.vault.saveCategory(input));
  handle('vault.deleteCategory', (id: unknown) => d.vault.deleteCategory(id));
  handle('vault.updateSettings', async (patch: unknown) => {
    const s = await d.vault.updateSettings(patch);
    d.onSettingsChanged();
    return s;
  });
  handle('vault.databaseInfo', () => d.vault.databaseInfo());
  handle('vault.showVaultFolder', () => {
    if (!d.vault.isUnlocked) throw new VaultError('LOCKED', 'The vault is locked.');
    shell.showItemInFolder(d.vault.vaultPath);
  });

  // --------------------------------------------------------------- backup ----
  handle('backup.chooseDirectory', async () => {
    if (!d.vault.isUnlocked) throw new VaultError('LOCKED', 'The vault is locked.');
    const win = d.getWindow();
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose backup location',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    await d.vault.updateSettings({ backupDirectory: res.filePaths[0] });
    return res.filePaths[0];
  });

  handle('backup.create', async () => {
    if (!d.vault.isUnlocked) throw new VaultError('LOCKED', 'The vault is locked.');
    const dir = settings().backupDirectory ?? app.getPath('documents');
    const res = await dialog.showSaveDialog(d.getWindow()!, {
      title: 'Save encrypted backup',
      defaultPath: path.join(dir, backupFileName()),
      filters: [{ name: 'Encrypted vault backup', extensions: ['vault'] }]
    });
    if (res.canceled || !res.filePath) return null;
    const result = await d.backups.createBackup(res.filePath);
    log('backup.created', { ok: result.verified });
    return result;
  });

  handle('backup.pickFile', async () => {
    const res = await dialog.showOpenDialog(d.getWindow()!, {
      title: 'Select encrypted backup',
      properties: ['openFile'],
      filters: [{ name: 'Encrypted vault backup', extensions: ['vault'] }]
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return { token: d.backups.register(res.filePaths[0]), fileName: path.basename(res.filePaths[0]) };
  });

  handle('backup.open', async (token: unknown, password: unknown) => {
    if (!d.vault.isUnlocked) throw new VaultError('LOCKED', 'The vault is locked.');
    const summary = await d.backups.open(token, validateMasterPassword(password));
    log('backup.verified', { count: summary.itemCount });
    return summary;
  });
  handle('backup.apply', async (token: unknown, mode: unknown) => {
    await d.backups.apply(token, mode);
    log('backup.restored', { mode: mode === 'merge' ? 'merge' : 'replace' });
  });
  handle('backup.discard', (token: unknown) => d.backups.discard(token));
  handle('backup.restoreWhileLocked', async (token: unknown, password: unknown) => {
    if (d.vault.isUnlocked) throw new VaultError('UNLOCKED', 'Use Settings → Vault to restore while unlocked.');
    await d.backups.restoreWhileLocked(token, validateMasterPassword(password));
    log('backup.restored', { mode: 'locked' });
    d.onUnlocked();
  });

  /**
   * SECURITY-SENSITIVE: plaintext export. Requires (1) an unlocked vault,
   * (2) re-entering the master password, (3) typing a confirmation phrase,
   * (4) choosing a destination in a native dialog.
   */
  handle('backup.exportPlaintext', async (password: unknown, phrase: unknown) => {
    if (phrase !== PLAINTEXT_CONFIRM_PHRASE) throw new ValidationError('phrase', `Type ${PLAINTEXT_CONFIRM_PHRASE} to confirm.`);
    const pw = validateMasterPassword(password);
    if (!(await d.vault.verifyPassword(pw))) throw new ValidationError('password', 'Incorrect master password.');
    const res = await dialog.showSaveDialog(d.getWindow()!, {
      title: 'Save UNENCRYPTED export',
      defaultPath: path.join(app.getPath('documents'), `vault-PLAINTEXT-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return null;
    if (path.resolve(res.filePath) === path.resolve(d.vault.vaultPath)) {
      throw new VaultError('INVALID_TARGET', 'Choose a different file.');
    }
    const data = Buffer.from(JSON.stringify(d.vault.plaintextExport(), null, 2), 'utf8');
    try {
      await writeFileAtomic(res.filePath, data);
    } finally {
      data.fill(0);
    }
    log('export.plaintext');
    return res.filePath;
  });
}
