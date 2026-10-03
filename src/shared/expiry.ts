// Upcoming expiry / renewal / due dates: the dashboard reminder and phone notifications.

import type { CategoryDef, EntryView } from './types';

export type DateKind = 'expires' | 'renews' | 'due';

export interface Upcoming {
  entry: EntryView;
  kind: DateKind;
  /** Field label, e.g. "Valid until". */
  label: string;
  /** Whole days from today; negative = already passed. */
  days: number;
  date: Date;
}

/** Built-in date fields that matter (birthdays, issue dates etc. are ignored). */
const BUILTIN: Record<string, { key: string; kind: DateKind }[]> = {
  ids: [{ key: 'expiryDate', kind: 'expires' }],
  insurance: [{ key: 'expiryDate', kind: 'expires' }],
  subscriptions: [{ key: 'renewalDate', kind: 'renews' }],
  software: [{ key: 'expirationDate', kind: 'expires' }],
  cards: [{ key: 'expiry', kind: 'expires' }],
  documents: [{ key: 'expiryDate', kind: 'expires' }]
};

/** Custom categories: any date field whose name says expiry, renewal or payment. */
function kindFromLabel(label: string): DateKind | null {
  const l = label.toLowerCase();
  if (/issue|birth|born|start|created|purchase|since/.test(l)) return null;
  if (/renew|subscription|billing/.test(l)) return 'renews';
  if (/due|pay|bill|deadline/.test(l)) return 'due';
  if (/expir|valid|until|end/.test(l)) return 'expires';
  return null;
}

function dateFields(categoryId: string, categories?: CategoryDef[]): { key: string; kind: DateKind; label: string }[] {
  const cat = categories?.find((c) => c.id === categoryId);
  const label = (key: string) => cat?.fields.find((f) => f.key === key)?.label ?? 'Date';
  const builtin = BUILTIN[categoryId];
  if (builtin) return builtin.map((b) => ({ ...b, label: label(b.key) }));
  if (!cat || cat.builtin) return [];
  const out: { key: string; kind: DateKind; label: string }[] = [];
  for (const f of cat.fields) {
    if (f.type !== 'date') continue;
    const kind = kindFromLabel(f.label);
    if (kind) out.push({ key: f.key, kind, label: f.label });
  }
  return out;
}

/** Parse YYYY-MM-DD, or MM/YY (card expiry → last day of that month). */
export function parseDateField(value: string | undefined): Date | null {
  if (!value) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})\s*\/\s*(\d{2})$/.exec(value.trim());
  if (m) return new Date(2000 + Number(m[2]), Number(m[1]), 0); // day 0 of next month = last day
  return null;
}

const CYCLE_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, Yearly: 12 };

/** Repeating subscriptions: a passed renewal date rolls forward to the next one. */
export function nextRenewal(date: Date, cycle: string | undefined, today: Date): Date {
  let d = new Date(date);
  if (cycle === 'Weekly') {
    while (d < today) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
    return d;
  }
  const months = cycle ? CYCLE_MONTHS[cycle] : undefined;
  if (!months) return d;
  const day = date.getDate();
  for (let i = 1; d < today && i < 1200; i++) {
    const y = date.getFullYear();
    const m = date.getMonth() + months * i;
    const last = new Date(y, m + 1, 0).getDate();
    d = new Date(y, m, Math.min(day, last));
  }
  return d;
}

/** All tracked dates of the given items (not filtered by time). */
export function trackedDates(entries: EntryView[], categories?: CategoryDef[], now = new Date()): Upcoming[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: Upcoming[] = [];
  for (const e of entries) {
    for (const f of dateFields(e.categoryId, categories)) {
      let date = parseDateField(e.fields[f.key]);
      if (!date) continue;
      if (f.kind === 'renews') date = nextRenewal(date, e.fields.billingCycle, today);
      const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
      out.push({ entry: e, kind: f.kind, label: f.label, days, date });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

/** Items expiring/renewing within `withinDays` (and anything already expired in the last 60 days). */
export function upcomingDates(entries: EntryView[], now = new Date(), withinDays = 30, categories?: CategoryDef[]): Upcoming[] {
  return trackedDates(entries, categories, now).filter((u) => u.days <= withinDays && u.days >= -60);
}

export function describeUpcoming(u: Pick<Upcoming, 'kind' | 'days'>): string {
  const verb = u.kind === 'renews' ? 'Renews' : u.kind === 'due' ? 'Due' : 'Expires';
  if (u.days < 0) {
    if (u.kind === 'renews') return `Renewal was ${-u.days} day${u.days === -1 ? '' : 's'} ago`;
    if (u.kind === 'due') return `Was due ${-u.days} day${u.days === -1 ? '' : 's'} ago`;
    return `Expired ${-u.days} day${u.days === -1 ? '' : 's'} ago`;
  }
  if (u.days === 0) return `${verb} today`;
  if (u.days === 1) return `${verb} tomorrow`;
  return `${verb} in ${u.days} days`;
}

// ------------------------------------------------------------ notifications --

export interface Reminder {
  /** Stable positive 31-bit id (Android notification id). */
  id: number;
  at: Date;
  title: string;
  body: string;
  entryId: string;
}

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 1) || 1;
}

/**
 * Phone reminders: `daysBefore` days ahead (at `hour`:00) and on the day itself.
 * Only non-secret information is used (title, category, date).
 */
export function buildReminders(
  entries: EntryView[],
  categories: CategoryDef[],
  opts: { daysBefore: number; hour?: number; max?: number },
  now = new Date()
): Reminder[] {
  const hour = opts.hour ?? 9;
  const horizon = new Date(now.getTime() + 400 * 86_400_000);
  const out: Reminder[] = [];
  for (const u of trackedDates(entries, categories, now)) {
    const cat = categories.find((c) => c.id === u.entry.categoryId)?.name ?? 'Item';
    const dateText = u.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const extra = u.kind === 'renews' && u.entry.fields.price ? ` · ${u.entry.fields.price}` : '';
    for (const before of [...new Set([opts.daysBefore, 0])]) {
      const at = new Date(u.date.getFullYear(), u.date.getMonth(), u.date.getDate() - before, hour, 0, 0);
      if (at <= now || at > horizon) continue;
      out.push({
        id: hashId(`${u.entry.id}|${u.label}|${u.date.toDateString()}|${before}`),
        at,
        title: `${u.entry.title}: ${describeUpcoming({ kind: u.kind, days: before }).toLowerCase()}`,
        body: `${cat} · ${u.label} ${dateText}${extra}`,
        entryId: u.entry.id
      });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, opts.max ?? 60);
}
