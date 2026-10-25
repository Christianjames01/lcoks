// Shared data model. Imported by main, preload (types only) and renderer.

import type { CalendarEvent } from './calendar';
import type { MoneyAccount, MoneyCategory, MoneyCategoryEdit, Transaction } from './money';
import type { Bill, Debt, Goal, Transfer } from './plans';
import type { Task, TaskCategory } from './tasks';

export type FieldType =
  | 'text'
  | 'username'
  | 'email'
  | 'phone'
  | 'url'
  | 'date'
  | 'select'
  | 'textarea'
  // ---- Secret field types: hidden by default, never sent to the renderer in list
  // ---- views, never searchable, only revealed/copied on explicit request.
  | 'password'
  | 'pin'
  | 'secret'
  | 'secretTextarea'
  // Photo of a card (data: URL). Encrypted, hidden, revealed on demand.
  | 'secretImage';

export const SECRET_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'password',
  'pin',
  'secret',
  'secretTextarea',
  'secretImage'
]);

export function isSecretType(type: FieldType): boolean {
  return SECRET_FIELD_TYPES.has(type);
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  /** Show the last 4 characters while masked, e.g. account numbers. */
  partialMask?: boolean;
  placeholder?: string;
}

export type CategoryIcon =
  | 'gift'
  | 'ticket'
  | 'bank'
  | 'mail'
  | 'globe'
  | 'wifi'
  | 'key'
  | 'user'
  | 'note'
  | 'card'
  | 'lock'
  | 'briefcase'
  | 'server'
  | 'shield'
  | 'home'
  | 'phone'
  | 'id'
  | 'folder'
  | 'gamepad'
  | 'wallet'
  | 'health'
  | 'calendar';

export interface CategoryDef {
  id: string;
  name: string;
  icon: CategoryIcon;
  fields: FieldDef[];
  builtin: boolean;
}

/**
 * Metadata of an encrypted attachment (image/PDF/document). The file content is
 * stored separately, encrypted with the vault key; this metadata lives inside
 * the encrypted vault payload.
 */
export interface AttachmentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** SHA-256 of the original content (hex) — used for duplicate detection. */
  sha256: string;
  createdAt: string;
  /** Marks a photo as the front/back of the item's card ("Show real card"). */
  role?: 'front' | 'back';
  /** Small JPEG preview (data: URL) for images. Sensitive: only sent on request. */
  thumb?: string;
}

/** Full entry as stored inside the encrypted payload. Never sent to the UI as-is. */
export interface VaultEntry {
  id: string;
  categoryId: string;
  title: string;
  fields: Record<string, string>;
  tags: string[];
  favorite: boolean;
  favoriteOrder: number;
  createdAt: string;
  updatedAt: string;
  attachments?: AttachmentMeta[];
  /** Legacy card photos (old front/back photo fields) waiting to become attachments. */
  legacyImages?: { front?: string; back?: string };
}

/** An entry in "Recently Deleted" (restorable for TRASH_DAYS). */
export interface TrashedEntry extends VaultEntry {
  deletedAt: string;
}

export const TRASH_DAYS = 30;

export interface SecretMeta {
  /** Whether the secret has a value at all. */
  set: boolean;
  /** Partially masked preview (only for partialMask fields), e.g. "•••• 5678". */
  preview?: string;
  /** Strength score 0..4 for password-type fields. */
  strength?: number;
  /** Card network detected from a card number (e.g. "visa"); the number itself is never sent. */
  network?: string;
  /** Password-type field whose value is also used by another item. */
  reused?: boolean;
}

/**
 * Redacted entry sent to the renderer. Secret field values are NEVER included;
 * only metadata about them. The renderer must explicitly request a reveal.
 */
export interface EntryView {
  id: string;
  categoryId: string;
  title: string;
  fields: Record<string, string>;
  secrets: Record<string, SecretMeta>;
  tags: string[];
  favorite: boolean;
  favoriteOrder: number;
  createdAt: string;
  updatedAt: string;
  attachmentCount: number;
  /** Which card photos exist (attachments with role front/back). */
  cardPhotos: { front: boolean; back: boolean };
}

export interface TrashView extends EntryView {
  deletedAt: string;
}

export type AutoLockMinutes = 1 | 5 | 10 | 15 | 30 | 0; // 0 = never
export type Density = 'comfortable' | 'compact';
export type SidebarMode = 'auto' | 'expanded' | 'collapsed';
export type FavoriteSort = 'manual' | 'name' | 'updated';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentColor = 'mono' | 'blue' | 'green' | 'purple' | 'orange' | 'pink';
export const ACCENT_COLORS: readonly AccentColor[] = ['mono', 'blue', 'green', 'purple', 'orange', 'pink'];
/** Grace period before locking after the app is left: 0 = immediately, -1 = never. */
export type BackgroundLockMinutes = 0 | 1 | 5 | 15 | 30 | -1;

export type ReminderDays = 1 | 3 | 7 | 14 | 30;

export interface GeneratorDefaults {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
}

export interface VaultSettings {
  autoLockMinutes: AutoLockMinutes;
  lockOnSystemLock: boolean;
  clipboardClearSeconds: number; // 15..60
  /** Auto-hide revealed secrets after N seconds (0 = keep visible until hidden). */
  revealTimeoutSeconds: number;
  density: Density;
  sidebar: SidebarMode;
  favoriteSort: FavoriteSort;
  backupReminderDays: number; // 0 = off
  backupDirectory: string | null;
  closeToTray: boolean;
  theme: ThemeMode;
  accent: AccentColor;
  glass: boolean;
  backgroundLockMinutes: BackgroundLockMinutes;
  screenshotProtection: boolean;
  /** Hide even partial previews (last 4 digits, masked phone numbers). */
  hidePreviews: boolean;
  generator: GeneratorDefaults;
  /** Phone notifications before expiry / renewal / due dates. */
  reminders: boolean;
  /** How many days before the date the first reminder comes (one more on the day). */
  reminderDaysBefore: ReminderDays;
  /** Expenses: ISO 4217 currency code. */
  currency: string;
  /** Expenses: monthly spending budget in minor units (0 = no budget). */
  monthlyBudget: number;
  /** Expenses: monthly coffee budget in minor units (0 = none). */
  coffeeBudget: number;
  /** Expenses: monthly budget per category id (minor units). Coffee uses coffeeBudget. */
  categoryBudgets: Record<string, number>;
  /** Android home-screen widget shows amounts and titles (off = totals and names hidden). */
  widgetDetails: boolean;
  /** Quick-add pop-up shows account balances while locked (stored unencrypted next to the vault). */
  quickAddBalances: boolean;
  /** Calendar: alarms for event reminders (in the app and as phone / desktop notifications). */
  calendarReminders: boolean;
  /** Calendar: play a sound with in-app reminder pop-ups. */
  calendarSound: boolean;
  /** Calendar: reminders added to new events (minutes before the start). */
  calendarDefaultReminders: number[];
  /** Calendar: show event titles in notifications (off = only "you have an event at 10:00"). */
  calendarPreview: boolean;
  /** Calendar: "Remind me later" length in minutes. */
  calendarSnooze: number;
  /** Tasks: the user's own categories (besides the built-in ones). */
  taskCategories: TaskCategory[];
  /** Unused since 1.0.40 (was the opt-in switch); kept so older vaults still validate. */
  phoneCalendar: boolean;
  /**
   * Android: the next days' events and tasks are copied into the phone's calendar so its
   * lock-screen / home-screen widgets show them — on unless the user turned it off.
   */
  phoneCalendarOff: boolean;
  /** …with their names (off: only "VaultLocks event" and the time). */
  phoneCalendarNames: boolean;
}

export const DEFAULT_SETTINGS: VaultSettings = {
  autoLockMinutes: 5,
  lockOnSystemLock: true,
  clipboardClearSeconds: 30,
  revealTimeoutSeconds: 30,
  density: 'comfortable',
  sidebar: 'auto',
  favoriteSort: 'manual',
  backupReminderDays: 30,
  backupDirectory: null,
  closeToTray: false,
  theme: 'system',
  accent: 'mono',
  glass: true,
  backgroundLockMinutes: 0,
  screenshotProtection: true,
  hidePreviews: false,
  reminders: true,
  reminderDaysBefore: 1,
  currency: 'PHP',
  monthlyBudget: 0,
  coffeeBudget: 0,
  categoryBudgets: {},
  widgetDetails: true,
  quickAddBalances: false,
  calendarReminders: true,
  calendarSound: true,
  calendarDefaultReminders: [30],
  calendarPreview: false,
  calendarSnooze: 10,
  taskCategories: [],
  phoneCalendar: false,
  phoneCalendarOff: false,
  phoneCalendarNames: true,
  generator: { length: 20, upper: true, lower: true, digits: true, symbols: true, avoidAmbiguous: false }
};

export interface VaultMeta {
  createdAt: string;
  lastBackupAt: string | null;
  lastBackupVerified: boolean;
  /** Duplicate groups the user marked as "not duplicates". */
  dismissedDuplicates: string[];
}

/** The decrypted payload. Exists in plaintext only in main-process memory while unlocked. */
export interface VaultPayload {
  schema: 1;
  entries: VaultEntry[];
  customCategories: CategoryDef[];
  settings: VaultSettings;
  meta: VaultMeta;
  trash: TrashedEntry[];
  /** Expense & income records (inside the encrypted payload like everything else). */
  transactions: Transaction[];
  /** Money accounts (Cash, GCash…). */
  accounts: MoneyAccount[];
  /** The user's own expense / income categories. */
  moneyCategories: MoneyCategory[];
  /** Renamed / hidden built-in categories, by id. */
  moneyCategoryEdits: Record<string, MoneyCategoryEdit>;
  /** Utang: who owes who. */
  debts: Debt[];
  /** Repeating bills. */
  bills: Bill[];
  /** Savings goals. */
  goals: Goal[];
  /** Money moved between accounts. */
  transfers: Transfer[];
  /** Calendar events with their reminders. */
  events: CalendarEvent[];
  /** To-dos. */
  tasks: Task[];
  /** Quick-add inbox key pair (see core/inbox.ts); the private half never leaves the payload. */
  inboxKey?: { priv: JsonWebKey; pub: string };
}

/** Quick add while locked: is it set up, and how many entries wait for the next unlock. */
export interface InboxStatus {
  enabled: boolean;
  pending: number;
}

/** What the last unlock picked up from the quick-add inbox. */
export interface InboxReport {
  added: number;
  /** Entries without a readable amount (kept here so the user can re-enter them). */
  unreadable: string[];
}

export interface VaultStats {
  total: number;
  withPasswords: number;
  notes: number;
  favorites: number;
  weak: number;
  /** Items with a password that another item also uses. */
  reused: number;
  attachments: number;
}

export interface VaultSnapshot {
  entries: EntryView[];
  transactions: Transaction[];
  accounts: MoneyAccount[];
  moneyCategories: MoneyCategory[];
  moneyCategoryEdits: Record<string, MoneyCategoryEdit>;
  debts: Debt[];
  bills: Bill[];
  goals: Goal[];
  transfers: Transfer[];
  events: CalendarEvent[];
  tasks: Task[];
  categories: CategoryDef[];
  settings: VaultSettings;
  stats: VaultStats;
  meta: VaultMeta;
  trash: TrashView[];
}

/** Field-by-field comparison inside a duplicate group (no secret values). */
export interface FieldComparison {
  key: string;
  label: string;
  secret: boolean;
  status: 'same' | 'different' | 'partial';
}

export interface DuplicateGroup {
  /** Stable key, used to dismiss a group ("not duplicates"). */
  key: string;
  reasons: string[];
  items: EntryView[];
  fields: FieldComparison[];
}

export interface AttachmentInput {
  name: string;
  mime: string;
  /** File content, base64. */
  data: string;
  thumb?: string;
  role?: 'front' | 'back';
  /** Add even if the same file is already attached. */
  allowDuplicate?: boolean;
}

export type AddAttachmentResult = { status: 'added'; attachment: AttachmentMeta } | { status: 'duplicate'; existing: AttachmentMeta };

export interface StorageInfo {
  vaultBytes: number;
  attachmentBytes: number;
  attachmentCount: number;
  /** Free space on the device, when the platform can tell. */
  freeBytes: number | null;
}

export type AppStatus = 'no-vault' | 'locked' | 'unlocked';

export interface AppState {
  status: AppStatus;
  hasHint: boolean;
  platform: string;
  version: string;
}

/** Input from renderer when creating/updating an entry. */
export interface EntryInput {
  id?: string;
  categoryId: string;
  title: string;
  fields: Record<string, string>;
  tags: string[];
  favorite: boolean;
}

export interface CategoryInput {
  id?: string;
  name: string;
  icon: CategoryIcon;
  fields: FieldDef[];
}

export interface BackupSummary {
  token: string;
  fileName: string;
  itemCount: number;
  categoryCount: number;
  createdAt: string | null;
  kind: 'vault' | 'backup';
}

export interface DatabaseInfo {
  path: string;
  sizeBytes: number;
  formatVersion: number;
  kdf: string;
  cipher: string;
  createdAt: string;
  modifiedAt: string;
  itemCount: number;
  attachmentCount: number;
  attachmentBytes: number;
}

/**
 * Discriminated result wrapper for IPC. Errors carry a stable code and a safe,
 * user-facing message only — never stack traces or crypto internals.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
