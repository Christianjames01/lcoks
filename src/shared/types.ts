// Shared data model. Imported by main, preload (types only) and renderer.

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
  | 'secretTextarea';

export const SECRET_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'password',
  'pin',
  'secret',
  'secretTextarea'
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
  | 'gamepad';

export interface CategoryDef {
  id: string;
  name: string;
  icon: CategoryIcon;
  fields: FieldDef[];
  builtin: boolean;
}

/** Full entry as stored inside the encrypted payload. Only ever lives in the main process. */
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
}

export interface SecretMeta {
  /** Whether the secret has a value at all. */
  set: boolean;
  /** Partially masked preview (only for partialMask fields), e.g. "•••• 5678". */
  preview?: string;
  /** Strength score 0..4 for password-type fields. */
  strength?: number;
  /** Card network detected from a card number (e.g. "visa"); the number itself is never sent. */
  network?: string;
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
}

export type AutoLockMinutes = 1 | 5 | 10 | 15 | 30 | 0; // 0 = never
export type Density = 'comfortable' | 'compact';
export type SidebarMode = 'auto' | 'expanded' | 'collapsed';
export type FavoriteSort = 'manual' | 'name' | 'updated';

export interface VaultSettings {
  autoLockMinutes: AutoLockMinutes;
  lockOnMinimize: boolean;
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
}

export const DEFAULT_SETTINGS: VaultSettings = {
  autoLockMinutes: 5,
  lockOnMinimize: true,
  lockOnSystemLock: true,
  clipboardClearSeconds: 30,
  revealTimeoutSeconds: 30,
  density: 'comfortable',
  sidebar: 'auto',
  favoriteSort: 'manual',
  backupReminderDays: 30,
  backupDirectory: null,
  closeToTray: false
};

export interface VaultMeta {
  createdAt: string;
  lastBackupAt: string | null;
  lastBackupVerified: boolean;
}

/** The decrypted payload. Exists in plaintext only in main-process memory while unlocked. */
export interface VaultPayload {
  schema: 1;
  entries: VaultEntry[];
  customCategories: CategoryDef[];
  settings: VaultSettings;
  meta: VaultMeta;
  /** User-chosen bank logo images (small data: URLs), keyed by bankKey(). Encrypted with the vault. */
  bankIcons: Record<string, string>;
}

export interface VaultStats {
  total: number;
  withPasswords: number;
  notes: number;
  favorites: number;
  weak: number;
}

export interface VaultSnapshot {
  entries: EntryView[];
  categories: CategoryDef[];
  settings: VaultSettings;
  stats: VaultStats;
  meta: VaultMeta;
  bankIcons: Record<string, string>;
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
}

/**
 * Discriminated result wrapper for IPC. Errors carry a stable code and a safe,
 * user-facing message only — never stack traces or crypto internals.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
