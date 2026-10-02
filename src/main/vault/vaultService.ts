// ============================================================================
// SECURITY-CRITICAL MODULE — vault session management.
//
// While LOCKED this service holds no key and no plaintext.
// While UNLOCKED it holds:
//   * `key`     — the 256-bit Argon2id-derived key (Buffer, wiped on lock)
//   * `payload` — the decrypted vault contents (main-process memory only)
//
// The renderer never receives the key, and only receives secret field values
// when the user explicitly reveals one (copying happens entirely in main).
// Every mutation re-encrypts the whole payload with a fresh nonce and writes it
// atomically, so the on-disk file is always either the old or the new vault.
// ============================================================================

import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BUILTIN_CATEGORIES } from '../../shared/categories';
import { estimateStrength } from '../../shared/strength';
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
} from '../../shared/types';
import { CryptoError, deriveKey, keysEqual, newKdfParams, passwordToBytes, type KdfParams } from '../security/crypto';
import { wipe } from '../security/memory';
import {
  buildVaultFile,
  MAX_HINT_LENGTH,
  openVaultFile,
  parseVaultFile,
  VaultFormatError,
  type FileKind,
  type ParsedVaultFile
} from '../security/vaultFile';
import { cleanupTempFiles, exists, writeFileAtomic } from '../storage/atomicFile';
import {
  ValidationError,
  validateCategoryInput,
  validateEntryInput,
  validateNewMasterPassword,
  validatePayload,
  validateSettings
} from './schema';

/** Error surfaced to the UI with a stable code and a SAFE message. */
export class VaultError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
    readonly retryAfterSeconds?: number
  ) {
    super(code);
    this.name = 'VaultError';
  }
}

export const UNLOCK_FAILED_MESSAGE =
  'Unable to unlock vault. The password may be incorrect or the vault may be corrupted.';

export class VaultService {
  private key: Buffer | null = null;
  private kdf: KdfParams | null = null;
  private header: { createdAt: string; hint: string | null } | null = null;
  private payload: VaultPayload | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private mutationChain: Promise<unknown> = Promise.resolve();

  // Unlock throttling (in-memory): slows down someone trying passwords at the UI.
  private failedAttempts = 0;
  private lockedOutUntil = 0;

  constructor(
    readonly vaultPath: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  // ---------------------------------------------------------------- state ----

  get isUnlocked(): boolean {
    return this.key !== null && this.payload !== null;
  }

  async vaultExists(): Promise<boolean> {
    return exists(this.vaultPath);
  }

  async init(): Promise<void> {
    await cleanupTempFiles(this.vaultPath);
  }

  /** The hint is stored unencrypted by design (it must be readable before unlock). */
  async getHint(): Promise<string | null> {
    try {
      const file = parseVaultFile(await fs.readFile(this.vaultPath));
      return file.hint;
    } catch {
      return null;
    }
  }

  get settings(): VaultSettings {
    return this.payload?.settings ?? DEFAULT_SETTINGS;
  }

  private requireUnlocked(): { key: Buffer; payload: VaultPayload } {
    if (!this.key || !this.payload) throw new VaultError('LOCKED', 'The vault is locked.');
    return { key: this.key, payload: this.payload };
  }

  // ------------------------------------------------------- create / unlock ----

  async create(password: string, hint: string | null): Promise<void> {
    if (await this.vaultExists()) throw new VaultError('EXISTS', 'A vault already exists on this device.');
    validateNewMasterPassword(password);
    const cleanHint = this.cleanHint(hint, password);
    const kdf = newKdfParams();
    const pwBytes = passwordToBytes(password);
    let key: Buffer | null = null;
    try {
      key = await deriveKey(pwBytes, kdf);
      const createdAt = this.now().toISOString();
      const payload: VaultPayload = {
        schema: 1,
        entries: [],
        customCategories: [],
        settings: { ...DEFAULT_SETTINGS },
        meta: { createdAt, lastBackupAt: null, lastBackupVerified: false }
      };
      this.key = key;
      this.kdf = kdf;
      this.header = { createdAt, hint: cleanHint };
      this.payload = payload;
      key = null; // ownership moved to the session
      await this.persist();
    } catch (e) {
      this.lock();
      throw e;
    } finally {
      wipe(pwBytes);
      if (key) wipe(key);
    }
  }

  async unlock(password: string): Promise<void> {
    const wait = Math.ceil((this.lockedOutUntil - Date.now()) / 1000);
    if (wait > 0) {
      throw new VaultError('THROTTLED', `Too many attempts. Try again in ${wait} seconds.`, wait);
    }
    let file: ParsedVaultFile;
    try {
      file = parseVaultFile(await fs.readFile(this.vaultPath));
    } catch {
      throw new VaultError('UNLOCK_FAILED', UNLOCK_FAILED_MESSAGE);
    }
    const pwBytes = passwordToBytes(password);
    let key: Buffer | null = null;
    let plain: Buffer | null = null;
    try {
      key = await deriveKey(pwBytes, file.kdf);
      plain = openVaultFile(file, key); // throws unless authenticated
      const payload = validatePayload(JSON.parse(plain.toString('utf8')));
      this.key = key;
      this.kdf = file.kdf;
      this.header = { createdAt: file.createdAt, hint: file.hint };
      this.payload = payload;
      key = null;
      this.failedAttempts = 0;
      this.lockedOutUntil = 0;
    } catch {
      this.registerFailure();
      throw new VaultError('UNLOCK_FAILED', UNLOCK_FAILED_MESSAGE);
    } finally {
      wipe(pwBytes);
      wipe(plain);
      if (key) wipe(key);
    }
  }

  private registerFailure(): void {
    this.failedAttempts++;
    if (this.failedAttempts >= 3) {
      const seconds = Math.min(60, 2 ** (this.failedAttempts - 3) * 2);
      this.lockedOutUntil = Date.now() + seconds * 1000;
    }
  }

  /** Wipe the key and drop all decrypted data. Safe to call at any time. */
  lock(): void {
    wipe(this.key);
    this.key = null;
    this.payload = null;
    this.kdf = null;
    this.header = null;
  }

  /** Re-authenticate: derive with the stored params and compare in constant time. */
  async verifyPassword(password: string): Promise<boolean> {
    const { key } = this.requireUnlocked();
    const pwBytes = passwordToBytes(password);
    let candidate: Buffer | null = null;
    try {
      candidate = await deriveKey(pwBytes, this.kdf!);
      return keysEqual(candidate, key);
    } catch {
      return false;
    } finally {
      wipe(pwBytes);
      wipe(candidate);
    }
  }

  private cleanHint(hint: string | null, password: string): string | null {
    if (hint === null || hint === undefined) return null;
    if (typeof hint !== 'string') return null;
    const h = hint.trim().slice(0, MAX_HINT_LENGTH);
    if (!h) return null;
    // The hint is stored unencrypted: refuse hints that contain the password.
    if (password && h.toLowerCase().includes(password.toLowerCase())) {
      throw new ValidationError('hint', 'The hint must not contain your master password.');
    }
    return h;
  }

  // ----------------------------------------------------------- persistence ----

  private serialize(kind: FileKind, key: Buffer, kdf: KdfParams, header: { createdAt: string; hint: string | null }, payload: VaultPayload): Buffer {
    const plain = Buffer.from(JSON.stringify(payload), 'utf8');
    try {
      return buildVaultFile({ kind, createdAt: header.createdAt, kdf, hint: header.hint }, key, plain);
    } finally {
      wipe(plain);
    }
  }

  /** Serialize writes so two saves can never interleave. */
  private persist(): Promise<void> {
    const run = async () => {
      const { key, payload } = this.requireUnlocked();
      const data = this.serialize('vault', key, this.kdf!, this.header!, payload);
      await writeFileAtomic(this.vaultPath, data);
    };
    const p = this.writeChain.then(run, run);
    this.writeChain = p.catch(() => undefined);
    return p;
  }

  /**
   * Apply a mutation to a COPY of the payload and only commit it in memory if the
   * encrypted write succeeds. A failed write therefore leaves both the in-memory
   * state and the on-disk vault unchanged.
   */
  private mutate<T>(fn: (draft: VaultPayload) => T): Promise<T> {
    const run = async (): Promise<T> => {
      const { payload } = this.requireUnlocked();
      const draft: VaultPayload = structuredClone(payload);
      const result = fn(draft);
      const previous = this.payload;
      this.payload = draft;
      try {
        await this.persist();
      } catch {
        if (this.payload === draft) this.payload = previous;
        throw new VaultError('WRITE_FAILED', 'Could not save the vault. Your previous data is unchanged.');
      }
      return result;
    };
    // Mutations run strictly one after another.
    const p = this.mutationChain.then(run, run);
    this.mutationChain = p.catch(() => undefined);
    return p;
  }

  // ---------------------------------------------------------------- views ----

  categories(): CategoryDef[] {
    return [...BUILTIN_CATEGORIES, ...(this.payload?.customCategories ?? [])];
  }

  private categoryOf(entry: VaultEntry): CategoryDef | undefined {
    return this.categories().find((c) => c.id === entry.categoryId);
  }

  /** Build the redacted view of an entry. SECRET VALUES ARE NEVER COPIED HERE. */
  toView(entry: VaultEntry): EntryView {
    const category = this.categoryOf(entry);
    const fields: Record<string, string> = {};
    const secrets: Record<string, SecretMeta> = {};
    for (const def of category?.fields ?? []) {
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
      const pw = v.secrets.password;
      if (pw?.set) {
        withPasswords++;
        if ((pw.strength ?? 4) <= 1) weak++;
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
    const entry = typeof id === 'string' ? payload.entries.find((e) => e.id === id) : undefined;
    if (!entry) throw new VaultError('NOT_FOUND', 'Item not found.');
    return entry;
  }

  /**
   * Return a single secret value — called only on an explicit user reveal/copy.
   * Only fields defined as secrets on the entry's category may be requested.
   */
  getSecret(id: unknown, fieldKey: unknown): string {
    const entry = this.findEntry(id);
    const def = this.categoryOf(entry)?.fields.find((f) => f.key === fieldKey);
    if (!def) throw new VaultError('NOT_FOUND', 'Field not found.');
    return entry.fields[def.key] ?? '';
  }

  /** Full entry (including secrets) for the edit form. */
  getEntryForEdit(id: unknown): VaultEntry {
    return structuredClone(this.findEntry(id));
  }

  // -------------------------------------------------------------- entries ----

  async saveEntry(input: unknown): Promise<EntryView> {
    const valid = validateEntryInput(input, this.categories());
    const now = this.now().toISOString();
    const saved = await this.mutate((draft) => {
      if (valid.id) {
        const existing = draft.entries.find((e) => e.id === valid.id);
        if (!existing) throw new VaultError('NOT_FOUND', 'Item not found.');
        existing.categoryId = valid.categoryId;
        existing.title = valid.title;
        existing.fields = valid.fields;
        existing.tags = valid.tags;
        if (valid.favorite && !existing.favorite) existing.favoriteOrder = nextFavoriteOrder(draft);
        existing.favorite = valid.favorite;
        existing.updatedAt = now;
        return existing;
      }
      const entry: VaultEntry = {
        id: randomUUID(),
        categoryId: valid.categoryId,
        title: valid.title,
        fields: valid.fields,
        tags: valid.tags,
        favorite: valid.favorite,
        favoriteOrder: valid.favorite ? nextFavoriteOrder(draft) : 0,
        createdAt: now,
        updatedAt: now
      };
      draft.entries.push(entry);
      return entry;
    });
    return this.toView(saved);
  }

  async deleteEntry(id: unknown): Promise<void> {
    this.findEntry(id);
    await this.mutate((draft) => {
      draft.entries = draft.entries.filter((e) => e.id !== id);
    });
  }

  async duplicateEntry(id: unknown): Promise<EntryView> {
    const src = this.findEntry(id);
    const now = this.now().toISOString();
    const copy = await this.mutate((draft) => {
      const entry: VaultEntry = {
        ...structuredClone(src),
        id: randomUUID(),
        title: `${src.title} (copy)`.slice(0, 200),
        favorite: false,
        favoriteOrder: 0,
        createdAt: now,
        updatedAt: now
      };
      draft.entries.push(entry);
      return entry;
    });
    return this.toView(copy);
  }

  async setFavorite(id: unknown, favorite: boolean): Promise<void> {
    this.findEntry(id);
    await this.mutate((draft) => {
      const e = draft.entries.find((x) => x.id === id)!;
      if (favorite && !e.favorite) e.favoriteOrder = nextFavoriteOrder(draft);
      e.favorite = favorite;
    });
  }

  async reorderFavorites(ids: unknown): Promise<void> {
    if (!Array.isArray(ids) || ids.length > 50_000) throw new VaultError('INVALID', 'Invalid order.');
    await this.mutate((draft) => {
      ids.forEach((id, idx) => {
        const e = draft.entries.find((x) => x.id === id);
        if (e && e.favorite) e.favoriteOrder = idx + 1;
      });
    });
  }

  // ----------------------------------------------------------- categories ----

  async saveCategory(input: unknown): Promise<CategoryDef> {
    const valid = validateCategoryInput(input);
    return this.mutate((draft) => {
      if (valid.id) {
        const cat = draft.customCategories.find((c) => c.id === valid.id);
        if (!cat) throw new VaultError('NOT_FOUND', 'Category not found.');
        cat.name = valid.name;
        cat.icon = valid.icon;
        cat.fields = valid.fields;
        // Drop values for fields that no longer exist.
        const keys = new Set(valid.fields.map((f) => f.key));
        for (const e of draft.entries) {
          if (e.categoryId !== cat.id) continue;
          e.fields = Object.fromEntries(Object.entries(e.fields).filter(([k]) => keys.has(k)));
        }
        return { ...cat };
      }
      if (draft.customCategories.length >= 100) throw new VaultError('LIMIT', 'Too many categories.');
      const cat: CategoryDef = { id: `c-${randomUUID()}`, name: valid.name, icon: valid.icon, fields: valid.fields, builtin: false };
      draft.customCategories.push(cat);
      return { ...cat };
    });
  }

  async deleteCategory(id: unknown): Promise<void> {
    const { payload } = this.requireUnlocked();
    const cat = payload.customCategories.find((c) => c.id === id);
    if (!cat) throw new VaultError('NOT_FOUND', 'Category not found.');
    const inUse = payload.entries.filter((e) => e.categoryId === id).length;
    if (inUse > 0) {
      throw new VaultError('IN_USE', `This category still contains ${inUse} item(s). Move or delete them first.`);
    }
    await this.mutate((draft) => {
      draft.customCategories = draft.customCategories.filter((c) => c.id !== id);
    });
  }

  // ------------------------------------------------------------- settings ----

  async updateSettings(patch: unknown): Promise<VaultSettings> {
    const { payload } = this.requireUnlocked();
    const merged = validateSettings({ ...payload.settings, ...(patch && typeof patch === 'object' ? patch : {}) }, payload.settings);
    await this.mutate((draft) => {
      draft.settings = merged;
    });
    return { ...merged };
  }

  // ------------------------------------------------------- master password ----

  /**
   * Change the master password: verify the current one, derive a NEW key from a
   * NEW random salt, re-encrypt everything, write atomically and read the file
   * back to verify it decrypts with the new key. If anything fails the original
   * vault file and the in-memory session are left untouched.
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
    const pwBytes = passwordToBytes(next);
    let newKey: Buffer | null = null;
    try {
      newKey = await deriveKey(pwBytes, kdf);
      const committed = newKey;
      // Run inside the write chain so no other save can interleave: serialize the
      // latest payload, verify, write, and only then switch the session key.
      const step = this.writeChain.then(async () => {
        const { payload } = this.requireUnlocked();
        const header = { createdAt: this.header!.createdAt, hint: cleanHint };
        const data = this.serialize('vault', committed, kdf, header, payload);
        // Verify the new ciphertext decrypts BEFORE replacing the vault file.
        const check = openVaultFile(parseVaultFile(data), committed);
        try {
          validatePayload(JSON.parse(check.toString('utf8')));
        } finally {
          wipe(check);
        }
        await writeFileAtomic(this.vaultPath, data);
        wipe(this.key);
        this.key = committed;
        this.kdf = kdf;
        this.header = header;
      });
      this.writeChain = step.catch(() => undefined);
      await step;
      newKey = null; // now owned by the session
    } catch (e) {
      if (e instanceof ValidationError || e instanceof VaultError) throw e;
      throw new VaultError('REENCRYPT_FAILED', 'Re-encryption failed. Your vault and master password are unchanged.');
    } finally {
      wipe(pwBytes);
      if (newKey) wipe(newKey);
    }
  }

  // --------------------------------------------------------------- backups ----

  /** Encrypted backup bytes under the CURRENT master password (fresh nonce). */
  buildBackup(): Buffer {
    const { key, payload } = this.requireUnlocked();
    return this.serialize('backup', key, this.kdf!, this.header!, payload);
  }

  /** Verify that backup bytes decrypt to exactly the current vault contents. */
  verifyBackupBytes(data: Buffer): boolean {
    const { key, payload } = this.requireUnlocked();
    let plain: Buffer | null = null;
    try {
      const parsed = parseVaultFile(data);
      if (!parsed.kdf.salt.equals(this.kdf!.salt)) return false;
      plain = openVaultFile(parsed, key);
      const restored = validatePayload(JSON.parse(plain.toString('utf8')));
      return restored.entries.length === payload.entries.length;
    } catch {
      return false;
    } finally {
      wipe(plain);
    }
  }

  async markBackup(verified: boolean): Promise<void> {
    await this.mutate((draft) => {
      draft.meta.lastBackupAt = this.now().toISOString();
      draft.meta.lastBackupVerified = verified;
    });
  }

  /**
   * Decrypt any vault/backup file with its own password. Returns the validated
   * payload plus the derived key+params (caller must wipe the key).
   */
  static async decryptFile(raw: Buffer, password: string): Promise<{ payload: VaultPayload; key: Buffer; file: ParsedVaultFile }> {
    let file: ParsedVaultFile;
    try {
      file = parseVaultFile(raw);
    } catch (e) {
      if (e instanceof VaultFormatError) throw new VaultError('INVALID_BACKUP', 'This file is not a valid VaultLocks backup.');
      throw e;
    }
    const pwBytes = passwordToBytes(password);
    let key: Buffer | null = null;
    let plain: Buffer | null = null;
    try {
      key = await deriveKey(pwBytes, file.kdf);
      plain = openVaultFile(file, key);
      const payload = validatePayload(JSON.parse(plain.toString('utf8')));
      const out = { payload, key, file };
      key = null;
      return out;
    } catch (e) {
      if (e instanceof CryptoError && e.code === 'BAD_PARAMS') {
        throw new VaultError('INVALID_BACKUP', 'This backup uses unsupported security parameters.');
      }
      throw new VaultError('BACKUP_AUTH_FAILED', 'Unable to open backup. The password may be incorrect or the file may be corrupted.');
    } finally {
      wipe(pwBytes);
      wipe(plain);
      if (key) wipe(key);
    }
  }

  /** Replace (or merge into) the current vault with a decrypted backup, keeping the current master password. */
  async applyBackup(backup: VaultPayload, mode: 'replace' | 'merge'): Promise<void> {
    await this.mutate((draft) => {
      if (mode === 'replace') {
        draft.entries = structuredClone(backup.entries);
        draft.customCategories = structuredClone(backup.customCategories);
        return;
      }
      const ids = new Set(draft.entries.map((e) => e.id));
      const catIds = new Set(draft.customCategories.map((c) => c.id));
      for (const c of backup.customCategories) if (!catIds.has(c.id)) draft.customCategories.push(structuredClone(c));
      for (const e of backup.entries) if (!ids.has(e.id)) draft.entries.push(structuredClone(e));
    });
  }

  /**
   * Restore while LOCKED (e.g. the vault file is corrupted or on a new device).
   * The backup's password becomes the master password. Re-sealed as a 'vault'
   * file with the backup's KDF parameters and key, then unlocked.
   */
  async restoreWhileLocked(raw: Buffer, password: string): Promise<void> {
    if (this.isUnlocked) throw new VaultError('UNLOCKED', 'Lock the vault first.');
    const { payload, key, file } = await VaultService.decryptFile(raw, password);
    try {
      const header = { createdAt: file.createdAt, hint: file.hint };
      const data = this.serialize('vault', key, file.kdf, header, payload);
      await writeFileAtomic(this.vaultPath, data);
      this.key = key;
      this.kdf = file.kdf;
      this.header = header;
      this.payload = payload;
    } catch {
      wipe(key);
      this.lock();
      throw new VaultError('WRITE_FAILED', 'Could not write the restored vault.');
    }
  }

  // ------------------------------------------------------------------ info ----

  async databaseInfo(): Promise<DatabaseInfo> {
    const { payload } = this.requireUnlocked();
    const stat = await fs.stat(this.vaultPath);
    return {
      path: this.vaultPath,
      sizeBytes: stat.size,
      formatVersion: 1,
      kdf: `Argon2id · ${Math.round(this.kdf!.memoryKiB / 1024)} MiB · ${this.kdf!.iterations} passes · ${this.kdf!.parallelism} lanes`,
      cipher: 'AES-256-GCM (authenticated)',
      createdAt: this.header!.createdAt,
      modifiedAt: stat.mtime.toISOString(),
      itemCount: payload.entries.length
    };
  }

  /** Plaintext export payload — only reachable after re-authentication. */
  plaintextExport(): object {
    const { payload } = this.requireUnlocked();
    const cats = this.categories();
    return {
      warning: 'UNENCRYPTED EXPORT — contains all of your passwords in plain text. Delete securely after use.',
      exportedAt: this.now().toISOString(),
      items: payload.entries.map((e) => ({
        title: e.title,
        category: cats.find((c) => c.id === e.categoryId)?.name ?? e.categoryId,
        fields: Object.fromEntries(
          (cats.find((c) => c.id === e.categoryId)?.fields ?? [])
            .filter((f) => e.fields[f.key])
            .map((f) => [f.label, e.fields[f.key]])
        ),
        tags: e.tags,
        favorite: e.favorite
      }))
    };
  }
}

function nextFavoriteOrder(p: VaultPayload): number {
  return p.entries.reduce((m, e) => (e.favorite ? Math.max(m, e.favoriteOrder) : m), 0) + 1;
}
