// ============================================================================
// SECURITY-CRITICAL MODULE — the vault session, shared by desktop and Android.
//
// While LOCKED nothing is held. While UNLOCKED: a non-extractable AES-256-GCM
// CryptoKey (derived with Argon2id from the master password) and the decrypted
// payload. Every mutation re-encrypts the payload with a fresh nonce and is
// written atomically; a failed write leaves memory and disk unchanged.
//
// Attachments are stored as separate files, each AES-GCM encrypted with the
// vault key and bound to its id (AAD). Their metadata lives in the payload.
//
// Data-safety rules:
//   * Deleting an item moves it to "Recently Deleted" (restorable for 30 days).
//   * Duplicates are only ever DETECTED; merging/deleting is the user's choice,
//     and merged-away items go to Recently Deleted.
//   * Restoring a backup in "replace" mode moves current items to Recently Deleted.
// ============================================================================

import { BUILTIN_CATEGORIES } from '../shared/categories';
import { detectCardNetwork } from '../shared/cards';
import { estimateStrength } from '../shared/strength';
import {
  DEFAULT_SETTINGS,
  TRASH_DAYS,
  isSecretType,
  type AddAttachmentResult,
  type AttachmentInput,
  type AttachmentMeta,
  type CategoryDef,
  type DatabaseInfo,
  type DuplicateGroup,
  type EntryView,
  type FieldComparison,
  type SecretMeta,
  type StorageInfo,
  type TrashView,
  type VaultEntry,
  type VaultPayload,
  type VaultSettings,
  type VaultSnapshot
} from '../shared/types';
import {
  CryptoError,
  MAX_HINT_LENGTH,
  attachmentAad,
  buildFile,
  deriveKey,
  deriveRawKey,
  fromB64,
  importAesKey,
  newKdfParams,
  openBytes,
  openFile,
  parseFile,
  sealBytes,
  sha256Hex,
  toB64,
  type FileKind,
  type KdfParams,
  type ParsedFile
} from './crypto';
import {
  MAX_ATTACHMENTS_PER_ITEM,
  MAX_ATTACHMENT_BYTES,
  ValidationError,
  cleanFileName,
  validateCategoryInput,
  validateEntryInput,
  validateNewMasterPassword,
  validatePayload,
  validateSettings
} from './schema';
import { VAULT_FILE, attachmentFile, pendingAttachmentFile, type VaultStorage } from './storage';

export const UNLOCK_FAILED_MESSAGE = 'Unable to unlock vault. The password may be incorrect or the vault may be corrupted.';

/** Error with a stable code and a SAFE, user-facing message. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string
  ) {
    super(code);
    this.name = 'AppError';
  }
}

interface HeaderMeta {
  createdAt: string;
  hint: string | null;
}

/** A decrypted backup: payload + its key + its (still encrypted) attachments. */
export interface OpenedBackup {
  payload: VaultPayload;
  key: CryptoKey;
  file: ParsedFile;
  attachments: Record<string, string>;
}

const ID_KEYS = ['accountNumber', 'cardNumber', 'idNumber', 'memberNumber', 'documentNumber', 'licenseKey'];
const SITE_KEYS = ['website', 'service', 'platform', 'bankName', 'provider', 'profileUrl'];
const NUMBER_LABEL: Record<string, string> = {
  accountNumber: 'Same account number',
  cardNumber: 'Same card number',
  idNumber: 'Same ID number',
  memberNumber: 'Same member number',
  documentNumber: 'Same document number',
  licenseKey: 'Same license key'
};

const norm = (s: string | undefined) => (s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
const site = (s: string | undefined) =>
  norm(
    (s ?? '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split(/[/?#]/)[0]
  );

export class VaultCore {
  private key: CryptoKey | null = null;
  private kdf: KdfParams | null = null;
  private header: HeaderMeta | null = null;
  private payload: VaultPayload | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private failedAttempts = 0;
  private lockedOutUntil = 0;

  constructor(
    protected readonly storage: VaultStorage,
    private readonly now: () => Date = () => new Date()
  ) {}

  get isUnlocked(): boolean {
    return this.key !== null && this.payload !== null;
  }

  get settings(): VaultSettings {
    return this.payload?.settings ?? DEFAULT_SETTINGS;
  }

  async exists(): Promise<boolean> {
    return (await this.storage.stat(VAULT_FILE)) !== null;
  }

  async getHint(): Promise<string | null> {
    try {
      const raw = await this.storage.read(VAULT_FILE);
      return raw ? parseFile(raw).hint : null;
    } catch {
      return null;
    }
  }

  private requireUnlocked(): { key: CryptoKey; payload: VaultPayload } {
    if (!this.key || !this.payload) throw new AppError('LOCKED', 'The vault is locked.');
    return { key: this.key, payload: this.payload };
  }

  private cleanHint(hint: string | null, password: string): string | null {
    if (typeof hint !== 'string') return null;
    const h = hint.trim().slice(0, MAX_HINT_LENGTH);
    if (!h) return null;
    if (password && h.toLowerCase().includes(password.toLowerCase())) {
      throw new ValidationError('hint', 'The hint must not contain your master password.');
    }
    return h;
  }

  private iso(): string {
    return this.now().toISOString();
  }

  // ------------------------------------------------------- create / unlock ----

  async create(password: string, hint: string | null): Promise<void> {
    if (await this.exists()) throw new AppError('EXISTS', 'A vault already exists on this device.');
    validateNewMasterPassword(password);
    const cleanHint = this.cleanHint(hint, password);
    const kdf = newKdfParams();
    const key = await deriveKey(password, kdf);
    const createdAt = this.iso();
    this.key = key;
    this.kdf = kdf;
    this.header = { createdAt, hint: cleanHint };
    this.payload = {
      schema: 1,
      entries: [],
      customCategories: [],
      settings: { ...DEFAULT_SETTINGS },
      meta: { createdAt, lastBackupAt: null, lastBackupVerified: false, dismissedDuplicates: [] },
      trash: []
    };
    try {
      await this.write();
    } catch {
      this.lock();
      throw new AppError('WRITE_FAILED', 'Could not create the vault.');
    }
  }

  async unlock(password: string): Promise<void> {
    const wait = Math.ceil((this.lockedOutUntil - Date.now()) / 1000);
    if (wait > 0) throw new AppError('THROTTLED', `Too many attempts. Try again in ${wait} seconds.`);
    try {
      const raw = await this.storage.read(VAULT_FILE);
      if (!raw) throw new Error();
      const file = parseFile(raw);
      const key = await deriveKey(password, file.kdf);
      const payload = validatePayload(JSON.parse(await openFile(file, key)));
      this.setSession(key, file, payload);
    } catch {
      this.registerFailure();
      throw new AppError('UNLOCK_FAILED', UNLOCK_FAILED_MESSAGE);
    }
    await this.afterUnlock();
  }

  private setSession(key: CryptoKey, file: { kdf: KdfParams; createdAt: string; hint: string | null }, payload: VaultPayload): void {
    this.key = key;
    this.kdf = file.kdf;
    this.header = { createdAt: file.createdAt, hint: file.hint };
    this.payload = payload;
    this.failedAttempts = 0;
    this.lockedOutUntil = 0;
  }

  private registerFailure(): void {
    this.failedAttempts++;
    if (this.failedAttempts >= 3) this.lockedOutUntil = Date.now() + Math.min(60, 2 ** (this.failedAttempts - 3) * 2) * 1000;
  }

  /**
   * Quick-unlock enrollment: verify the master password against the stored vault
   * and return the RAW vault key so it can be wrapped by the Android Keystore.
   * Caller must wipe() the result.
   */
  async rawKeyForEnrollment(password: string): Promise<Uint8Array> {
    this.requireUnlocked();
    const raw = await this.storage.read(VAULT_FILE);
    if (!raw) throw new AppError('LOCKED', 'The vault is locked.');
    const file = parseFile(raw);
    const bytes = await deriveRawKey(password, file.kdf);
    try {
      await openFile(file, await importAesKey(bytes.slice()));
      return bytes;
    } catch {
      bytes.fill(0);
      throw new ValidationError('master', 'Incorrect master password.');
    }
  }

  /** Unlock with a raw key released by fingerprint/PIN. Consumes (wipes) the bytes. */
  async unlockWithRawKey(rawKey: Uint8Array): Promise<void> {
    const raw = await this.storage.read(VAULT_FILE);
    if (!raw) throw new AppError('UNLOCK_FAILED', UNLOCK_FAILED_MESSAGE);
    const file = parseFile(raw);
    const key = await importAesKey(rawKey);
    let payload: VaultPayload;
    try {
      payload = validatePayload(JSON.parse(await openFile(file, key)));
    } catch {
      // The wrapped key no longer matches the vault (e.g. password changed elsewhere).
      throw new AppError('QUICK_STALE', 'Quick unlock is out of date. Please use your master password.');
    }
    this.setSession(key, file, payload);
    await this.afterUnlock();
  }

  /**
   * Housekeeping right after unlocking (each step is best-effort and never
   * destroys data that could still be needed):
   *   1. finish an interrupted password change (att-*.new files),
   *   2. turn old card-photo fields into attachments,
   *   3. permanently remove items deleted more than TRASH_DAYS ago.
   */
  private async afterUnlock(): Promise<void> {
    try {
      await this.recoverPendingAttachments();
    } catch {
      /* try again next unlock */
    }
    try {
      await this.migrateLegacyImages();
    } catch {
      /* photos stay safely in legacyImages until next time */
    }
    try {
      await this.purgeExpiredTrash();
    } catch {
      /* try again next unlock */
    }
  }

  /** Drop the key and all decrypted data. */
  lock(): void {
    this.key = null;
    this.payload = null;
    this.kdf = null;
    this.header = null;
  }

  /** Re-authenticate by decrypting the stored vault with a key derived from `password`. */
  async verifyPassword(password: string): Promise<boolean> {
    this.requireUnlocked();
    try {
      const raw = await this.storage.read(VAULT_FILE);
      if (!raw) return false;
      const file = parseFile(raw);
      await openFile(file, await deriveKey(password, file.kdf));
      return true;
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------- persistence ----

  private serialize(kind: FileKind, key: CryptoKey, kdf: KdfParams, header: HeaderMeta, payload: VaultPayload): Promise<string> {
    return buildFile({ kind, createdAt: header.createdAt, kdf, hint: header.hint }, key, JSON.stringify(payload));
  }

  private async write(): Promise<void> {
    const { key, payload } = this.requireUnlocked();
    await this.storage.writeAtomic(VAULT_FILE, await this.serialize('vault', key, this.kdf!, this.header!, payload));
  }

  /** Run strictly one at a time (mutations, password change, attachment writes). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /**
   * Apply a change to a COPY of the payload, save it, and only then make it the
   * current state. A failed save leaves memory and disk unchanged.
   */
  private mutate<T>(fn: (draft: VaultPayload) => T): Promise<T> {
    return this.serial(() => this.mutateNow(fn));
  }

  /** mutate() for callers already inside serial(). */
  private async mutateNow<T>(fn: (draft: VaultPayload) => T): Promise<T> {
    const { payload } = this.requireUnlocked();
    const draft: VaultPayload = structuredClone(payload);
    const result = fn(draft);
    const previous = this.payload;
    this.payload = draft;
    try {
      await this.write();
    } catch {
      if (this.payload === draft) this.payload = previous;
      throw new AppError('WRITE_FAILED', 'Could not save the vault. Your previous data is unchanged.');
    }
    return result;
  }

  // ---------------------------------------------------------------- views ----

  categories(): CategoryDef[] {
    return [...BUILTIN_CATEGORIES, ...(this.payload?.customCategories ?? [])];
  }

  private categoryOf(e: VaultEntry): CategoryDef | undefined {
    return this.categories().find((c) => c.id === e.categoryId);
  }

  /** Redacted view — secret values are never included. */
  toView(entry: VaultEntry): EntryView {
    const fields: Record<string, string> = {};
    const secrets: Record<string, SecretMeta> = {};
    const hidePreviews = this.settings.hidePreviews;
    for (const def of this.categoryOf(entry)?.fields ?? []) {
      const value = entry.fields[def.key] ?? '';
      if (isSecretType(def.type)) {
        const meta: SecretMeta = { set: value.length > 0 };
        if (def.partialMask && value.length > 4 && !hidePreviews) meta.preview = '•••• ' + value.replace(/\s/g, '').slice(-4);
        if (def.type === 'password' && value) meta.strength = estimateStrength(value).score;
        if ((def.key === 'cardNumber' || def.key === 'accountNumber') && value) meta.network = detectCardNetwork(value);
        secrets[def.key] = meta;
      } else if (value) {
        fields[def.key] = value;
      }
    }
    const atts = entry.attachments ?? [];
    return {
      id: entry.id,
      categoryId: entry.categoryId,
      title: entry.title,
      fields,
      secrets,
      tags: [...entry.tags],
      favorite: entry.favorite,
      favoriteOrder: entry.favoriteOrder,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      attachmentCount: atts.length,
      cardPhotos: { front: atts.some((a) => a.role === 'front'), back: atts.some((a) => a.role === 'back') }
    };
  }

  snapshot(): VaultSnapshot {
    const { payload } = this.requireUnlocked();
    const entries = payload.entries.map((e) => this.toView(e));
    let withPasswords = 0;
    let weak = 0;
    for (const v of entries) {
      if (v.secrets.password?.set) {
        withPasswords++;
        if ((v.secrets.password.strength ?? 4) <= 1) weak++;
      }
    }
    const trash: TrashView[] = payload.trash
      .map((t) => ({ ...this.toView(t), deletedAt: t.deletedAt }))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return {
      entries,
      categories: this.categories(),
      settings: { ...payload.settings, generator: { ...payload.settings.generator } },
      meta: { ...payload.meta, dismissedDuplicates: [...payload.meta.dismissedDuplicates] },
      trash,
      stats: {
        total: entries.length,
        withPasswords,
        notes: entries.filter((e) => e.categoryId === 'notes').length,
        favorites: entries.filter((e) => e.favorite).length,
        weak,
        attachments: entries.reduce((n, e) => n + e.attachmentCount, 0)
      }
    };
  }

  private findEntry(id: unknown): VaultEntry {
    const { payload } = this.requireUnlocked();
    const e = typeof id === 'string' ? payload.entries.find((x) => x.id === id) : undefined;
    if (!e) throw new AppError('NOT_FOUND', 'Item not found.');
    return e;
  }

  /** One secret value — only on an explicit user reveal/copy. */
  getSecret(id: unknown, fieldKey: unknown): string {
    const entry = this.findEntry(id);
    const def = this.categoryOf(entry)?.fields.find((f) => f.key === fieldKey);
    if (!def) throw new AppError('NOT_FOUND', 'Field not found.');
    return entry.fields[def.key] ?? '';
  }

  /** Full entry (including secrets) for the edit form. Attachment thumbnails excluded. */
  getEntryForEdit(id: unknown): VaultEntry {
    const e = structuredClone(this.findEntry(id));
    delete e.legacyImages;
    if (e.attachments) e.attachments = e.attachments.map(({ thumb: _t, ...rest }) => rest);
    return e;
  }

  // -------------------------------------------------------------- entries ----

  async saveEntry(input: unknown): Promise<EntryView> {
    const v = validateEntryInput(input, this.categories());
    const now = this.iso();
    const saved = await this.mutate((draft) => {
      if (v.id) {
        const e = draft.entries.find((x) => x.id === v.id);
        if (!e) throw new AppError('NOT_FOUND', 'Item not found.');
        if (v.favorite && !e.favorite) e.favoriteOrder = nextFavoriteOrder(draft);
        Object.assign(e, { categoryId: v.categoryId, title: v.title, fields: v.fields, tags: v.tags, favorite: v.favorite, updatedAt: now });
        return e;
      }
      const e: VaultEntry = {
        id: globalThis.crypto.randomUUID(),
        categoryId: v.categoryId,
        title: v.title,
        fields: v.fields,
        tags: v.tags,
        favorite: v.favorite,
        favoriteOrder: v.favorite ? nextFavoriteOrder(draft) : 0,
        createdAt: now,
        updatedAt: now
      };
      draft.entries.push(e);
      return e;
    });
    return this.toView(saved);
  }

  /** Validate every item first, then add them all in a single encrypted write. */
  async importEntries(inputs: unknown): Promise<number> {
    if (!Array.isArray(inputs) || inputs.length === 0) throw new AppError('EMPTY', 'Nothing to import.');
    if (inputs.length > 5000) throw new AppError('LIMIT', 'Import at most 5,000 items at a time.');
    const categories = this.categories();
    const valid = inputs.map((i) => validateEntryInput({ ...(i as object), id: undefined }, categories));
    const now = this.iso();
    await this.mutate((d) => {
      for (const v of valid) {
        d.entries.push({
          id: globalThis.crypto.randomUUID(),
          categoryId: v.categoryId,
          title: v.title,
          fields: v.fields,
          tags: v.tags,
          favorite: v.favorite,
          favoriteOrder: v.favorite ? nextFavoriteOrder(d) : 0,
          createdAt: now,
          updatedAt: now
        });
      }
    });
    return valid.length;
  }

  /** Move an item to Recently Deleted (restorable for TRASH_DAYS days). */
  async deleteEntry(id: unknown): Promise<void> {
    this.findEntry(id);
    const deletedAt = this.iso();
    await this.mutate((d) => {
      const e = d.entries.find((x) => x.id === id)!;
      d.entries = d.entries.filter((x) => x.id !== id);
      d.trash.push({ ...e, favorite: false, deletedAt });
    });
  }

  async restoreEntry(id: unknown): Promise<EntryView> {
    const { payload } = this.requireUnlocked();
    const t = payload.trash.find((x) => x.id === id);
    if (!t) throw new AppError('NOT_FOUND', 'Item not found in Recently Deleted.');
    if (!this.categories().some((c) => c.id === t.categoryId)) {
      throw new AppError('NO_CATEGORY', 'The category of this item no longer exists. Re-create it first.');
    }
    const restored = await this.mutate((d) => {
      const item = d.trash.find((x) => x.id === id)!;
      d.trash = d.trash.filter((x) => x.id !== id);
      const { deletedAt: _deleted, ...entry } = item;
      const e: VaultEntry = { ...entry, updatedAt: this.iso() };
      d.entries.push(e);
      return e;
    });
    return this.toView(restored);
  }

  /** Permanently delete one item from Recently Deleted (and its attachment files). */
  async purgeEntry(id: unknown): Promise<void> {
    const { payload } = this.requireUnlocked();
    const t = payload.trash.find((x) => x.id === id);
    if (!t) throw new AppError('NOT_FOUND', 'Item not found in Recently Deleted.');
    await this.mutate((d) => {
      d.trash = d.trash.filter((x) => x.id !== id);
    });
    await this.removeAttachmentFiles(t.attachments ?? []);
  }

  async emptyTrash(): Promise<number> {
    const { payload } = this.requireUnlocked();
    const items = [...payload.trash];
    if (!items.length) return 0;
    await this.mutate((d) => {
      d.trash = [];
    });
    await this.removeAttachmentFiles(items.flatMap((t) => t.attachments ?? []));
    return items.length;
  }

  private async purgeExpiredTrash(): Promise<void> {
    const { payload } = this.requireUnlocked();
    const cutoff = this.now().getTime() - TRASH_DAYS * 86_400_000;
    const expired = payload.trash.filter((t) => Date.parse(t.deletedAt) < cutoff);
    if (!expired.length) return;
    const ids = new Set(expired.map((t) => t.id));
    await this.mutate((d) => {
      d.trash = d.trash.filter((t) => !ids.has(t.id));
    });
    await this.removeAttachmentFiles(expired.flatMap((t) => t.attachments ?? []));
  }

  /** Delete attachment files that no item (active or deleted) references anymore. */
  private async removeAttachmentFiles(atts: AttachmentMeta[]): Promise<void> {
    const { payload } = this.requireUnlocked();
    const stillUsed = new Set([...payload.entries, ...payload.trash].flatMap((e) => (e.attachments ?? []).map((a) => a.id)));
    for (const a of atts) {
      if (stillUsed.has(a.id)) continue;
      await this.storage.remove(attachmentFile(a.id)).catch(() => undefined);
    }
  }

  async duplicateEntry(id: unknown): Promise<EntryView> {
    const src = this.findEntry(id);
    const now = this.iso();
    const copy = await this.mutate((d) => {
      const { attachments: _a, legacyImages: _l, ...rest } = structuredClone(src);
      const e: VaultEntry = {
        ...rest,
        id: globalThis.crypto.randomUUID(),
        title: `${src.title} (copy)`.slice(0, 200),
        favorite: false,
        favoriteOrder: 0,
        createdAt: now,
        updatedAt: now
      };
      d.entries.push(e);
      return e;
    });
    return this.toView(copy);
  }

  async setFavorite(id: unknown, favorite: boolean): Promise<void> {
    this.findEntry(id);
    await this.mutate((d) => {
      const e = d.entries.find((x) => x.id === id)!;
      if (favorite && !e.favorite) e.favoriteOrder = nextFavoriteOrder(d);
      e.favorite = favorite;
    });
  }

  async reorderFavorites(ids: unknown): Promise<void> {
    if (!Array.isArray(ids) || ids.length > 50_000) throw new AppError('INVALID', 'Invalid order.');
    await this.mutate((d) => {
      ids.forEach((id, i) => {
        const e = d.entries.find((x) => x.id === id);
        if (e?.favorite) e.favoriteOrder = i + 1;
      });
    });
  }

  // ---------------------------------------------------------- duplicates ----

  /**
   * Find POSSIBLE duplicates (never deletes anything). Items are grouped when they
   * share the same name in the same category, the same account/card/ID number,
   * or the same login on the same site. Secret values are compared here, inside
   * the vault, and never returned.
   */
  findDuplicates(): DuplicateGroup[] {
    const { payload } = this.requireUnlocked();
    const entries = payload.entries;
    const parent = entries.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    const reasons = new Map<string, Set<string>>(); // root-independent: pair key → reasons
    const byKey = new Map<string, number[]>();
    const add = (key: string, i: number) => {
      const list = byKey.get(key) ?? [];
      list.push(i);
      byKey.set(key, list);
    };
    entries.forEach((e, i) => {
      if (norm(e.title)) add(`Same name|${e.categoryId}|${norm(e.title)}`, i);
      for (const k of ID_KEYS) {
        const v = (e.fields[k] ?? '').replace(/[\s-]/g, '').toLowerCase();
        if (v.length >= 4) add(`${NUMBER_LABEL[k]}|${v}`, i);
      }
      const user = norm(e.fields.username ?? e.fields.email);
      const where = SITE_KEYS.map((k) => site(e.fields[k])).find(Boolean);
      if (user && where) add(`Same login|${user}@${where}`, i);
    });
    for (const [key, idx] of byKey) {
      if (idx.length < 2) continue;
      const label = key.split('|')[0]!;
      for (const i of idx.slice(1)) parent[find(i)] = find(idx[0]!);
      for (const i of idx) {
        const id = entries[i]!.id;
        const set = reasons.get(id) ?? new Set<string>();
        set.add(label);
        reasons.set(id, set);
      }
    }
    const groups = new Map<number, number[]>();
    entries.forEach((_, i) => {
      const r = find(i);
      groups.set(r, [...(groups.get(r) ?? []), i]);
    });
    const dismissed = new Set(payload.meta.dismissedDuplicates);
    const out: DuplicateGroup[] = [];
    for (const idx of groups.values()) {
      if (idx.length < 2) continue;
      const items = idx.map((i) => entries[i]!);
      const key = items
        .map((e) => e.id)
        .sort()
        .join('|');
      if (dismissed.has(key)) continue;
      const why = new Set<string>();
      for (const e of items) for (const r of reasons.get(e.id) ?? []) why.add(r);
      out.push({ key, reasons: [...why], items: items.map((e) => this.toView(e)), fields: this.compareFields(items) });
    }
    return out;
  }

  private compareFields(items: VaultEntry[]): FieldComparison[] {
    const out: FieldComparison[] = [];
    const seen = new Set<string>();
    const consider = (key: string, label: string, secret: boolean, get: (e: VaultEntry) => string) => {
      if (seen.has(key)) return;
      seen.add(key);
      const values = items.map((e) => get(e).trim());
      const filled = values.filter(Boolean);
      if (!filled.length) return;
      const distinct = new Set(filled);
      const status: FieldComparison['status'] = distinct.size > 1 ? 'different' : filled.length < values.length ? 'partial' : 'same';
      out.push({ key, label, secret, status });
    };
    consider('title', 'Name', false, (e) => e.title);
    for (const e of items) {
      for (const def of this.categoryOf(e)?.fields ?? []) {
        consider(def.key, def.label, isSecretType(def.type), (x) => x.fields[def.key] ?? '');
      }
    }
    consider('tags', 'Tags', false, (e) => [...e.tags].sort().join(', '));
    return out;
  }

  /** Mark a group as "not duplicates" so it is not suggested again. */
  async dismissDuplicate(key: unknown): Promise<void> {
    if (typeof key !== 'string' || key.length > 300) throw new AppError('INVALID', 'Invalid group.');
    await this.mutate((d) => {
      if (!d.meta.dismissedDuplicates.includes(key)) d.meta.dismissedDuplicates.push(key);
    });
  }

  /**
   * Merge duplicates into `keepId`: empty fields of the kept item are filled from
   * the others, notes are combined, tags united, attachments moved. The other
   * items are moved to Recently Deleted (with any information that could not be
   * merged), so nothing is lost.
   */
  async mergeEntries(keepId: unknown, otherIds: unknown): Promise<EntryView> {
    const keep = this.findEntry(keepId);
    if (!Array.isArray(otherIds) || otherIds.length === 0 || otherIds.length > 20) throw new AppError('INVALID', 'Choose the items to merge.');
    const others = otherIds.map((id) => this.findEntry(id));
    if (others.some((o) => o.id === keep.id)) throw new AppError('INVALID', 'Choose the items to merge.');
    const now = this.iso();
    const merged = await this.mutate((d) => {
      const k = d.entries.find((x) => x.id === keep.id)!;
      const cat = this.categories().find((c) => c.id === k.categoryId);
      for (const o of others.map((x) => d.entries.find((y) => y.id === x.id)!)) {
        for (const def of cat?.fields ?? []) {
          const mine = (k.fields[def.key] ?? '').trim();
          const theirs = (o.fields[def.key] ?? '').trim();
          if (!theirs) continue;
          if (!mine) k.fields[def.key] = o.fields[def.key]!;
          else if (def.key === 'notes' && mine !== theirs && !mine.includes(theirs)) {
            k.fields.notes = `${mine}\n\n— From “${o.title}”:\n${theirs}`.slice(0, 200_000);
          }
        }
        k.tags = [...new Set([...k.tags, ...o.tags])].slice(0, 30);
        if (o.favorite && !k.favorite) {
          k.favorite = true;
          k.favoriteOrder = nextFavoriteOrder(d);
        }
        // Move attachments that the kept item does not already have (by content hash).
        const have = new Set((k.attachments ?? []).map((a) => a.sha256));
        // Anything over the per-item limit stays with the other copy (in Recently Deleted).
        const room = Math.max(0, MAX_ATTACHMENTS_PER_ITEM - (k.attachments ?? []).length);
        const move = (o.attachments ?? []).filter((a) => !have.has(a.sha256)).slice(0, room);
        if (move.length) {
          k.attachments = [...(k.attachments ?? []), ...move.map((a) => ((k.attachments ?? []).some((x) => x.role && x.role === a.role) ? { ...a, role: undefined } : a))];
          const moved = new Set(move.map((a) => a.id));
          o.attachments = (o.attachments ?? []).filter((a) => !moved.has(a.id));
        }
        d.entries = d.entries.filter((x) => x.id !== o.id);
        d.trash.push({ ...o, favorite: false, deletedAt: now });
      }
      k.updatedAt = now;
      return k;
    });
    return this.toView(merged);
  }

  // ----------------------------------------------------------- categories ----

  async saveCategory(input: unknown): Promise<CategoryDef> {
    const v = validateCategoryInput(input);
    const clash = this.categories().find((c) => c.id !== v.id && norm(c.name) === norm(v.name));
    if (clash) throw new AppError('DUPLICATE', `A category named “${clash.name}” already exists.`);
    return this.mutate((d) => {
      if (v.id) {
        const c = d.customCategories.find((x) => x.id === v.id);
        if (!c) throw new AppError('NOT_FOUND', 'Category not found.');
        Object.assign(c, { name: v.name, icon: v.icon, fields: v.fields });
        const keys = new Set(v.fields.map((f) => f.key));
        for (const e of d.entries) {
          if (e.categoryId === c.id) e.fields = Object.fromEntries(Object.entries(e.fields).filter(([k]) => keys.has(k)));
        }
        return { ...c };
      }
      if (d.customCategories.length >= 100) throw new AppError('LIMIT', 'Too many categories.');
      const c: CategoryDef = { id: `c-${globalThis.crypto.randomUUID()}`, name: v.name, icon: v.icon, fields: v.fields, builtin: false };
      d.customCategories.push(c);
      return { ...c };
    });
  }

  async deleteCategory(id: unknown): Promise<void> {
    const { payload } = this.requireUnlocked();
    if (!payload.customCategories.some((c) => c.id === id)) throw new AppError('NOT_FOUND', 'Category not found.');
    const inUse = payload.entries.filter((e) => e.categoryId === id).length;
    if (inUse) throw new AppError('IN_USE', `This category still contains ${inUse} item(s). Move or delete them first.`);
    const inTrash = payload.trash.filter((e) => e.categoryId === id).length;
    if (inTrash) throw new AppError('IN_USE', `${inTrash} deleted item(s) of this category are in Recently Deleted. Remove them there first.`);
    await this.mutate((d) => {
      d.customCategories = d.customCategories.filter((c) => c.id !== id);
    });
  }

  async updateSettings(patch: unknown): Promise<VaultSettings> {
    const { payload } = this.requireUnlocked();
    const merged = validateSettings({ ...payload.settings, ...(patch && typeof patch === 'object' ? patch : {}) }, payload.settings);
    await this.mutate((d) => {
      d.settings = merged;
    });
    return structuredClone(merged);
  }

  // ---------------------------------------------------------- attachments ----

  private entryOrTrash(id: unknown): VaultEntry {
    const { payload } = this.requireUnlocked();
    const e = typeof id === 'string' ? (payload.entries.find((x) => x.id === id) ?? payload.trash.find((x) => x.id === id)) : undefined;
    if (!e) throw new AppError('NOT_FOUND', 'Item not found.');
    return e;
  }

  /** Attachment metadata (with thumbnails) — only requested when an item is opened. */
  listAttachments(entryId: unknown): AttachmentMeta[] {
    return structuredClone(this.entryOrTrash(entryId).attachments ?? []);
  }

  private async sealToFile(name: string, id: string, bytes: Uint8Array, key: CryptoKey): Promise<void> {
    await this.storage.writeAtomic(name, toB64(await sealBytes(key, bytes, attachmentAad(id))));
  }

  private async openFromFile(name: string, id: string, key: CryptoKey): Promise<Uint8Array> {
    const raw = await this.storage.read(name);
    if (!raw) throw new AppError('ATTACHMENT_MISSING', 'This attachment file is missing.');
    try {
      return await openBytes(key, fromB64(raw.trim()), attachmentAad(id));
    } catch {
      throw new AppError('ATTACHMENT_DAMAGED', 'This attachment could not be opened. It may be damaged.');
    }
  }

  async addAttachment(entryId: unknown, input: unknown): Promise<AddAttachmentResult> {
    const { key } = this.requireUnlocked();
    const entry = this.findEntry(entryId);
    const i = (input && typeof input === 'object' ? input : {}) as Partial<AttachmentInput>;
    if (typeof i.data !== 'string' || !i.data) throw new AppError('INVALID', 'No file was selected.');
    if (i.data.length > Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8) {
      throw new AppError('TOO_LARGE', `Files can be at most ${Math.round(MAX_ATTACHMENT_BYTES / 1048576)} MB.`);
    }
    let bytes: Uint8Array;
    try {
      bytes = fromB64(i.data);
    } catch {
      throw new AppError('INVALID', 'This file could not be read.');
    }
    if (bytes.length === 0) throw new AppError('INVALID', 'This file is empty.');
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new AppError('TOO_LARGE', `Files can be at most ${Math.round(MAX_ATTACHMENT_BYTES / 1048576)} MB.`);
    }
    if ((entry.attachments ?? []).length >= MAX_ATTACHMENTS_PER_ITEM) {
      throw new AppError('LIMIT', `An item can have at most ${MAX_ATTACHMENTS_PER_ITEM} attachments.`);
    }
    const sha256 = await sha256Hex(bytes);
    const existing = (entry.attachments ?? []).find((a) => a.sha256 === sha256);
    if (existing && i.allowDuplicate !== true) return { status: 'duplicate', existing: structuredClone(existing) };
    const free = await this.storage.freeSpace().catch(() => null);
    if (free !== null && free < bytes.length * 2 + 20 * 1048576) {
      throw new AppError('NO_SPACE', 'There is not enough free storage on this device for this file.');
    }
    const mime = typeof i.mime === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(i.mime) && i.mime.length <= 100 ? i.mime.toLowerCase() : 'application/octet-stream';
    const meta: AttachmentMeta = {
      id: globalThis.crypto.randomUUID(),
      name: cleanFileName(i.name),
      mime,
      size: bytes.length,
      sha256,
      createdAt: this.iso()
    };
    if (i.role === 'front' || i.role === 'back') meta.role = i.role;
    if (typeof i.thumb === 'string' && i.thumb.length <= 80_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(i.thumb)) {
      meta.thumb = i.thumb;
    }
    const file = attachmentFile(meta.id);
    await this.serial(async () => {
      try {
        await this.sealToFile(file, meta.id, bytes, key);
      } catch {
        throw new AppError('WRITE_FAILED', 'Could not save the attachment. Check your free storage.');
      }
      try {
        await this.mutateNow((d) => {
          const e = d.entries.find((x) => x.id === entry.id);
          if (!e) throw new AppError('NOT_FOUND', 'Item not found.');
          const list = (e.attachments ?? []).map((a) => (meta.role && a.role === meta.role ? { ...a, role: undefined } : a));
          e.attachments = [...list, meta];
          e.updatedAt = this.iso();
        });
      } catch (err) {
        await this.storage.remove(file).catch(() => undefined);
        throw err;
      }
    });
    return { status: 'added', attachment: structuredClone(meta) };
  }

  /** Decrypted attachment content (base64). Only on an explicit view/export. */
  async readAttachment(entryId: unknown, attachmentId: unknown): Promise<string> {
    const { key } = this.requireUnlocked();
    const a = (this.entryOrTrash(entryId).attachments ?? []).find((x) => x.id === attachmentId);
    if (!a) throw new AppError('NOT_FOUND', 'Attachment not found.');
    return toB64(await this.openFromFile(attachmentFile(a.id), a.id, key));
  }

  async updateAttachment(entryId: unknown, attachmentId: unknown, patch: unknown): Promise<AttachmentMeta> {
    const entry = this.findEntry(entryId);
    if (!(entry.attachments ?? []).some((a) => a.id === attachmentId)) throw new AppError('NOT_FOUND', 'Attachment not found.');
    const p = (patch && typeof patch === 'object' ? patch : {}) as { name?: unknown; role?: unknown };
    return this.mutate((d) => {
      const e = d.entries.find((x) => x.id === entry.id)!;
      let out: AttachmentMeta | undefined;
      const role = p.role === 'front' || p.role === 'back' ? p.role : p.role === null ? null : undefined;
      e.attachments = (e.attachments ?? []).map((a) => {
        if (a.id !== attachmentId) return role && a.role === role ? { ...a, role: undefined } : a;
        const next: AttachmentMeta = { ...a };
        if (p.name !== undefined) next.name = cleanFileName(p.name);
        if (role) next.role = role;
        else if (role === null) delete next.role;
        out = next;
        return next;
      });
      e.updatedAt = this.iso();
      return structuredClone(out!);
    });
  }

  /** Permanently delete one attachment (the UI asks for confirmation first). */
  async deleteAttachment(entryId: unknown, attachmentId: unknown): Promise<void> {
    const entry = this.findEntry(entryId);
    const a = (entry.attachments ?? []).find((x) => x.id === attachmentId);
    if (!a) throw new AppError('NOT_FOUND', 'Attachment not found.');
    await this.mutate((d) => {
      const e = d.entries.find((x) => x.id === entry.id)!;
      e.attachments = (e.attachments ?? []).filter((x) => x.id !== attachmentId);
      e.updatedAt = this.iso();
    });
    await this.removeAttachmentFiles([a]);
  }

  /** Turn old "card photo" fields into front/back attachments. */
  private async migrateLegacyImages(): Promise<void> {
    const { payload, key } = this.requireUnlocked();
    const pending = payload.entries.filter((e) => e.legacyImages);
    if (!pending.length) return;
    const made = new Map<string, AttachmentMeta[]>();
    for (const e of pending) {
      const metas: AttachmentMeta[] = [];
      for (const role of ['front', 'back'] as const) {
        const url = e.legacyImages?.[role];
        if (!url) continue;
        const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(url);
        if (!m) continue;
        const bytes = fromB64(m[2]!);
        const meta: AttachmentMeta = {
          id: globalThis.crypto.randomUUID(),
          name: `Card ${role}.${m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg'}`,
          mime: m[1]!,
          size: bytes.length,
          sha256: await sha256Hex(bytes),
          createdAt: this.iso(),
          role
        };
        await this.sealToFile(attachmentFile(meta.id), meta.id, bytes, key);
        metas.push(meta);
      }
      made.set(e.id, metas);
    }
    await this.mutate((d) => {
      for (const e of d.entries) {
        const metas = made.get(e.id);
        if (!metas) continue;
        e.attachments = [...(e.attachments ?? []).filter((a) => !metas.some((m) => m.role && m.role === a.role)), ...metas];
        delete e.legacyImages;
      }
    });
  }

  /** Finish a password change interrupted after the vault was re-encrypted. */
  private async recoverPendingAttachments(): Promise<void> {
    const { key } = this.requireUnlocked();
    for (const f of await this.storage.list()) {
      const m = /^att-([A-Za-z0-9-]{8,64})\.new$/.exec(f.name);
      if (!m) continue;
      const id = m[1]!;
      try {
        await this.openFromFile(f.name, id, key); // encrypted with the CURRENT key?
        await this.storage.rename(f.name, attachmentFile(id));
      } catch {
        await this.storage.remove(f.name).catch(() => undefined); // stale: old-key copy still in place
      }
    }
  }

  async storageInfo(): Promise<StorageInfo> {
    const { payload } = this.requireUnlocked();
    const files = await this.storage.list().catch(() => []);
    const vaultBytes = files.find((f) => f.name === VAULT_FILE)?.size ?? 0;
    const atts = files.filter((f) => f.name.endsWith('.att'));
    return {
      vaultBytes,
      attachmentBytes: atts.reduce((n, f) => n + f.size, 0),
      attachmentCount: payload.entries.reduce((n, e) => n + (e.attachments?.length ?? 0), 0),
      freeBytes: await this.storage.freeSpace().catch(() => null)
    };
  }

  // ------------------------------------------------------- master password ----

  /**
   * Change the master password: new salt + key, re-encrypt every attachment to
   * a side file (att-*.new), verify and write the vault, then swap the files in.
   * If anything fails before the vault is written, nothing changes. If the app
   * dies after the vault was written, the next unlock finishes the swap.
   */
  async changePassword(current: string, next: string, hint: string | null): Promise<void> {
    this.requireUnlocked();
    if (!(await this.verifyPassword(current))) {
      this.registerFailure();
      throw new ValidationError('current', 'The current master password is incorrect.');
    }
    validateNewMasterPassword(next, 'next');
    const cleanHint = this.cleanHint(hint, next);
    const kdf = newKdfParams();
    const newKey = await deriveKey(next, kdf);
    await this.serial(async () => {
      const { payload, key: oldKey } = this.requireUnlocked();
      const header = { createdAt: this.header!.createdAt, hint: cleanHint };
      const ids = [...new Set([...payload.entries, ...payload.trash].flatMap((e) => (e.attachments ?? []).map((a) => a.id)))];
      const written: string[] = [];
      try {
        for (const id of ids) {
          let bytes: Uint8Array;
          try {
            bytes = await this.openFromFile(attachmentFile(id), id, oldKey);
          } catch {
            continue; // missing/damaged file: nothing to re-encrypt
          }
          await this.sealToFile(pendingAttachmentFile(id), id, bytes, newKey);
          written.push(id);
        }
        const data = await this.serialize('vault', newKey, kdf, header, payload);
        validatePayload(JSON.parse(await openFile(parseFile(data), newKey))); // verify before replacing
        await this.storage.writeAtomic(VAULT_FILE, data);
      } catch {
        for (const id of written) await this.storage.remove(pendingAttachmentFile(id)).catch(() => undefined);
        throw new AppError('REENCRYPT_FAILED', 'Re-encryption failed. Your vault and master password are unchanged.');
      }
      this.key = newKey;
      this.kdf = kdf;
      this.header = header;
      for (const id of written) {
        await this.storage.rename(pendingAttachmentFile(id), attachmentFile(id)).catch(() => undefined); // finished on next unlock if this fails
      }
    });
  }

  // --------------------------------------------------------------- backups ----

  /**
   * Encrypted backup: the vault file plus every attachment (each still
   * encrypted with the vault key and bound to its id).
   */
  async buildBackup(): Promise<string> {
    const { key, payload } = this.requireUnlocked();
    const json = await this.serialize('backup', key, this.kdf!, this.header!, payload);
    const ids = [...new Set([...payload.entries, ...payload.trash].flatMap((e) => (e.attachments ?? []).map((a) => a.id)))];
    if (!ids.length) return json;
    const doc = JSON.parse(json) as Record<string, unknown>;
    const attachments: Record<string, string> = {};
    for (const id of ids) {
      const raw = await this.storage.read(attachmentFile(id));
      if (raw) attachments[id] = raw.trim();
    }
    doc.attachments = attachments;
    return JSON.stringify(doc);
  }

  /** Verify a backup decrypts to the current vault and every attachment opens. */
  async verifyBackup(data: string): Promise<boolean> {
    const { key, payload } = this.requireUnlocked();
    try {
      const restored = validatePayload(JSON.parse(await openFile(parseFile(data), key)));
      if (restored.entries.length !== payload.entries.length) return false;
      const atts = readBackupAttachments(data);
      for (const a of restored.entries.flatMap((e) => e.attachments ?? [])) {
        const blob = atts[a.id];
        if (!blob) return false;
        await openBytes(key, fromB64(blob), attachmentAad(a.id));
      }
      return true;
    } catch {
      return false;
    }
  }

  async markBackup(verified: boolean): Promise<void> {
    await this.mutate((d) => {
      d.meta.lastBackupAt = this.iso();
      d.meta.lastBackupVerified = verified;
    });
  }

  static async decryptFile(raw: string, password: string): Promise<OpenedBackup> {
    let file: ParsedFile;
    try {
      file = parseFile(raw);
    } catch {
      throw new AppError('INVALID_BACKUP', 'This file is not a valid VaultLocks backup.');
    }
    try {
      const key = await deriveKey(password, file.kdf);
      const payload = validatePayload(JSON.parse(await openFile(file, key)));
      return { payload, key, file, attachments: readBackupAttachments(raw) };
    } catch (e) {
      if (e instanceof CryptoError && e.code === 'BAD_PARAMS') {
        throw new AppError('INVALID_BACKUP', 'This backup uses unsupported security parameters.');
      }
      throw new AppError('BACKUP_AUTH_FAILED', 'Unable to open backup. The password may be incorrect or the file may be corrupted.');
    }
  }

  /** Re-encrypt a backup's attachments with the current vault key into place. */
  private async importAttachments(entries: VaultEntry[], backup: OpenedBackup, key: CryptoKey): Promise<string[]> {
    const written: string[] = [];
    for (const a of entries.flatMap((e) => e.attachments ?? [])) {
      const blob = backup.attachments[a.id];
      if (!blob) continue;
      const bytes = await openBytes(backup.key, fromB64(blob), attachmentAad(a.id));
      await this.sealToFile(attachmentFile(a.id), a.id, bytes, key);
      written.push(a.id);
    }
    return written;
  }

  /**
   * Restore a backup into the open vault (current master password is kept).
   * "replace" moves current items to Recently Deleted instead of erasing them.
   */
  async applyBackup(backup: OpenedBackup, mode: 'replace' | 'merge'): Promise<void> {
    const { key, payload } = this.requireUnlocked();
    const currentIds = new Set(payload.entries.map((e) => e.id));
    const incoming = mode === 'replace' ? backup.payload.entries : backup.payload.entries.filter((e) => !currentIds.has(e.id));
    await this.serial(async () => {
      let written: string[] = [];
      try {
        written = await this.importAttachments(incoming, backup, key);
      } catch {
        for (const id of written) await this.storage.remove(attachmentFile(id)).catch(() => undefined);
        throw new AppError('RESTORE_FAILED', 'The backup attachments could not be restored. Nothing was changed.');
      }
      const now = this.iso();
      await this.mutateNow((d) => {
        if (mode === 'replace') {
          const incomingById = new Map(incoming.map((e) => [e.id, e]));
          for (const e of d.entries) {
            const replacement = incomingById.get(e.id);
            if (!replacement) d.trash.push({ ...e, favorite: false, deletedAt: now });
            // Same item, different content: keep the current version recoverable too.
            else if (JSON.stringify(replacement) !== JSON.stringify(e)) {
              d.trash.push({ ...structuredClone(e), id: globalThis.crypto.randomUUID(), favorite: false, deletedAt: now });
            }
          }
          d.entries = structuredClone(incoming);
          const cats = new Map(d.customCategories.map((c) => [c.id, c]));
          for (const c of backup.payload.customCategories) cats.set(c.id, structuredClone(c));
          d.customCategories = [...cats.values()];
          return;
        }
        const cats = new Set(d.customCategories.map((c) => c.id));
        for (const c of backup.payload.customCategories) if (!cats.has(c.id)) d.customCategories.push(structuredClone(c));
        d.entries.push(...structuredClone(incoming));
      });
    });
  }

  /** Restore while locked: the backup's password becomes the master password. */
  async restoreWhileLocked(raw: string, password: string): Promise<void> {
    if (this.isUnlocked) throw new AppError('UNLOCKED', 'Lock the vault first.');
    const backup = await VaultCore.decryptFile(raw, password);
    const header = { createdAt: backup.file.createdAt, hint: backup.file.hint };
    try {
      // Same key as the backup, so attachment files are written as they are.
      for (const [id, blob] of Object.entries(backup.attachments)) {
        await this.storage.writeAtomic(attachmentFile(id), blob);
      }
      await this.storage.writeAtomic(VAULT_FILE, await this.serialize('vault', backup.key, backup.file.kdf, header, backup.payload));
    } catch {
      throw new AppError('WRITE_FAILED', 'Could not write the restored vault.');
    }
    this.setSession(backup.key, backup.file, backup.payload);
    await this.afterUnlock();
  }

  async databaseInfo(): Promise<DatabaseInfo> {
    const { payload } = this.requireUnlocked();
    const st = await this.storage.stat(VAULT_FILE);
    const info = await this.storageInfo();
    return {
      path: this.storage.location,
      sizeBytes: st?.size ?? 0,
      formatVersion: 1,
      kdf: `Argon2id · ${Math.round(this.kdf!.memoryKiB / 1024)} MiB · ${this.kdf!.iterations} passes · ${this.kdf!.parallelism} lanes`,
      cipher: 'AES-256-GCM (authenticated)',
      createdAt: this.header!.createdAt,
      modifiedAt: new Date(st?.mtime ?? Date.now()).toISOString(),
      itemCount: payload.entries.length,
      attachmentCount: info.attachmentCount,
      attachmentBytes: info.attachmentBytes
    };
  }

  /** Plaintext export — only reachable after re-authentication. Attachments are listed, not included. */
  plaintextExport(): object {
    const { payload } = this.requireUnlocked();
    const cats = this.categories();
    return {
      warning: 'UNENCRYPTED EXPORT — contains all of your passwords in plain text. Delete securely after use.',
      exportedAt: this.iso(),
      items: payload.entries.map((e) => {
        const cat = cats.find((c) => c.id === e.categoryId);
        return {
          title: e.title,
          category: cat?.name ?? e.categoryId,
          fields: Object.fromEntries((cat?.fields ?? []).filter((f) => e.fields[f.key]).map((f) => [f.label, e.fields[f.key]])),
          tags: e.tags,
          favorite: e.favorite,
          attachments: (e.attachments ?? []).map((a) => a.name)
        };
      })
    };
  }
}

function nextFavoriteOrder(p: VaultPayload): number {
  return p.entries.reduce((m, e) => (e.favorite ? Math.max(m, e.favoriteOrder) : m), 0) + 1;
}

/** The "attachments" section of a backup file: id → base64 encrypted blob. */
function readBackupAttachments(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return out;
  }
  const atts = doc && typeof doc === 'object' ? (doc as { attachments?: unknown }).attachments : undefined;
  if (!atts || typeof atts !== 'object') return out;
  for (const [id, blob] of Object.entries(atts as Record<string, unknown>)) {
    if (/^[A-Za-z0-9-]{8,64}$/.test(id) && typeof blob === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(blob)) out[id] = blob;
  }
  return out;
}
