// Strict validation for (a) data coming from the renderer over IPC and (b) the
// decrypted payload read from disk. Objects are rebuilt field-by-field so that
// unexpected properties (e.g. prototype-pollution keys) are dropped.

import {
  EVENT_CATEGORY_IDS,
  MAX_REMINDERS,
  MAX_REPEAT_COUNT,
  REMINDER_PRESETS,
  SNOOZE_CHOICES,
  isLocalDateTime,
  isTime,
  reminderSignature,
  timeToMin,
  type CalendarEvent,
  type CalendarEventInput,
  type EventCategory,
  type ReminderRule,
  type Repeat
} from '../shared/calendar';
import { BUILTIN_CATEGORIES, BUILTIN_IDS } from '../shared/categories';
import { MAX_TASK_CATEGORIES, TASK_CATEGORY_IDS, type Task, type TaskCategory, type TaskInput, type TaskReminder } from '../shared/tasks';
import { DEFAULT_ACCOUNTS, MAX_ACCOUNTS, MAX_AMOUNT, MONEY_CATEGORY_IDS, defaultCategory, isDayKey, moneyCategory, type AccountKind, type MoneyAccount, type Transaction, type TransactionInput } from '../shared/money';
import {
  ACCENT_COLORS,
  DEFAULT_SETTINGS,
  type AttachmentMeta,
  type AutoLockMinutes,
  type BackgroundLockMinutes,
  type ReminderDays,
  type TrashedEntry,
  type CategoryDef,
  type CategoryIcon,
  type CategoryInput,
  type EntryInput,
  type FieldDef,
  type FieldType,
  type VaultEntry,
  type VaultPayload,
  type VaultSettings
} from '../shared/types';


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
  masterPasswordMin: 8,
  transactions: 200_000,
  events: 20_000,
  tasks: 20_000,
  eventNotes: 4000
} as const;

const FIELD_TYPES: FieldType[] = [
  'text', 'username', 'email', 'phone', 'url', 'date', 'select', 'textarea',
  'password', 'pin', 'secret', 'secretTextarea', 'secretImage'
];
const ICONS: CategoryIcon[] = [
  'bank', 'mail', 'globe', 'wifi', 'key', 'user', 'note', 'card', 'lock',
  'briefcase', 'server', 'shield', 'home', 'phone', 'id', 'folder', 'gamepad', 'wallet', 'health', 'calendar'
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

/** A card photo: JPEG/PNG/WebP data URL, at most ~400 KB of text. */
export const MAX_IMAGE_CHARS = 400_000;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function isLong(type: FieldType): boolean {
  return type === 'textarea' || type === 'secretTextarea';
}

/** Validate & sanitize field values against the category's field definitions. */
export function sanitizeFields(category: CategoryDef, raw: unknown): Record<string, string> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = Object.create(null);
  for (const def of category.fields) {
    if (UNSAFE_KEYS.has(def.key)) continue;
    const max = def.type === 'secretImage' ? MAX_IMAGE_CHARS : isLong(def.type) ? LIMITS.longField : LIMITS.shortField;
    const value = str(src[def.key], def.key, max);
    if (value === '') continue;
    if (def.type === 'secretImage' && !IMAGE_DATA_URL.test(value)) {
      throw new ValidationError(def.key, 'That photo could not be saved.');
    }
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
    closeToTray: typeof s.closeToTray === 'boolean' ? s.closeToTray : base.closeToTray,
    theme: pick(s.theme, ['system', 'light', 'dark'] as const, base.theme),
    accent: pick(s.accent, ACCENT_COLORS, base.accent),
    glass: typeof s.glass === 'boolean' ? s.glass : base.glass,
    // Older vaults only had "lock when minimized": map it to immediately / never.
    backgroundLockMinutes: pick<BackgroundLockMinutes>(
      s.backgroundLockMinutes,
      [0, 1, 5, 15, 30, -1],
      s.backgroundLockMinutes === undefined && typeof s.lockOnMinimize === 'boolean' ? (s.lockOnMinimize ? 0 : -1) : base.backgroundLockMinutes
    ),
    screenshotProtection: typeof s.screenshotProtection === 'boolean' ? s.screenshotProtection : base.screenshotProtection,
    hidePreviews: typeof s.hidePreviews === 'boolean' ? s.hidePreviews : base.hidePreviews,
    reminders: typeof s.reminders === 'boolean' ? s.reminders : base.reminders,
    reminderDaysBefore: [1, 3, 7, 14, 30].includes(s.reminderDaysBefore as number) ? (s.reminderDaysBefore as ReminderDays) : base.reminderDaysBefore,
    currency: typeof s.currency === 'string' && /^[A-Z]{3}$/.test(s.currency) ? s.currency : base.currency,
    quickAddBalances: typeof s.quickAddBalances === 'boolean' ? s.quickAddBalances : base.quickAddBalances,
    monthlyBudget: Number.isInteger(s.monthlyBudget) && (s.monthlyBudget as number) >= 0 && (s.monthlyBudget as number) <= MAX_AMOUNT ? (s.monthlyBudget as number) : base.monthlyBudget,
    calendarReminders: typeof s.calendarReminders === 'boolean' ? s.calendarReminders : base.calendarReminders,
    calendarSound: typeof s.calendarSound === 'boolean' ? s.calendarSound : base.calendarSound,
    calendarDefaultReminders: Array.isArray(s.calendarDefaultReminders)
      ? [...new Set((s.calendarDefaultReminders as unknown[]).filter((m): m is number => REMINDER_PRESETS.some((p) => p.minutes === m)))].slice(0, 5)
      : base.calendarDefaultReminders,
    calendarPreview: typeof s.calendarPreview === 'boolean' ? s.calendarPreview : base.calendarPreview,
    calendarSnooze: SNOOZE_CHOICES.includes(s.calendarSnooze as number) ? (s.calendarSnooze as number) : base.calendarSnooze,
    taskCategories: Array.isArray(s.taskCategories) ? validateTaskCategories(s.taskCategories) : base.taskCategories,
    phoneCalendar: typeof s.phoneCalendar === 'boolean' ? s.phoneCalendar : base.phoneCalendar,
    phoneCalendarNames: typeof s.phoneCalendarNames === 'boolean' ? s.phoneCalendarNames : base.phoneCalendarNames,
    generator: validateGeneratorDefaults(s.generator, base.generator)
  };
}

function validateGeneratorDefaults(v: unknown, base: VaultSettings['generator']): VaultSettings['generator'] {
  const g = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const b = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);
  const length = Number.isInteger(g.length) && (g.length as number) >= 8 && (g.length as number) <= 128 ? (g.length as number) : base.length;
  const out = {
    length,
    upper: b(g.upper, base.upper),
    lower: b(g.lower, base.lower),
    digits: b(g.digits, base.digits),
    symbols: b(g.symbols, base.symbols),
    avoidAmbiguous: b(g.avoidAmbiguous, base.avoidAmbiguous)
  };
  if (!out.upper && !out.lower && !out.digits && !out.symbols) out.lower = true;
  return out;
}

export function isoOr(v: unknown, fallback: string): string {
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
  const hasCustomWifi = customCategories.some((c) => c.id === 'wifi');
  const entries: VaultEntry[] = [];
  const ids = new Set<string>();
  const toEntry = (raw: any): VaultEntry => {
    const e = hasCustomWifi ? raw : migrateWifiEntry(raw);
    const legacyImages = extractLegacyImages(e, categories);
    const input = validateEntryInput(e, categories);
    const id = input.id && !ids.has(input.id) ? input.id : randomUUID();
    ids.add(id);
    const entry: VaultEntry = {
      id,
      categoryId: input.categoryId,
      title: input.title,
      fields: input.fields,
      tags: input.tags,
      favorite: input.favorite,
      favoriteOrder: Number.isFinite(e.favoriteOrder) ? Number(e.favoriteOrder) : 0,
      createdAt: isoOr(e.createdAt, now),
      updatedAt: isoOr(e.updatedAt, now)
    };
    const attachments = validateAttachments(e.attachments);
    if (attachments.length) entry.attachments = attachments;
    if (legacyImages) entry.legacyImages = legacyImages;
    return entry;
  };
  for (const raw of p.entries) entries.push(toEntry(raw));

  // "Recently Deleted": a damaged trashed item is skipped rather than making the
  // whole vault unreadable.
  const trash: TrashedEntry[] = [];
  for (const raw of Array.isArray(p.trash) ? p.trash.slice(0, LIMITS.entries) : []) {
    try {
      trash.push({ ...toEntry(raw), deletedAt: isoOr(raw?.deletedAt, now) });
    } catch {
      /* skip */
    }
  }

  // Money accounts: vaults from before accounts existed get the defaults.
  const accounts: MoneyAccount[] = [];
  if (!Array.isArray(p.accounts)) accounts.push(...DEFAULT_ACCOUNTS.map((a) => ({ ...a })));
  else
    for (const raw of p.accounts.slice(0, MAX_ACCOUNTS)) {
      try {
        const a = validateAccountInput(raw);
        if (a.id && !accounts.some((x) => x.id === a.id)) accounts.push(a as MoneyAccount);
      } catch {
        /* skip */
      }
    }

  // Expenses: a damaged record is skipped, never fatal (older vaults have none).
  const transactions: Transaction[] = [];
  const txIds = new Set<string>();
  for (const raw of Array.isArray(p.transactions) ? p.transactions.slice(0, LIMITS.transactions) : []) {
    try {
      const t = validateTransactionInput(raw);
      const id = t.id && !txIds.has(t.id) ? t.id : randomUUID();
      txIds.add(id);
      transactions.push({ ...t, id, createdAt: isoOr(raw.createdAt, now), updatedAt: isoOr(raw.updatedAt, now) });
    } catch {
      /* skip */
    }
  }

  // Calendar: a damaged event is skipped, never fatal (older vaults have none).
  const events: CalendarEvent[] = [];
  const evIds = new Set<string>();
  for (const raw of Array.isArray(p.events) ? p.events.slice(0, LIMITS.events) : []) {
    try {
      const e = validateEventInput(raw);
      const id = e.id && !evIds.has(e.id) ? e.id : randomUUID();
      evIds.add(id);
      events.push({ ...e, id, createdAt: isoOr(raw.createdAt, now), updatedAt: isoOr(raw.updatedAt, now) });
    } catch {
      /* skip */
    }
  }

  // Tasks: same rule — a damaged task is skipped.
  const tasks: Task[] = [];
  const taskIds = new Set<string>();
  for (const raw of Array.isArray(p.tasks) ? p.tasks.slice(0, LIMITS.tasks) : []) {
    try {
      const t = validateTaskInput(raw);
      const id = t.id && !taskIds.has(t.id) ? t.id : randomUUID();
      taskIds.add(id);
      tasks.push({ ...t, id, createdAt: isoOr(raw.createdAt, now), updatedAt: isoOr(raw.updatedAt, now) });
    } catch {
      /* skip */
    }
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
      lastBackupVerified: m.lastBackupVerified === true,
      dismissedDuplicates: Array.isArray(m.dismissedDuplicates)
        ? m.dismissedDuplicates.filter((x: unknown) => typeof x === 'string' && x.length <= 300).slice(0, 2000)
        : []
    },
    trash,
    transactions,
    accounts,
    events,
    tasks,
    ...(validInboxKey(p.inboxKey) ? { inboxKey: { priv: { ...p.inboxKey.priv }, pub: p.inboxKey.pub } } : {})
  };
}

function validInboxKey(k: any): k is { priv: JsonWebKey; pub: string } {
  const s = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200;
  return (
    !!k &&
    typeof k === 'object' &&
    s(k.pub) &&
    !!k.priv &&
    typeof k.priv === 'object' &&
    k.priv.kty === 'EC' &&
    k.priv.crv === 'P-256' &&
    s(k.priv.d) &&
    s(k.priv.x) &&
    s(k.priv.y)
  );
}

/** One expense / income record from the renderer or the decrypted payload. */
export function validateTransactionInput(input: unknown): TransactionInput {
  if (!input || typeof input !== 'object') throw new ValidationError('form', 'Invalid record.');
  const i = input as Record<string, unknown>;
  const id = i.id === undefined || i.id === null ? undefined : str(i.id, 'id', 64);
  if (id !== undefined && !ID_RE.test(id)) throw new ValidationError('id', 'Invalid record.');
  const kind = i.kind === 'income' ? 'income' : i.kind === 'expense' ? 'expense' : null;
  if (!kind) throw new ValidationError('kind', 'Choose expense or income.');
  if (!Number.isInteger(i.amount) || (i.amount as number) <= 0 || (i.amount as number) > MAX_AMOUNT) throw new ValidationError('amount', 'Enter an amount greater than zero.');
  const category = typeof i.category === 'string' && MONEY_CATEGORY_IDS.has(i.category) && moneyCategory(i.category).kind === kind ? i.category : defaultCategory(kind);
  if (!isDayKey(i.date)) throw new ValidationError('date', 'Choose a valid date.');
  const accountId = typeof i.accountId === 'string' && ID_RE.test(i.accountId) ? i.accountId : undefined;
  return { id, kind, amount: i.amount as number, category, note: str(i.note, 'note', LIMITS.title).trim(), date: i.date, ...(accountId ? { accountId } : {}) };
}

/** One calendar event from the renderer or the decrypted payload. `id` is optional for a new one. */
export function validateEventInput(input: unknown): CalendarEventInput {
  if (!input || typeof input !== 'object') throw new ValidationError('form', 'Invalid event.');
  const i = input as Record<string, unknown>;
  const id = i.id === undefined || i.id === null ? undefined : str(i.id, 'id', 64);
  if (id !== undefined && !ID_RE.test(id)) throw new ValidationError('id', 'Invalid event.');
  const title = str(i.title, 'title', LIMITS.title, true).trim();
  const notes = str(i.notes, 'notes', LIMITS.eventNotes);
  const location = str(i.location, 'location', LIMITS.title).trim();
  const category = (typeof i.category === 'string' && EVENT_CATEGORY_IDS.has(i.category) ? i.category : 'other') as EventCategory;
  const allDay = i.allDay === true;
  if (!isDayKey(i.start)) throw new ValidationError('start', 'Choose a start date.');
  if (!isDayKey(i.end)) throw new ValidationError('end', 'Choose an end date.');
  if (i.end < i.start) throw new ValidationError('end', 'The end date can\'t be before the start.');
  let startTime = '';
  let endTime = '';
  if (!allDay) {
    if (!isTime(i.startTime)) throw new ValidationError('startTime', 'Choose a start time.');
    if (!isTime(i.endTime)) throw new ValidationError('endTime', 'Choose an end time.');
    startTime = i.startTime;
    endTime = i.endTime;
    if (i.end === i.start && timeToMin(endTime) < timeToMin(startTime)) throw new ValidationError('endTime', 'The event must end after it starts.');
  }

  const reminders: ReminderRule[] = [];
  const seen = new Set<string>();
  const ruleIds = new Set<string>();
  for (const raw of Array.isArray(i.reminders) ? i.reminders.slice(0, MAX_REMINDERS * 2) : []) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const rid = typeof r.id === 'string' && ID_RE.test(r.id) && !ruleIds.has(r.id) ? r.id : `r${randomUUID().slice(0, 8)}`;
    const enabled = r.enabled !== false;
    let rule: ReminderRule | null = null;
    if (r.type === 'before' && Number.isInteger(r.minutes) && (r.minutes as number) >= 0 && (r.minutes as number) <= 60 * 24 * 60) rule = { id: rid, type: 'before', minutes: r.minutes as number, enabled };
    else if (r.type === 'dayAt' && Number.isInteger(r.days) && (r.days as number) >= 0 && (r.days as number) <= 60 && isTime(r.time)) rule = { id: rid, type: 'dayAt', days: r.days as number, time: r.time, enabled };
    else if (r.type === 'at' && isLocalDateTime(r.at)) rule = { id: rid, type: 'at', at: r.at, enabled };
    if (!rule || seen.has(reminderSignature(rule))) continue; // no duplicates
    seen.add(reminderSignature(rule));
    ruleIds.add(rid);
    reminders.push(rule);
    if (reminders.length >= MAX_REMINDERS) break;
  }

  let repeat: Repeat | null = null;
  if (i.repeat && typeof i.repeat === 'object') {
    const r = i.repeat as Record<string, unknown>;
    if (r.freq === 'daily' || r.freq === 'weekly' || r.freq === 'monthly' || r.freq === 'yearly') {
      repeat = { freq: r.freq, interval: Number.isInteger(r.interval) && (r.interval as number) >= 1 && (r.interval as number) <= 99 ? (r.interval as number) : 1 };
      if (r.freq === 'weekly' && Array.isArray(r.weekdays)) {
        const days = [...new Set(r.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
        if (days.length) repeat.weekdays = days;
      }
      if (isDayKey(r.until)) {
        if (r.until < i.start) throw new ValidationError('until', 'The repeat must end after the event starts.');
        repeat.until = r.until;
      } else if (Number.isInteger(r.count) && (r.count as number) >= 1 && (r.count as number) <= MAX_REPEAT_COUNT) repeat.count = r.count as number;
    }
  }

  const days = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter(isDayKey))].sort().slice(-max) : []);
  const keyOk = (k: unknown): k is string => typeof k === 'string' && k.length <= 160 && /^[A-Za-z0-9_-]{1,64}\|\d{4}-\d{2}-\d{2}(\|[A-Za-z0-9_-]{1,64})?$/.test(k);
  const acks = Array.isArray(i.acks) ? [...new Set(i.acks.filter(keyOk))].slice(-2000) : [];
  const snoozes = Array.isArray(i.snoozes)
    ? i.snoozes
        .filter((s): s is { key: string; until: number } => !!s && typeof s === 'object' && keyOk((s as any).key) && Number.isFinite((s as any).until) && (s as any).until > 0)
        .map((s) => ({ key: s.key, until: Math.round(s.until) }))
        .slice(-50)
    : [];
  return {
    id,
    title,
    notes,
    location,
    category,
    allDay,
    start: i.start,
    startTime,
    end: i.end,
    endTime,
    reminders,
    repeat,
    exdates: days(i.exdates, 1000),
    done: days(i.done, 1000),
    acks,
    snoozes
  };
}

/** The user's own task categories: unique ids that don't clash with the built-in ones. */
export function validateTaskCategories(v: unknown[]): TaskCategory[] {
  const out: TaskCategory[] = [];
  for (const c of v.slice(0, MAX_TASK_CATEGORIES * 2)) {
    if (!c || typeof c !== 'object') continue;
    const { id, name } = c as Record<string, unknown>;
    if (typeof id !== 'string' || !ID_RE.test(id) || TASK_CATEGORY_IDS.has(id) || out.some((x) => x.id === id)) continue;
    if (typeof name !== 'string' || !name.trim() || name.length > 30) continue;
    out.push({ id, name: name.trim() });
    if (out.length >= MAX_TASK_CATEGORIES) break;
  }
  return out;
}

/** One task from the renderer or the decrypted payload. `id` is optional for a new one. */
export function validateTaskInput(input: unknown): TaskInput {
  if (!input || typeof input !== 'object') throw new ValidationError('form', 'Invalid task.');
  const i = input as Record<string, unknown>;
  const id = i.id === undefined || i.id === null ? undefined : str(i.id, 'id', 64);
  if (id !== undefined && !ID_RE.test(id)) throw new ValidationError('id', 'Invalid task.');
  const title = str(i.title, 'title', LIMITS.title, true).trim();
  const description = str(i.description, 'description', LIMITS.eventNotes);
  const notes = str(i.notes, 'notes', LIMITS.eventNotes);
  const due = i.due === '' || i.due === undefined || i.due === null ? '' : i.due;
  if (due !== '' && !isDayKey(due)) throw new ValidationError('due', 'Choose a valid due date.');
  const dueTime = due && isTime(i.dueTime) ? i.dueTime : '';
  if (due === '' && isTime(i.dueTime)) throw new ValidationError('due', 'Choose a due date for the time.');
  const priority = i.priority === 'low' || i.priority === 'high' ? i.priority : 'medium';
  const category = typeof i.category === 'string' && ID_RE.test(i.category) ? i.category : 'other';
  let reminder: TaskReminder | null = null;
  const r = i.reminder as Record<string, unknown> | null | undefined;
  if (r && typeof r === 'object') {
    if (r.type === 'before' && Number.isInteger(r.minutes) && (r.minutes as number) >= 0 && (r.minutes as number) <= 60 * 24 * 60) {
      if (!due) throw new ValidationError('reminder', 'Set a due date for this reminder, or pick a custom date and time.');
      reminder = { type: 'before', minutes: r.minutes as number };
    } else if (r.type === 'at' && isLocalDateTime(r.at)) reminder = { type: 'at', at: r.at };
  }
  const repeat = i.repeat === 'daily' || i.repeat === 'weekly' || i.repeat === 'monthly' || i.repeat === 'yearly' ? i.repeat : null;
  if (repeat && !due) throw new ValidationError('repeat', 'A repeating task needs a due date.');
  const completed = i.completed === true;
  const history = Array.isArray(i.history)
    ? i.history
        .filter((h): h is { due: string; at: string } => !!h && typeof h === 'object' && isDayKey((h as any).due) && typeof (h as any).at === 'string')
        .map((h) => ({ due: h.due, at: isoOr(h.at, new Date().toISOString()) }))
        .slice(-100)
    : [];
  const acks = Array.isArray(i.acks) ? [...new Set(i.acks.filter((k): k is string => typeof k === 'string' && k.length <= 120))].slice(-200) : [];
  return {
    id,
    title,
    description,
    notes,
    due,
    dueTime,
    priority,
    category,
    reminder,
    repeat,
    completed,
    completedAt: completed ? isoOr(i.completedAt, new Date().toISOString()) : null,
    history,
    acks
  };
}

const ACCOUNT_KINDS: AccountKind[] = ['cash', 'ewallet', 'bank', 'credit', 'other'];

/** A money account (Cash, GCash…). `id` is optional for a new one. */
export function validateAccountInput(input: unknown): Omit<MoneyAccount, 'id'> & { id?: string } {
  if (!input || typeof input !== 'object') throw new ValidationError('form', 'Invalid account.');
  const i = input as Record<string, unknown>;
  const id = i.id === undefined || i.id === null ? undefined : str(i.id, 'id', 64);
  if (id !== undefined && !ID_RE.test(id)) throw new ValidationError('id', 'Invalid account.');
  const name = str(i.name, 'name', 40, true).trim();
  const opening = i.opening === undefined ? 0 : i.opening;
  if (!Number.isInteger(opening) || Math.abs(opening as number) > MAX_AMOUNT) throw new ValidationError('opening', 'Enter a valid starting balance.');
  return { id, name, kind: ACCOUNT_KINDS.includes(i.kind as AccountKind) ? (i.kind as AccountKind) : 'other', opening: opening as number };
}

const ATT_ID = /^[A-Za-z0-9-]{8,64}$/;
const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const THUMB = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ITEM = 50;

/** Validate attachment metadata; anything malformed is dropped. */
export function validateAttachments(v: unknown): AttachmentMeta[] {
  if (!Array.isArray(v)) return [];
  const out: AttachmentMeta[] = [];
  const seen = new Set<string>();
  for (const a of v.slice(0, MAX_ATTACHMENTS_PER_ITEM)) {
    if (!a || typeof a !== 'object') continue;
    const x = a as Record<string, unknown>;
    if (typeof x.id !== 'string' || !ATT_ID.test(x.id) || seen.has(x.id)) continue;
    if (typeof x.sha256 !== 'string' || !SHA256.test(x.sha256)) continue;
    if (!Number.isInteger(x.size) || (x.size as number) < 0 || (x.size as number) > MAX_ATTACHMENT_BYTES) continue;
    seen.add(x.id);
    const meta: AttachmentMeta = {
      id: x.id,
      name: cleanFileName(x.name),
      mime: typeof x.mime === 'string' && MIME.test(x.mime) && x.mime.length <= 100 ? x.mime.toLowerCase() : 'application/octet-stream',
      size: x.size as number,
      sha256: x.sha256,
      createdAt: isoOr(x.createdAt, new Date().toISOString())
    };
    if (x.role === 'front' || x.role === 'back') meta.role = x.role;
    if (typeof x.thumb === 'string' && x.thumb.length <= 80_000 && THUMB.test(x.thumb)) meta.thumb = x.thumb;
    out.push(meta);
  }
  return out;
}

/** File names are shown to the user only; strip paths and control characters. */
export function cleanFileName(v: unknown): string {
  const n = typeof v === 'string' ? v : '';
  const base = n.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return clean || 'Attachment';
}

/**
 * Card photos used to be stored in "front/back photo" fields. Those fields were
 * replaced by attachments: keep any existing photo aside (so it is NOT dropped by
 * field validation) and let the vault turn it into an attachment after unlock.
 */
function extractLegacyImages(e: any, categories: CategoryDef[]): VaultEntry['legacyImages'] | undefined {
  const f = e?.fields && typeof e.fields === 'object' ? e.fields : {};
  const cat = categories.find((c) => c.id === e.categoryId);
  const stillField = (k: string) => cat?.fields.some((d) => d.key === k);
  const pick = (k: string) =>
    !stillField(k) && typeof f[k] === 'string' && f[k].length <= MAX_IMAGE_CHARS && IMAGE_DATA_URL.test(f[k]) ? (f[k] as string) : undefined;
  // Also accept photos already set aside by an earlier, not-yet-finished migration.
  const prior = e?.legacyImages && typeof e.legacyImages === 'object' ? e.legacyImages : {};
  const ok = (x: unknown) => typeof x === 'string' && x.length <= MAX_IMAGE_CHARS && IMAGE_DATA_URL.test(x);
  const front = pick('frontImage') ?? (ok(prior.front) ? (prior.front as string) : undefined);
  const back = pick('backImage') ?? (ok(prior.back) ? (prior.back as string) : undefined);
  if (!front && !back) return undefined;
  return { ...(front ? { front } : {}), ...(back ? { back } : {}) };
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

/**
 * The built-in "Wi-Fi" category was replaced by "Others". Old Wi-Fi items are
 * converted on load without losing data: network name → Name, password kept,
 * security type appended to Notes.
 */
export function migrateWifiEntry(e: any): any {
  if (!e || typeof e !== 'object' || e.categoryId !== 'wifi') return e;
  const f = e.fields && typeof e.fields === 'object' ? e.fields : {};
  const notes = [typeof f.notes === 'string' ? f.notes : '', typeof f.securityType === 'string' && f.securityType ? `Wi-Fi security: ${f.securityType}` : '']
    .filter(Boolean)
    .join('\n');
  const fields: Record<string, unknown> = { password: f.password, notes };
  if (typeof f.networkName === 'string') fields.name = f.networkName;
  const tags = Array.isArray(e.tags) ? e.tags : [];
  return { ...e, categoryId: 'others', fields, tags: tags.includes('wifi') ? tags : [...tags, 'wifi'] };
}
