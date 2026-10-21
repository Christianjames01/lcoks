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
  InboxReport,
  InboxStatus,
  Result,
  StorageInfo,
  VaultEntry,
  VaultSettings,
  VaultSnapshot
} from './types';
import type { CalendarEvent, CalendarEventInput } from './calendar';
import type { Task, TaskInput } from './tasks';
import type { AccountKind, MoneyAccount, Transaction, TransactionInput } from './money';

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
    /** Short vibration on phones (no-op on desktop). */
    haptic(kind: HapticKind): void;
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
    /** Add (no id) or update an expense / income record. */
    saveTransaction(input: TransactionInput): Promise<Result<Transaction>>;
    deleteTransaction(id: string): Promise<Result<void>>;
    /** Calendar: save and delete events in one write. */
    saveEvents(save: CalendarEventInput[], remove: string[]): Promise<Result<CalendarEvent[]>>;
    /** Tasks: save and delete in one write. */
    saveTasks(save: TaskInput[], remove: string[]): Promise<Result<Task[]>>;
    /** Add (no id) or update a money account (Cash, GCash…). */
    saveAccount(input: { id?: string; name: string; kind: AccountKind; opening: number }): Promise<Result<MoneyAccount>>;
    /** Remove an account; its records are kept without an account. */
    deleteAccount(id: string): Promise<Result<void>>;
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
  /** Phone reminders for expiry / renewal / due dates (Android). */
  notifications: {
    status(): Promise<NotificationPermission>;
    /** Ask Android for permission to show notifications. */
    request(): Promise<NotificationPermission>;
    /** Android 12+: may reminders ring at the exact minute ("Alarms & reminders")? Elsewhere always on time: "unsupported". */
    exactStatus(): Promise<ExactAlarmStatus>;
    /** Open the "Alarms & reminders" settings page once; returns the new status. */
    requestExact(): Promise<ExactAlarmStatus>;
    /** Replace all scheduled reminders. */
    schedule(items: ScheduledReminder[]): Promise<Result<number>>;
    /** Show a sample reminder in a few seconds. */
    test(): Promise<Result<void>>;
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
  /**
   * Quick add an expense ("lunch 150"), also while the vault is LOCKED: the entry is
   * encrypted to the inbox public key and added on the next unlock (core/inbox.ts).
   */
  inbox: {
    status(): Promise<Result<InboxStatus>>;
    /** day: the local YYYY-MM-DD the entry belongs to. */
    add(text: string, day: string): Promise<Result<{ queued: boolean }>>;
    /** What the last unlock picked up (returned once). */
    takeReport(): Promise<Result<InboxReport | null>>;
    /** Android: ongoing notification with an "Add expense" reply field. */
    notification(): Promise<'on' | 'off' | 'unsupported'>;
    setNotification(on: boolean): Promise<Result<void>>;
    /** Android: double tap on the back of the phone opens the add-expense pop-up. */
    knock(): Promise<KnockInfo>;
    setKnock(on: boolean, sensitivity: number): Promise<Result<void>>;
    /** Android: open the add-expense pop-up now ("Try it"). */
    openPopup(): Promise<Result<void>>;
    /** Android: the phone's permission screens the pop-up needs. */
    openPermissions(which: 'overlay' | 'fullscreen' | 'app'): Promise<void>;
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

export interface KnockInfo {
  supported: boolean;
  on: boolean;
  sensitivity: number;
  canPopUp: boolean;
  fullScreen: boolean;
  xiaomi: boolean;
}

/** tap: light tick (long-press, swipe); success: copy / unlock; warning: delete. */
export type HapticKind = 'tap' | 'success' | 'warning';

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export type ExactAlarmStatus = 'granted' | 'denied' | 'unsupported';

export interface ScheduledReminder {
  id: number;
  /** Epoch milliseconds. */
  at: number;
  title: string;
  body: string;
  /** Calendar reminders go to their own channel (sound on / off). */
  kind?: 'calendar';
  silent?: boolean;
}

export const MAX_PIN_ATTEMPTS = 5;

export const PLAINTEXT_CONFIRM_PHRASE = 'EXPORT PLAINTEXT';
