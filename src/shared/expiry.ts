// Upcoming expiry / renewal dates for the dashboard reminder.

import type { EntryView } from './types';

export interface Upcoming {
  entry: EntryView;
  kind: 'expires' | 'renews';
  /** Whole days from today; negative = already passed. */
  days: number;
  date: Date;
}

const FIELDS: Record<string, { key: string; kind: Upcoming['kind'] }> = {
  ids: { key: 'expiryDate', kind: 'expires' },
  insurance: { key: 'expiryDate', kind: 'expires' },
  subscriptions: { key: 'renewalDate', kind: 'renews' },
  software: { key: 'expirationDate', kind: 'expires' },
  cards: { key: 'expiry', kind: 'expires' }
};

/** Parse YYYY-MM-DD, or MM/YY (card expiry → last day of that month). */
export function parseDateField(value: string | undefined): Date | null {
  if (!value) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{2})\/(\d{2})$/.exec(value.trim());
  if (m) return new Date(2000 + Number(m[2]), Number(m[1]), 0); // day 0 of next month = last day
  return null;
}

/** Items expiring/renewing within `withinDays` (and anything already expired in the last 60 days). */
export function upcomingDates(entries: EntryView[], now = new Date(), withinDays = 30): Upcoming[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: Upcoming[] = [];
  for (const e of entries) {
    const spec = FIELDS[e.categoryId];
    if (!spec) continue;
    const date = parseDateField(e.fields[spec.key]);
    if (!date) continue;
    const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
    if (days <= withinDays && days >= -60) out.push({ entry: e, kind: spec.kind, days, date });
  }
  return out.sort((a, b) => a.days - b.days);
}

export function describeUpcoming(u: Upcoming): string {
  const verb = u.kind === 'renews' ? 'Renews' : 'Expires';
  if (u.days < 0) return u.kind === 'renews' ? `Renewal was ${-u.days} day${u.days === -1 ? '' : 's'} ago` : `Expired ${-u.days} day${u.days === -1 ? '' : 's'} ago`;
  if (u.days === 0) return `${verb} today`;
  if (u.days === 1) return `${verb} tomorrow`;
  return `${verb} in ${u.days} days`;
}
