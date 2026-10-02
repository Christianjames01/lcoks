// Strict validation for (a) data coming from the renderer over IPC and (b) the
// decrypted payload read from disk. Objects are rebuilt field-by-field so that
// unexpected properties (e.g. prototype-pollution keys) are dropped.

import { BUILTIN_CATEGORIES, BUILTIN_IDS } from '../../shared/categories';
import {
  DEFAULT_SETTINGS,
  type AutoLockMinutes,
  type CategoryDef,
  type CategoryIcon,
  type CategoryInput,
  type EntryInput,
  type FieldDef,
  type FieldType,
  type VaultEntry,
  type VaultPayload,
  type VaultSettings
} from '../../shared/types';


// Isomorphic: Web Crypto randomUUID works in Node 19+, Electron and Android WebView.
const randomUUID = () => globalThis.crypto.randomUUID();

export class ValidationError extends Error {
  constructor(readonly field: string, readonly userMessage: string) {
    super('VALIDATION');
    this.name = 'ValidationError';
  }
}

export const LIMITS = {
  title: 200,
  shortField: 10_000,
  longField: 200_000,
  tags: 30,
  tagLength: 40,
  entries: 50_000,
  categoryName: 40,
  categoryFields: 30,
  fieldLabel: 60,
  customCategories: 100,
  masterPasswordMax: 1024,
  masterPasswordMin: 8
} as const;

const FIELD_TYPES: FieldType[] = [
  'text', 'username', 'email', 'phone', 'url', 'date', 'select', 'textarea',
  'password', 'pin', 'secret', 'secretTextarea'
];
const ICONS: CategoryIcon[] = [
  'bank', 'mail', 'globe', 'wifi', 'key', 'user', 'note', 'card', 'lock',
  'briefcase', 'server', 'shield', 'home', 'phone', 'id', 'folder'
];
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

function str(v: unknown, field: string, max: number, required = false): string {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new ValidationError(field, 'Invalid value.');
  if (v.length > max) throw new ValidationError(field, `Must be at most ${max.toLocaleString()} characters.`);
  if (required && v.trim().length === 0) throw new ValidationError(field, 'This field is required.');
  // Strip NUL characters which can confuse downstream consumers.
  return v.replace(/\u0000/g, '');
}

export function normalizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v.slice(0, LIMITS.tags * 2)) {
    if (typeof t !== 'string') continue;
    const tag = t.trim().toLowerCase().replace(/[\s,]+/g, '-').slice(0, LIMITS.tagLength);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  if (out.length > LIMITS.tags) throw new ValidationError('tags', `At most ${LIMITS.tags} tags.`);
  return out;
}

function isLong(type: FieldType): boolean {
  return type === 'textarea' || type === 'secretTextarea';
}

/** Validate & sanitize field values against the category's field definitions. */
export function sanitizeFields(category: CategoryDef, raw: unknown): Record<string, string> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = Object.create(null);
  for (const def of category.fields) {
    if (UNSAFE_KEYS.has(def.key)) continue;
    const value = str(src[def.key], def.key, isLong(def.type) ? LIMITS.longField : LIMITS.shortField);
    if (value === '') continue;
    if (def.type === 'url' && /^\s*(javascript|data|vbscript|file):/i.test(value)) {
      throw new ValidationError(def.key, 'This URL scheme is not allowed.');
    }
    out[def.key] = value;
  }
  return { ...out };
}

export function validateEntryInput(input: unknown, categories: CategoryDef[]): EntryInput & { category: CategoryDef } {
  if (!input || typeof input !== 'object') throw new ValidationError('form', 'Invalid item.');
  const i = input as Record<string, unknown>;
  const categoryId = str(i.categoryId, 'categoryId', 64, true);
  const category = categories.find((c) => c.id === categoryId);
  if (!category) throw new ValidationError('categoryId', 'Choose a category.');
  const id = i.id === undefined || i.id === null ? undefined : str(i.id, 'id', 64);
  if (id !== undefined && !ID_RE.test(id)) throw new ValidationError('id', 'Invalid item.');
  return {
    id,
    categoryId,
    category,
    title: str(i.title, 'title', LIMITS.title, true).trim(),
    fields: sanitizeFields(category, i.fields),
    tags: normalizeTags(i.tags),
    favorite: i.favorite === true
  };
}

function validateFieldDefs(v: unknown): FieldDef[] {
  if (!Array.isArray(v) || v.length === 0) throw new ValidationError('fields', 'Add at least one field.');
  if (v.length > LIMITS.categoryFields) throw new ValidationError('fields', `At most ${LIMITS.categoryFields} fields.`);
  const seen = new Set<string>();
  return v.map((f: any, idx: number) => {
    const label = str(f?.label, `fields.${idx}`, LIMITS.fieldLabel, true).trim();
    const type = FIELD_TYPES.includes(f?.type) ? (f.type as FieldType) : 'text';
    let key = typeof f?.key === 'string' && KEY_RE.test(f.key) ? f.key : '';
    if (!key) key = 'f_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    if (!KEY_RE.test(key) || UNSAFE_KEYS.has(key)) key = `f_${idx}`;
    while (seen.has(key)) key = `${key}_${idx}`.slice(0, 40);
    seen.add(key);
    const def: FieldDef = { key, label, type };
    if (type === 'select' && Array.isArray(f?.options)) {
      def.options = f.options.filter((o: unknown) => typeof o === 'string').slice(0, 50).map((o: string) => o.slice(0, 60));
    }
    if (f?.partialMask === true && type === 'secret') def.partialMask = true;
    return def;
  });
}

export function validateCategoryInput(input: unknown): CategoryInput {
  if (!input || typeof input !== 'object') throw new ValidationError('form', 'Invalid category.');
  const i = input as Record<string, unknown>;
  const id = i.id === undefined || i.id === null ? undefined : str(i.id, 'id', 64);
  if (id !== undefined && (!ID_RE.test(id) || BUILTIN_IDS.has(id))) {
    throw new ValidationError('id', 'Built-in categories cannot be modified.');
  }
  return {
    id,
    name: str(i.name, 'name', LIMITS.categoryName, true).trim(),
    icon: ICONS.includes(i.icon as CategoryIcon) ? (i.icon as CategoryIcon) : 'folder',
    fields: validateFieldDefs(i.fields)
  };
}

export function validateSettings(v: unknown, base: VaultSettings = DEFAULT_SETTINGS): VaultSettings {
  const s = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? (value as number) : fallback;
  return {
    autoLockMinutes: pick<AutoLockMinutes>(s.autoLockMinutes, [1, 5, 10, 15, 30, 0], base.autoLockMinutes),
    lockOnMinimize: typeof s.lockOnMinimize === 'boolean' ? s.lockOnMinimize : base.lockOnMinimize,
    lockOnSystemLock: typeof s.lockOnSystemLock === 'boolean' ? s.lockOnSystemLock : base.lockOnSystemLock,
    clipboardClearSeconds: clampInt(s.clipboardClearSeconds, 10, 120, base.clipboardClearSeconds),
    revealTimeoutSeconds: clampInt(s.revealTimeoutSeconds, 0, 600, base.revealTimeoutSeconds),
    density: pick(s.density, ['comfortable', 'compact'] as const, base.density),
    sidebar: pick(s.sidebar, ['auto', 'expanded', 'collapsed'] as const, base.sidebar),
    favoriteSort: pick(s.favoriteSort, ['manual', 'name', 'updated'] as const, base.favoriteSort),
    backupReminderDays: pick(s.backupReminderDays, [0, 7, 14, 30, 90], base.backupReminderDays),
    backupDirectory:
      s.backupDirectory === null
        ? null
        : typeof s.backupDirectory === 'string' && s.backupDirectory.length <= 1024
          ? s.backupDirectory
          : base.backupDirectory,
    closeToTray: typeof s.closeToTray === 'boolean' ? s.closeToTray : base.closeToTray
  };
}

function isoOr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length <= 64 && !Number.isNaN(Date.parse(v)) ? v : fallback;
}

/**
 * Validate a decrypted payload. Called only AFTER successful authenticated
 * decryption, so this guards against bugs/old versions rather than attackers —
 * but it is still strict and rebuilds every object.
 */
export function validatePayload(v: unknown): VaultPayload {
  if (!v || typeof v !== 'object') throw new ValidationError('payload', 'Invalid vault data.');
  const p = v as Record<string, any>;
  if (p.schema !== 1 || !Array.isArray(p.entries)) throw new ValidationError('payload', 'Invalid vault data.');
  const now = new Date().toISOString();

  const customCategories: CategoryDef[] = [];
  for (const c of Array.isArray(p.customCategories) ? p.customCategories.slice(0, LIMITS.customCategories) : []) {
    const ci = validateCategoryInput({ ...c, id: c?.id });
    if (!ci.id) continue;
    customCategories.push({ id: ci.id, name: ci.name, icon: ci.icon, fields: ci.fields, builtin: false });
  }
  const categories = [...BUILTIN_CATEGORIES, ...customCategories];

  if (p.entries.length > LIMITS.entries) throw new ValidationError('payload', 'Too many items.');
  const entries: VaultEntry[] = [];
  const ids = new Set<string>();
  for (const e of p.entries) {
    const input = validateEntryInput(e, categories);
    let id = input.id && !ids.has(input.id) ? input.id : randomUUID();
    ids.add(id);
    entries.push({
      id,
      categoryId: input.categoryId,
      title: input.title,
      fields: input.fields,
      tags: input.tags,
      favorite: input.favorite,
      favoriteOrder: Number.isFinite(e.favoriteOrder) ? Number(e.favoriteOrder) : 0,
      createdAt: isoOr(e.createdAt, now),
      updatedAt: isoOr(e.updatedAt, now)
    });
  }

  const m = p.meta && typeof p.meta === 'object' ? p.meta : {};
  return {
    schema: 1,
    entries,
    customCategories,
    settings: validateSettings(p.settings),
    meta: {
      createdAt: isoOr(m.createdAt, now),
      lastBackupAt: m.lastBackupAt ? isoOr(m.lastBackupAt, now) : null,
      lastBackupVerified: m.lastBackupVerified === true
    }
  };
}

export function validateMasterPassword(pw: unknown, field = 'password'): string {
  if (typeof pw !== 'string') throw new ValidationError(field, 'Invalid password.');
  if (pw.length > LIMITS.masterPasswordMax) throw new ValidationError(field, 'Password is too long.');
  return pw;
}

export function validateNewMasterPassword(pw: unknown, field = 'password'): string {
  const v = validateMasterPassword(pw, field);
  if ([...v].length < LIMITS.masterPasswordMin) {
    throw new ValidationError(field, `Use at least ${LIMITS.masterPasswordMin} characters.`);
  }
  return v;
}
