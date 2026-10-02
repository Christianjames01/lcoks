// The narrow, typed API the preload script exposes to the renderer as
// `window.vault`. The renderer has no Node.js access and no other way to reach
// the main process. Every call is validated again in the main process.

import type {
  AppState,
  BackupSummary,
  CategoryDef,
  CategoryInput,
  DatabaseInfo,
  EntryInput,
  EntryView,
  Result,
  VaultEntry,
  VaultSettings,
  VaultSnapshot
} from './types';

export interface VaultApi {
  app: {
    getState(): Promise<AppState>;
    getHint(): Promise<Result<string | null>>;
    /** Throttled by the renderer; resets the auto-lock timer. */
    reportActivity(): void;
    openExternal(url: string): Promise<Result<void>>;
    /** Read plain text from the system clipboard (user-initiated "Paste"). */
    readClipboardText(): Promise<Result<string>>;
    /** Text shared into the app from another app (Android "Share → VaultLocks"); returned once. */
    takeSharedText(): Promise<string | null>;
    /** Pause lock-on-background while the camera / photo picker is open; resuming also deletes temporary camera files. */
    suspendAutoLock(on: boolean): void;
  };
  auth: {
    create(password: string, hint: string | null): Promise<Result<void>>;
    unlock(password: string): Promise<Result<void>>;
    lock(): Promise<void>;
    changePassword(current: string, next: string, hint: string | null): Promise<Result<void>>;
  };
  vault: {
    snapshot(): Promise<Result<VaultSnapshot>>;
    saveEntry(input: EntryInput): Promise<Result<EntryView>>;
    /** Add many items in ONE encrypted write (used by note import). */
    importEntries(inputs: EntryInput[]): Promise<Result<{ count: number }>>;
    deleteEntry(id: string): Promise<Result<void>>;
    duplicateEntry(id: string): Promise<Result<EntryView>>;
    setFavorite(id: string, favorite: boolean): Promise<Result<void>>;
    reorderFavorites(ids: string[]): Promise<Result<void>>;
    getForEdit(id: string): Promise<Result<VaultEntry>>;
    reveal(id: string, fieldKey: string): Promise<Result<string>>;
    copyField(id: string, fieldKey: string): Promise<Result<{ seconds: number }>>;
    copyText(text: string): Promise<Result<{ seconds: number }>>;
    saveCategory(input: CategoryInput): Promise<Result<CategoryDef>>;
    deleteCategory(id: string): Promise<Result<void>>;
    updateSettings(patch: Partial<VaultSettings>): Promise<Result<VaultSettings>>;
    databaseInfo(): Promise<Result<DatabaseInfo>>;
    showVaultFolder(): Promise<void>;
  };
  backup: {
    create(): Promise<Result<{ path: string; verified: boolean } | null>>;
    chooseDirectory(): Promise<Result<string | null>>;
    pickFile(): Promise<Result<{ token: string; fileName: string } | null>>;
    open(token: string, password: string): Promise<Result<BackupSummary>>;
    apply(token: string, mode: 'replace' | 'merge'): Promise<Result<void>>;
    discard(token: string): Promise<void>;
    restoreWhileLocked(token: string, password: string): Promise<Result<void>>;
    exportPlaintext(password: string, confirmPhrase: string): Promise<Result<string | null>>;
  };
  /**
   * Quick unlock (Android): fingerprint and 4-digit PIN. The vault key is wrapped by
   * a hardware-backed Android Keystore key; the master password is still required
   * to enable it. Desktop reports `supported: false`.
   */
  quick: {
    status(): Promise<QuickUnlockStatus>;
    enableBiometric(masterPassword: string): Promise<Result<void>>;
    enablePin(masterPassword: string, pin: string): Promise<Result<void>>;
    disable(kind: 'biometric' | 'pin'): Promise<Result<void>>;
    unlockBiometric(): Promise<Result<void>>;
    unlockPin(pin: string): Promise<Result<void>>;
  };
  events: {
    /** Commands triggered from the tray / OS (e.g. "show settings"). */
    onCommand(cb: (command: 'new-item' | 'search' | 'settings') => void): () => void;
  };
}

export interface QuickUnlockStatus {
  supported: boolean;
  biometricAvailable: boolean;
  biometric: boolean;
  pin: boolean;
  pinAttemptsLeft: number;
}

export const MAX_PIN_ATTEMPTS = 5;

export const PLAINTEXT_CONFIRM_PHRASE = 'EXPORT PLAINTEXT';
