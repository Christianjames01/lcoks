// SECURITY: sandboxed preload. Exposes ONLY the explicit, typed VaultApi via
// contextBridge. No ipcRenderer, Node.js APIs or generic "invoke any channel"
// function are exposed to page scripts.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { VaultApi } from '../shared/api';

const unsupported = { ok: false as const, code: 'UNSUPPORTED', message: 'Not available on this device.' };

const call = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: VaultApi = {
  app: {
    getState: call('app.getState') as VaultApi['app']['getState'],
    getHint: call('app.getHint') as VaultApi['app']['getHint'],
    reportActivity: () => ipcRenderer.send('app.activity'),
    openExternal: call('app.openExternal') as VaultApi['app']['openExternal'],
    readClipboardText: call('app.readClipboard') as VaultApi['app']['readClipboardText'],
    takeSharedText: async () => null
  },
  auth: {
    create: call('auth.create') as VaultApi['auth']['create'],
    unlock: call('auth.unlock') as VaultApi['auth']['unlock'],
    lock: call('auth.lock') as VaultApi['auth']['lock'],
    changePassword: call('auth.changePassword') as VaultApi['auth']['changePassword']
  },
  vault: {
    snapshot: call('vault.snapshot') as VaultApi['vault']['snapshot'],
    saveEntry: call('vault.saveEntry') as VaultApi['vault']['saveEntry'],
    importEntries: call('vault.importEntries') as VaultApi['vault']['importEntries'],
    deleteEntry: call('vault.deleteEntry') as VaultApi['vault']['deleteEntry'],
    duplicateEntry: call('vault.duplicateEntry') as VaultApi['vault']['duplicateEntry'],
    setFavorite: call('vault.setFavorite') as VaultApi['vault']['setFavorite'],
    reorderFavorites: call('vault.reorderFavorites') as VaultApi['vault']['reorderFavorites'],
    getForEdit: call('vault.getForEdit') as VaultApi['vault']['getForEdit'],
    reveal: call('vault.reveal') as VaultApi['vault']['reveal'],
    copyField: call('vault.copyField') as VaultApi['vault']['copyField'],
    copyText: call('vault.copyText') as VaultApi['vault']['copyText'],
    saveCategory: call('vault.saveCategory') as VaultApi['vault']['saveCategory'],
    deleteCategory: call('vault.deleteCategory') as VaultApi['vault']['deleteCategory'],
    updateSettings: call('vault.updateSettings') as VaultApi['vault']['updateSettings'],
    databaseInfo: call('vault.databaseInfo') as VaultApi['vault']['databaseInfo'],
    showVaultFolder: call('vault.showVaultFolder') as VaultApi['vault']['showVaultFolder']
  },
  backup: {
    create: call('backup.create') as VaultApi['backup']['create'],
    chooseDirectory: call('backup.chooseDirectory') as VaultApi['backup']['chooseDirectory'],
    pickFile: call('backup.pickFile') as VaultApi['backup']['pickFile'],
    open: call('backup.open') as VaultApi['backup']['open'],
    apply: call('backup.apply') as VaultApi['backup']['apply'],
    discard: call('backup.discard') as VaultApi['backup']['discard'],
    restoreWhileLocked: call('backup.restoreWhileLocked') as VaultApi['backup']['restoreWhileLocked'],
    exportPlaintext: call('backup.exportPlaintext') as VaultApi['backup']['exportPlaintext']
  },
  // Fingerprint / PIN unlock is Android-only; the desktop always uses the master password.
  quick: {
    status: async () => ({ supported: false, biometricAvailable: false, biometric: false, pin: false, pinAttemptsLeft: 0 }),
    enableBiometric: async () => unsupported,
    enablePin: async () => unsupported,
    disable: async () => unsupported,
    unlockBiometric: async () => unsupported,
    unlockPin: async () => unsupported
  },
  events: {
    onCommand(cb) {
      const listener = (_e: IpcRendererEvent, cmd: unknown) => {
        if (cmd === 'new-item' || cmd === 'search' || cmd === 'settings') cb(cmd);
      };
      ipcRenderer.on('app.command', listener);
      return () => ipcRenderer.removeListener('app.command', listener);
    }
  }
};

contextBridge.exposeInMainWorld('vault', api);
