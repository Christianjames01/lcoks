// The narrow, typed API the preload script exposes to the renderer as
// `window.vault`. The renderer has no Node.js access and no other way to reach
// the main process. Every call is validated again in the main process.

import type {
  AddAttachmentResult,
  AppState,
  AttachmentInput,
  AttachmentMeta,
  BackupSummary,
  CategoryDef,
  CategoryInput,
  DatabaseInfo,
  DuplicateGroup,
  EntryInput,
  EntryView,
  Result,
  StorageInfo,
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
    /** Match the system bars / window title bar to the light or dark theme. */
    setAppearance(dark: boolean): void;
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
    /** Moves the item to Recently Deleted (restorable for 30 days). */
    deleteEntry(id: string): Promise<Result<void>>;
    restoreEntry(id: string): Promise<Result<EntryView>>;
    /** Permanently delete an item from Recently Deleted. */
    purgeEntry(id: string): Promise<Result<void>>;
    emptyTrash(): Promise<Result<number>>;
    findDuplicates(): Promise<Result<DuplicateGroup[]>>;
    /** Merge others into keepId; the others go to Recently Deleted. */
    mergeEntries(keepId: string, otherIds: string[]): Promise<Result<EntryView>>;
    dismissDuplicate(groupKey: string): Promise<Result<void>>;
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
  /** Encrypted attachments (images, PDFs, documents) of an item. */
  attachments: {
    list(entryId: string): Promise<Result<AttachmentMeta[]>>;
    add(entryId: string, input: AttachmentInput): Promise<Result<AddAttachmentResult>>;
    /** Decrypted content, base64 — only when the user views it. */
    read(entryId: string, attachmentId: string): Promise<Result<string>>;
    update(entryId: string, attachmentId: string, patch: { name?: string; role?: 'front' | 'back' | null }): Promise<Result<AttachmentMeta>>;
    remove(entryId: string, attachmentId: string): Promise<Result<void>>;
    /** Explicit export: save dialog (desktop) or share sheet (Android). */
    exportFile(entryId: string, attachmentId: string): Promise<Result<string | null>>;
    /** Android: open in another app via a temporary, auto-deleted copy. */
    openWith(entryId: string, attachmentId: string): Promise<Result<void>>;
    /** Android: render PDF pages to images inside the app (no copy leaves the app). */
    renderPdf(entryId: string, attachmentId: string): Promise<Result<string[]>>;
    storageInfo(): Promise<Result<StorageInfo>>;
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
    /** 'biometric' = face/fingerprint, 'credential' = the phone's screen-lock passcode (Android 11+). */
    unlockBiometric(mode?: 'biometric' | 'credential'): Promise<Result<void>>;
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
  /** The phone's screen-lock PIN/pattern/password can unlock (Android 11+). */
  deviceCredentialAvailable: boolean;
  biometric: boolean;
  /** Quick unlock is enrolled with device-passcode support. */
  deviceCredential: boolean;
  pin: boolean;
  pinAttemptsLeft: number;
}

export const MAX_PIN_ATTEMPTS = 5;

export const PLAINTEXT_CONFIRM_PHRASE = 'EXPORT PLAINTEXT';
