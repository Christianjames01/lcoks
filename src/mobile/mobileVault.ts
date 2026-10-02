// ============================================================================
// SECURITY-CRITICAL MODULE — vault session for the Android app.
//
// Mirrors src/main/vault/vaultService.ts (desktop). While LOCKED nothing is held.
// While UNLOCKED: a non-extractable AES-GCM CryptoKey + the decrypted payload.
// Every mutation re-encrypts with a fresh nonce and is written atomically; a
// failed write leaves both memory and the stored file unchanged.
// ============================================================================

import { BUILTIN_CATEGORIES } from '../shared/categories';
import { estimateStrength } from '../shared/strength';
import {
  DEFAULT_SETTINGS,
  isSecretType,
  type CategoryDef,
  type DatabaseInfo,
  type EntryView,
  type SecretMeta,
  type VaultEntry,
  type VaultPayload,
  type VaultSettings,
  type VaultSnapshot
} from '../shared/types';
import {
  ValidationError,
  validateCategoryInput,
  validateEntryInput,
  validateNewMasterPassword,
  validatePayload,
  validateSettings
} from '../main/vault/schema';
import {
  MAX_HINT_LENGTH,
  MobileCryptoError,
  buildFile,
  deriveKey,
  newKdfParams,
  openFile,
  parseFile,
  type FileKind,
  type KdfParams,
  type ParsedFile
} from './crypto';
import type { NativeVault } from './native';

export const VAULT_FILE = 'vault.vault';
export const UNLOCK_FAILED_MESSAGE = 'Unable to unlock vault. The password may be incorrect or the vault may be corrupted.';

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

export class MobileVault {
  private key: CryptoKey | null = null;
  private kdf: KdfParams | null = null;
  private header: HeaderMeta | null = null;
  private payload: VaultPayload | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private failedAttempts = 0;
  private lockedOutUntil = 0;

  constructor(private readonly native: NativeVault) {}

  get isUnlocked(): boolean {
    return this.key !== null && this.payload !== null;
  }

  get settings(): VaultSettings {
    return this.payload?.settings ?? DEFAULT_SETTINGS;
  }

  async exists(): Promise<boolean> {
    return (await this.native.stat(VAULT_FILE)) !== null;
  }

  async getHint(): Promise<string | null> {
    try {
      const raw = await this.native.read(VAULT_FILE);
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

  // ------------------------------------------------------- create / unlock ----

  async create(password: string, hint: string | null): Promise<void> {
    if (await this.exists()) throw new AppError('EXISTS', 'A vault already exists on this device.');
    validateNewMasterPassword(password);
    const cleanHint = this.cleanHint(hint, password);
    const kdf = newKdfParams();
    const key = await deriveKey(password, kdf);
    const createdAt = new Date().toISOString();
    this.key = key;
    this.kdf = kdf;
    this.header = { createdAt, hint: cleanHint };
    this.payload = {
      schema: 1,
      entries: [],
      customCategories: [],
      settings: { ...DEFAULT_SETTINGS },
      meta: { createdAt, lastBackupAt: null, lastBackupVerified: false }
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
      const raw = await this.native.read(VAULT_FILE);
      if (!raw) throw new Error();
      const file = parseFile(raw);
      const key = await deriveKey(password, file.kdf);
      const payload = validatePayload(JSON.parse(await openFile(file, key)));
      this.key = key;
      this.kdf = file.kdf;
      this.header = { createdAt: file.createdAt, hint: file.hint };
      this.payload = payload;
      this.failedAttempts = 0;
      this.lockedOutUntil = 0;
    } catch {
      this.registerFailure();
      throw new AppError('UNLOCK_FAILED', UNLOCK_FAILED_MESSAGE);
    }
  }

  private registerFailure(): void {
    this.failedAttempts++;
    if (this.failedAttempts >= 3) this.lockedOutUntil = Date.now() + Math.min(60, 2 ** (this.failedAttempts - 3) * 2) * 1000;
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
      const raw = await this.native.read(VAULT_FILE);
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
    await this.native.writeAtomic(VAULT_FILE, await this.serialize('vault', key, this.kdf!, this.header!, payload));
  }

  /** Run strictly one at a time (mutations, password change). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private mutate<T>(fn: (draft: VaultPayload) => T): Promise<T> {
    return this.serial(async () => {
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
    });
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
    for (const def of this.categoryOf(entry)?.fields ?? []) {
      const value = entry.fields[def.key] ?? '';
      if (isSecretType(def.type)) {
        const meta: SecretMeta = { set: value.length > 0 };
        if (def.partialMask && value.length > 4) meta.preview = '•••• ' + value.replace(/\s/g, '').slice(-4);
        if (def.type === 'password' && value) meta.strength = estimateStrength(value).score;
        secrets[def.key] = meta;
      } else if (value) {
        fields[def.key] = value;
      }
    }
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
      updatedAt: entry.updatedAt
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
    return {
      entries,
      categories: this.categories(),
      settings: { ...payload.settings },
      meta: { ...payload.meta },
      stats: {
        total: entries.length,
        withPasswords,
        notes: entries.filter((e) => e.categoryId === 'notes').length,
        favorites: entries.filter((e) => e.favorite).length,
        weak
      }
    };
  }

  private findEntry(id: unknown): VaultEntry {
    const { payload } = this.requireUnlocked();
    const e = typeof id === 'string' ? payload.entries.find((x) => x.id === id) : undefined;
    if (!e) throw new AppError('NOT_FOUND', 'Item not found.');
    return e;
  }

  getSecret(id: unknown, fieldKey: unknown): string {
    const entry = this.findEntry(id);
    const def = this.categoryOf(entry)?.fields.find((f) => f.key === fieldKey);
    if (!def) throw new AppError('NOT_FOUND', 'Field not found.');
    return entry.fields[def.key] ?? '';
  }

  getEntryForEdit(id: unknown): VaultEntry {
    return structuredClone(this.findEntry(id));
  }

  // -------------------------------------------------------------- entries ----

  async saveEntry(input: unknown): Promise<EntryView> {
    const v = validateEntryInput(input, this.categories());
    const now = new Date().toISOString();
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

  async deleteEntry(id: unknown): Promise<void> {
    this.findEntry(id);
    await this.mutate((d) => {
      d.entries = d.entries.filter((e) => e.id !== id);
    });
  }

  async duplicateEntry(id: unknown): Promise<EntryView> {
    const src = this.findEntry(id);
    const now = new Date().toISOString();
    const copy = await this.mutate((d) => {
      const e: VaultEntry = {
        ...structuredClone(src),
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

  // ----------------------------------------------------------- categories ----

  async saveCategory(input: unknown): Promise<CategoryDef> {
    const v = validateCategoryInput(input);
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
    return { ...merged };
  }

  // ------------------------------------------------------- master password ----

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
      const { payload } = this.requireUnlocked();
      const header = { createdAt: this.header!.createdAt, hint: cleanHint };
      try {
        const data = await this.serialize('vault', newKey, kdf, header, payload);
        validatePayload(JSON.parse(await openFile(parseFile(data), newKey))); // verify before replacing
        await this.native.writeAtomic(VAULT_FILE, data);
      } catch {
        throw new AppError('REENCRYPT_FAILED', 'Re-encryption failed. Your vault and master password are unchanged.');
      }
      this.key = newKey;
      this.kdf = kdf;
      this.header = header;
    });
  }

  // --------------------------------------------------------------- backups ----

  async buildBackup(): Promise<string> {
    const { key, payload } = this.requireUnlocked();
    return this.serialize('backup', key, this.kdf!, this.header!, payload);
  }

  async verifyBackup(data: string): Promise<boolean> {
    const { key, payload } = this.requireUnlocked();
    try {
      const restored = validatePayload(JSON.parse(await openFile(parseFile(data), key)));
      return restored.entries.length === payload.entries.length;
    } catch {
      return false;
    }
  }

  async markBackup(verified: boolean): Promise<void> {
    await this.mutate((d) => {
      d.meta.lastBackupAt = new Date().toISOString();
      d.meta.lastBackupVerified = verified;
    });
  }

  static async decryptFile(raw: string, password: string): Promise<{ payload: VaultPayload; key: CryptoKey; file: ParsedFile }> {
    let file: ParsedFile;
    try {
      file = parseFile(raw);
    } catch {
      throw new AppError('INVALID_BACKUP', 'This file is not a valid VaultLocks backup.');
    }
    try {
      const key = await deriveKey(password, file.kdf);
      const payload = validatePayload(JSON.parse(await openFile(file, key)));
      return { payload, key, file };
    } catch (e) {
      if (e instanceof MobileCryptoError && e.code === 'BAD_PARAMS') {
        throw new AppError('INVALID_BACKUP', 'This backup uses unsupported security parameters.');
      }
      throw new AppError('BACKUP_AUTH_FAILED', 'Unable to open backup. The password may be incorrect or the file may be corrupted.');
    }
  }

  async applyBackup(backup: VaultPayload, mode: 'replace' | 'merge'): Promise<void> {
    await this.mutate((d) => {
      if (mode === 'replace') {
        d.entries = structuredClone(backup.entries);
        d.customCategories = structuredClone(backup.customCategories);
        return;
      }
      const ids = new Set(d.entries.map((e) => e.id));
      const cats = new Set(d.customCategories.map((c) => c.id));
      for (const c of backup.customCategories) if (!cats.has(c.id)) d.customCategories.push(structuredClone(c));
      for (const e of backup.entries) if (!ids.has(e.id)) d.entries.push(structuredClone(e));
    });
  }

  /** Restore while locked: the backup's password becomes the master password. */
  async restoreWhileLocked(raw: string, password: string): Promise<void> {
    if (this.isUnlocked) throw new AppError('UNLOCKED', 'Lock the vault first.');
    const { payload, key, file } = await MobileVault.decryptFile(raw, password);
    const header = { createdAt: file.createdAt, hint: file.hint };
    try {
      await this.native.writeAtomic(VAULT_FILE, await this.serialize('vault', key, file.kdf, header, payload));
    } catch {
      throw new AppError('WRITE_FAILED', 'Could not write the restored vault.');
    }
    this.key = key;
    this.kdf = file.kdf;
    this.header = header;
    this.payload = payload;
  }

  async databaseInfo(): Promise<DatabaseInfo> {
    const { payload } = this.requireUnlocked();
    const st = await this.native.stat(VAULT_FILE);
    return {
      path: 'App-private storage on this phone (vault.vault)',
      sizeBytes: st?.size ?? 0,
      formatVersion: 1,
      kdf: `Argon2id · ${Math.round(this.kdf!.memoryKiB / 1024)} MiB · ${this.kdf!.iterations} passes · ${this.kdf!.parallelism} lanes`,
      cipher: 'AES-256-GCM (authenticated)',
      createdAt: this.header!.createdAt,
      modifiedAt: new Date(st?.mtime ?? Date.now()).toISOString(),
      itemCount: payload.entries.length
    };
  }

  plaintextExport(): object {
    const { payload } = this.requireUnlocked();
    const cats = this.categories();
    return {
      warning: 'UNENCRYPTED EXPORT — contains all of your passwords in plain text. Delete securely after use.',
      exportedAt: new Date().toISOString(),
      items: payload.entries.map((e) => {
        const cat = cats.find((c) => c.id === e.categoryId);
        return {
          title: e.title,
          category: cat?.name ?? e.categoryId,
          fields: Object.fromEntries((cat?.fields ?? []).filter((f) => e.fields[f.key]).map((f) => [f.label, e.fields[f.key]])),
          tags: e.tags,
          favorite: e.favorite
        };
      })
    };
  }
}

function nextFavoriteOrder(p: VaultPayload): number {
  return p.entries.reduce((m, e) => (e.favorite ? Math.max(m, e.favoriteOrder) : m), 0) + 1;
}
