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
  events: {
    /** Commands triggered from the tray / OS (e.g. "show settings"). */
    onCommand(cb: (command: 'new-item' | 'search' | 'settings') => void): () => void;
  };
}

export const PLAINTEXT_CONFIRM_PHRASE = 'EXPORT PLAINTEXT';
