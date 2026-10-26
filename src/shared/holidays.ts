// Philippine holidays for the calendar (and Kadayawan for Davao). Fixed dates every
// year; Holy Week from the Easter date; the Islamic and Chinese New Year dates are
// listed for the years we know (the government announces them each year).

import { dayKey } from './money';
import { tr } from './i18n';

export type HolidayKind = 'regular' | 'special' | 'festival' | 'reminder';

export interface Holiday {
  date: string;
  name: string;
  kind: HolidayKind;
}

/** Easter Sunday (Gregorian), as a local date. */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const key = (y: number, m: number, d: number) => dayKey(new Date(y, m - 1, d));
const shift = (date: Date, days: number) => dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));

/** Last Monday of August: National Heroes Day. */
function lastMonday(year: number, month: number): string {
  const d = new Date(year, month, 0);
  while (d.getDay() !== 1) d.setDate(d.getDate() - 1);
  return dayKey(d);
}

// Proclaimed each year (approximate until announced; the user can still add their own events).
const MOVING: Record<number, [string, string, HolidayKind][]> = {
  2025: [
    ['2025-01-29', 'Chinese New Year', 'special'],
    ['2025-04-01', "Eid'l Fitr", 'regular'],
    ['2025-06-06', "Eid'l Adha", 'regular']
  ],
  2026: [
    ['2026-02-17', 'Chinese New Year', 'special'],
    ['2026-03-20', "Eid'l Fitr", 'regular'],
    ['2026-05-27', "Eid'l Adha", 'regular']
  ],
  2027: [
    ['2027-02-06', 'Chinese New Year', 'special'],
    ['2027-03-10', "Eid'l Fitr", 'regular'],
    ['2027-05-17', "Eid'l Adha", 'regular']
  ]
};

/** Every holiday in a year, sorted by date. */
export function holidaysOf(year: number): Holiday[] {
  const e = easter(year);
  const list: [string, string, HolidayKind][] = [
    [key(year, 1, 1), "New Year's Day", 'regular'],
    [key(year, 2, 25), 'EDSA People Power Anniversary', 'special'],
    [shift(e, -3), 'Maundy Thursday', 'regular'],
    [shift(e, -2), 'Good Friday', 'regular'],
    [shift(e, -1), 'Black Saturday', 'special'],
    [key(year, 4, 9), 'Araw ng Kagitingan', 'regular'],
    [key(year, 5, 1), 'Labor Day', 'regular'],
    [key(year, 6, 12), 'Independence Day', 'regular'],
    [key(year, 8, 21), 'Ninoy Aquino Day', 'special'],
    [lastMonday(year, 8), 'National Heroes Day', 'regular'],
    [key(year, 11, 1), "All Saints' Day", 'special'],
    [key(year, 11, 2), "All Souls' Day", 'special'],
    [key(year, 11, 30), 'Bonifacio Day', 'regular'],
    [key(year, 12, 8), 'Immaculate Conception', 'special'],
    [key(year, 12, 24), 'Christmas Eve', 'special'],
    [key(year, 12, 25), 'Christmas Day', 'regular'],
    [key(year, 12, 30), 'Rizal Day', 'regular'],
    [key(year, 12, 31), 'Last day of the year', 'special'],
    ...(MOVING[year] ?? [])
  ];
  // Kadayawan (Davao): the festival week ends on the third Sunday of August.
  const aug = new Date(year, 7, 1);
  const firstSunday = 1 + ((7 - aug.getDay()) % 7);
  const thirdSunday = firstSunday + 14;
  for (let d = thirdSunday - 2; d <= thirdSunday; d++) list.push([key(year, 8, d), 'Kadayawan Festival (Davao)', 'festival']);
  // Payday reminders that come with the season.
  list.push([key(year, 12, 24), '13th month pay is due by today', 'reminder']);
  return list
    .map(([date, name, kind]) => ({ date, name: tr(name), kind }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'reminder' ? 1 : -1));
}

const cache = new Map<number, Map<string, Holiday[]>>();

/** Holidays on one day (usually none). */
export function holidaysOn(day: string): Holiday[] {
  const year = Number(day.slice(0, 4));
  let m = cache.get(year);
  if (!m) {
    m = new Map();
    for (const h of holidaysOf(year)) m.set(h.date, [...(m.get(h.date) ?? []), h]);
    cache.set(year, m);
  }
  return m.get(day) ?? [];
}

export const HOLIDAY_KIND_LABEL: Record<HolidayKind, string> = {
  regular: 'Regular holiday',
  special: 'Special non-working day',
  festival: 'Festival',
  reminder: 'Reminder'
};
