// Calendar events with reminders and repeats. Pure logic shared by the vault core
// (validation), the renderer (views, in-app alarms) and the phone scheduler.
// Dates are local "floating" day keys (YYYY-MM-DD) plus HH:MM, so an event at
// 10:00 stays at 10:00 across daylight-saving changes and time-zone moves.
import { dayKey, isDayKey, parseDay } from './money';

import { dayNames, tr } from './i18n';
export type EventCategory = 'personal' | 'work' | 'school' | 'appointment' | 'bill' | 'birthday' | 'renewal' | 'other';

export const EVENT_CATEGORIES: { id: EventCategory; name: string; color: string }[] = [
  { id: 'personal', name: 'Personal', color: '#0A84FF' },
  { id: 'work', name: 'Work / meeting', color: '#5E5CE6' },
  { id: 'school', name: 'School', color: '#FF9F0A' },
  { id: 'appointment', name: 'Appointment', color: '#32ADE6' },
  { id: 'bill', name: 'Bill payment', color: '#FF453A' },
  { id: 'birthday', name: 'Birthday', color: '#FF375F' },
  { id: 'renewal', name: 'Document renewal', color: '#30D158' },
  { id: 'other', name: 'Other', color: '#8E8E93' }
];
export const EVENT_CATEGORY_IDS = new Set<string>(EVENT_CATEGORIES.map((c) => c.id));
export const eventCategory = (id: string) => EVENT_CATEGORIES.find((c) => c.id === id) ?? EVENT_CATEGORIES[EVENT_CATEGORIES.length - 1]!;

export type ReminderRule =
  /** `minutes` before the start (0 = at the event time). */
  | { id: string; type: 'before'; minutes: number; enabled: boolean }
  /** `days` before, at a time of day (days 0 = on the day, e.g. 08:00). */
  | { id: string; type: 'dayAt'; days: number; time: string; enabled: boolean }
  /** A custom date and time (YYYY-MM-DDTHH:MM, local). */
  | { id: string; type: 'at'; at: string; enabled: boolean };

export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Repeat {
  freq: RepeatFreq;
  /** Every n days / weeks / months / years. */
  interval: number;
  /** Weekly: days of the week (0 = Sunday). Defaults to the start's weekday. */
  weekdays?: number[];
  /** Last possible day (inclusive). */
  until?: string;
  /** Number of occurrences. */
  count?: number;
}

/** A reminder pushed back by "Remind me later". */
export interface Snooze {
  key: string;
  /** Epoch ms. */
  until: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  notes: string;
  location: string;
  category: EventCategory;
  allDay: boolean;
  /** First day (YYYY-MM-DD). */
  start: string;
  /** HH:MM ('' for all-day). */
  startTime: string;
  end: string;
  endTime: string;
  reminders: ReminderRule[];
  repeat: Repeat | null;
  /** Occurrences removed from a repeating event (start days). */
  exdates: string[];
  /** Occurrences marked done (start days). */
  done: string[];
  /** Reminder keys already shown and dismissed — never shown again. */
  acks: string[];
  snoozes: Snooze[];
  createdAt: string;
  updatedAt: string;
}

export type CalendarEventInput = Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export const MAX_REMINDERS = 12;
export const MAX_REPEAT_COUNT = 1000;
/** All-day events: reminders "x before" count from 09:00 on the day. */
export const ALL_DAY_TIME = '09:00';

export const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: tr("At event time") },
  { minutes: 5, label: tr("5 minutes before") },
  { minutes: 10, label: tr("10 minutes before") },
  { minutes: 15, label: tr("15 minutes before") },
  { minutes: 30, label: tr("30 minutes before") },
  { minutes: 60, label: tr("1 hour before") },
  { minutes: 120, label: tr("2 hours before") },
  { minutes: 1440, label: tr("1 day before") },
  { minutes: 2880, label: tr("2 days before") },
  { minutes: 4320, label: tr("3 days before") },
  { minutes: 10080, label: tr("7 days before") }
];

export const SNOOZE_CHOICES = [5, 10, 15, 30, 60];

// ------------------------------------------------------------------ helpers --

export const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const isLocalDateTime = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(v) && isDayKey(v.slice(0, 10));

export const timeToMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const pad = (n: number) => String(n).padStart(2, '0');
export const minToTime = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/** Local date-time from a day key and HH:MM. */
export function atLocal(day: string, time: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, Number(time.slice(0, 2)), Number(time.slice(3, 5)), 0, 0);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

export const weekdayOf = (day: string) => parseDay(day).getDay();

/** 9:30 AM style. */
export function formatTime(t: string): string {
  if (!isTime(t)) return '';
  const h = Number(t.slice(0, 2));
  return `${h % 12 || 12}:${t.slice(3)} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return parseDay(day).toLocaleDateString(undefined, opts);
}

/** Time the event's reminders count from on a given occurrence. */
export function referenceTime(ev: Pick<CalendarEvent, 'allDay' | 'startTime'>, occDay: string): Date {
  return atLocal(occDay, ev.allDay || !isTime(ev.startTime) ? ALL_DAY_TIME : ev.startTime);
}

export const occurrenceKey = (eventId: string, occDay: string) => `${eventId}|${occDay}`;
export const reminderKey = (eventId: string, occDay: string, ruleId: string) => `${eventId}|${occDay}|${ruleId}`;

export function describeReminder(r: ReminderRule): string {
  if (r.type === 'before') return REMINDER_PRESETS.find((p) => p.minutes === r.minutes)?.label ?? describeMinutes(r.minutes);
  if (r.type === 'dayAt') return `${r.days === 0 ? 'On the day' : r.days === 1 ? '1 day before' : `${r.days} days before`} at ${formatTime(r.time)}`;
  return `${formatDay(r.at.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' })} at ${formatTime(r.at.slice(11))}`;
}

function describeMinutes(m: number): string {
  if (m === 0) return 'At event time';
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'} before`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'} before`;
  return `${m} minutes before`;
}

/** Same reminder twice (ignores id and on/off). */
export function reminderSignature(r: ReminderRule): string {
  return r.type === 'before' ? `b${r.minutes}` : r.type === 'dayAt' ? `d${r.days}@${r.time}` : `a${r.at}`;
}

export function describeRepeat(r: Repeat | null, start: string): string {
  if (!r) return 'Does not repeat';
  const n = r.interval;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq];
  let s = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (r.freq === 'weekly') {
    const days = (r.weekdays?.length ? r.weekdays : [weekdayOf(start)]).map((d) => dayNames()[d]!.slice(0, 3));
    s += ` on ${days.join(', ')}`;
  }
  if (r.until) s += `, until ${formatDay(r.until, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  else if (r.count) s += `, ${r.count} times`;
  return s;
}

// -------------------------------------------------------------- occurrences --

const MAX_STEPS = 50_000;

/**
 * Start days of the occurrences that begin within [from, to] (inclusive), in order.
 * Removed occurrences (exdates) are left out but still count toward `count`.
 * Monthly on the 31st skips shorter months; yearly on Feb 29 skips non-leap years.
 */
export function occurrenceStarts(ev: Pick<CalendarEvent, 'start' | 'repeat' | 'exdates'>, from: string, to: string): string[] {
  const out: string[] = [];
  const ex = new Set(ev.exdates);
  const push = (d: string) => {
    if (d >= from && d <= to && !ex.has(d)) out.push(d);
  };
  const r = ev.repeat;
  if (!r) {
    push(ev.start);
    return out;
  }
  const last = r.until && r.until < to ? r.until : to;
  if (last < ev.start) return out;
  const interval = Math.max(1, r.interval);
  let made = 0;
  const more = () => !r.count || made < r.count;
  const start = parseDay(ev.start);

  if (r.freq === 'daily') {
    // Jump close to `from` without walking every day.
    let k = 0;
    if (from > ev.start && !r.count) k = Math.max(0, Math.floor(daysBetween(ev.start, from) / interval) - 1);
    for (let steps = 0; steps < MAX_STEPS && more(); steps++, k++) {
      const d = addDays(ev.start, k * interval);
      if (d > last) break;
      made++;
      push(d);
    }
  } else if (r.freq === 'weekly') {
    const days = [...new Set(r.weekdays?.length ? r.weekdays : [start.getDay()])].sort((a, b) => a - b);
    const week0 = addDays(ev.start, -start.getDay());
    let w = 0;
    if (from > ev.start && !r.count) w = Math.max(0, Math.floor(daysBetween(week0, from) / 7 / interval) - 1);
    for (let steps = 0; steps < MAX_STEPS && more(); steps++, w++) {
      const ws = addDays(week0, w * interval * 7);
      if (ws > last) break;
      for (const wd of days) {
        const d = addDays(ws, wd);
        if (d < ev.start) continue;
        if (d > last || !more()) break;
        made++;
        push(d);
      }
    }
  } else {
    const months = r.freq === 'monthly' ? interval : interval * 12;
    const dom = start.getDate();
    let k = 0;
    if (from > ev.start && !r.count) {
      const f = parseDay(from);
      const diff = (f.getFullYear() - start.getFullYear()) * 12 + f.getMonth() - start.getMonth();
      k = Math.max(0, Math.floor(diff / months) - 1);
    }
    for (let steps = 0; steps < MAX_STEPS && more(); steps++, k++) {
      const d = new Date(start.getFullYear(), start.getMonth() + k * months, 1, 12);
      const first = dayKey(d);
      if (first > last) break;
      d.setDate(dom);
      if (d.getDate() !== dom) continue; // that month has no such day
      const key = dayKey(d);
      if (key > last) break;
      made++;
      push(key);
    }
  }
  return out;
}

export interface Occurrence {
  event: CalendarEvent;
  /** Start day of this occurrence. */
  day: string;
  /** Last day of this occurrence (multi-day events). */
  endDay: string;
  key: string;
  done: boolean;
}

/** Occurrences overlapping [from, to], sorted by start (all-day first). */
export function occurrencesInRange(events: CalendarEvent[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of events) {
    const span = Math.max(0, daysBetween(ev.start, ev.end));
    for (const day of occurrenceStarts(ev, span ? addDays(from, -span) : from, to)) {
      out.push({ event: ev, day, endDay: addDays(day, span), key: occurrenceKey(ev.id, day), done: ev.done.includes(day) });
    }
  }
  return out.sort(compareOccurrences);
}

export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.event.allDay !== b.event.allDay) return a.event.allDay ? -1 : 1;
  if (a.event.startTime !== b.event.startTime) return a.event.startTime < b.event.startTime ? -1 : 1;
  return a.event.title.localeCompare(b.event.title);
}

/** Occurrences shown on one day (including days in the middle of multi-day events). */
export function occurrencesOn(events: CalendarEvent[], day: string): Occurrence[] {
  return occurrencesInRange(events, day, day);
}

/** Start and end of an occurrence as dates. */
export function occurrenceBounds(o: Pick<Occurrence, 'event' | 'day' | 'endDay'>): { start: Date; end: Date } {
  const ev = o.event;
  if (ev.allDay) return { start: atLocal(o.day, '00:00'), end: atLocal(addDays(o.endDay, 1), '00:00') };
  return { start: atLocal(o.day, ev.startTime), end: atLocal(o.endDay, ev.endTime) };
}

/**
 * Past its end and not marked done. Only one-off events (deadlines, tasks) can be
 * overdue — past meetings of a repeating series are simply in the past.
 */
export function isOverdue(o: Occurrence, now: Date): boolean {
  return !o.done && !o.event.repeat && occurrenceBounds(o).end.getTime() <= now.getTime();
}

// ---------------------------------------------------------------- reminders --

export interface DueReminder {
  key: string;
  event: CalendarEvent;
  day: string;
  at: number;
  rule: ReminderRule | null;
  snoozed: boolean;
}

function reminderAt(ev: CalendarEvent, day: string, r: ReminderRule): number | null {
  if (!r.enabled) return null;
  if (r.type === 'before') return referenceTime(ev, day).getTime() - r.minutes * 60_000;
  if (r.type === 'dayAt') return atLocal(addDays(day, -r.days), r.time).getTime();
  // A custom date belongs to the first occurrence only.
  return day === ev.start ? atLocal(r.at.slice(0, 10), r.at.slice(11)).getTime() : null;
}

/** Longest lead time of an event's reminders, in days (to know which occurrences can ring soon). */
function leadDays(ev: CalendarEvent): number {
  let lead = 0;
  for (const r of ev.reminders) {
    if (r.type === 'before') lead = Math.max(lead, Math.ceil(r.minutes / 1440) + 1);
    else if (r.type === 'dayAt') lead = Math.max(lead, r.days + 1);
  }
  return lead;
}

/**
 * Reminders that ring in (from, to] — not dismissed, not for a done occurrence,
 * plus snoozed ones whose snooze ends in the window.
 */
export function remindersBetween(events: CalendarEvent[], from: number, to: number): DueReminder[] {
  const out: DueReminder[] = [];
  const fromDay = dayKey(new Date(from));
  const toDay = dayKey(new Date(to));
  for (const ev of events) {
    if (ev.reminders.some((r) => r.enabled)) {
      const acks = new Set(ev.acks);
      const lead = leadDays(ev);
      // A custom-date reminder may sit anywhere relative to the first occurrence.
      const custom = ev.reminders.find((r) => r.type === 'at' && r.enabled);
      const days = new Set(occurrenceStarts(ev, addDays(fromDay, -1), addDays(toDay, lead + 1)));
      if (custom && !ev.exdates.includes(ev.start)) days.add(ev.start);
      for (const day of days) {
        if (ev.done.includes(day)) continue;
        for (const r of ev.reminders) {
          const at = reminderAt(ev, day, r);
          if (at === null || at <= from || at > to) continue;
          const key = reminderKey(ev.id, day, r.id);
          if (acks.has(key)) continue;
          out.push({ key, event: ev, day, at, rule: r, snoozed: false });
        }
      }
    }
    for (const s of ev.snoozes) {
      if (s.until <= from || s.until > to) continue;
      const day = s.key.split('|')[1] ?? ev.start;
      if (ev.done.includes(day)) continue;
      out.push({ key: s.key, event: ev, day, at: s.until, rule: ev.reminders.find((r) => r.id === s.key.split('|')[2]) ?? null, snoozed: true });
    }
  }
  // One alert per key and time.
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.at - b.at)
    .filter((d) => {
      const k = `${d.key}@${d.at}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Notification text. With `preview` off only the time is shown, never the title. */
export function reminderText(d: DueReminder, now: number, preview: boolean): { title: string; body: string } {
  const ev = d.event;
  const when = ev.allDay ? formatDay(d.day, { weekday: 'short', month: 'short', day: 'numeric' }) : `${relativeDay(d.day, now)} at ${formatTime(ev.startTime)}`;
  const title = preview ? ev.title : 'VaultLocks reminder';
  const body = preview ? `${eventCategory(ev.category).name} · ${when}` : `You have an event ${ev.allDay ? `on ${when}` : when.charAt(0).toLowerCase() + when.slice(1)}. Open VaultLocks to see it.`;
  return { title, body };
}

/** "Today", "Tomorrow", "Yesterday" or a short date. */
export function relativeDay(day: string, now: number): string {
  const diff = daysBetween(dayKey(new Date(now)), day);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatDay(day, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "in 2 hours", "in 3 days", "now", "15 minutes ago". */
export function timeUntil(target: number, now: number): string {
  const diff = target - now;
  const abs = Math.abs(diff);
  const unit = abs < 3_600_000 ? [Math.round(abs / 60_000), 'minute'] : abs < 86_400_000 ? [Math.round(abs / 3_600_000), 'hour'] : [Math.round(abs / 86_400_000), 'day'];
  const [n, u] = unit as [number, string];
  if (n === 0) return 'now';
  const s = `${n} ${u}${n === 1 ? '' : 's'}`;
  return diff > 0 ? `in ${s}` : `${s} ago`;
}

export function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 1) || 1;
}

// ------------------------------------------------------- edits and deletes --

export type Scope = 'this' | 'future' | 'all';

export interface EventChanges {
  save: CalendarEventInput[];
  remove: string[];
}

const strip = (ev: CalendarEvent): CalendarEventInput => {
  const { createdAt: _c, updatedAt: _u, ...rest } = ev;
  return { ...rest, reminders: rest.reminders.map((r) => ({ ...r })), exdates: [...rest.exdates], done: [...rest.done], acks: [...rest.acks], snoozes: rest.snoozes.map((s) => ({ ...s })) };
};

/** Keep per-occurrence state only for occurrences in [from, to]. */
function keepState(ev: CalendarEventInput, from: string, to = '9999-12-31'): CalendarEventInput {
  const inside = (d: string) => d >= from && d <= to;
  const dayOfKey = (k: string) => k.split('|')[1] ?? '';
  return {
    ...ev,
    exdates: ev.exdates.filter(inside),
    done: ev.done.filter(inside),
    acks: ev.acks.filter((k) => inside(dayOfKey(k))),
    snoozes: ev.snoozes.filter((s) => inside(dayOfKey(s.key)))
  };
}

/**
 * Turn an edit of one occurrence (`occDay`) into stored changes.
 * `edited` is the form (start/end are the edited occurrence's dates).
 */
export function applyEdit(series: CalendarEvent, occDay: string, edited: CalendarEventInput, scope: Scope): EventChanges {
  const base = strip(series);
  const fresh = { ...edited, id: undefined, exdates: [], done: [], acks: [], snoozes: [] };
  if (!series.repeat || scope === 'all' || (scope === 'future' && occDay === series.start)) {
    // Whole series: moving this occurrence moves the series by the same number of days.
    const shift = series.repeat ? daysBetween(occDay, edited.start) : 0;
    const start = series.repeat ? addDays(series.start, shift) : edited.start;
    const span = daysBetween(edited.start, edited.end);
    const reset = start !== series.start || JSON.stringify(edited.repeat) !== JSON.stringify(series.repeat);
    return {
      save: [
        {
          ...edited,
          id: series.id,
          start,
          end: addDays(start, span),
          exdates: reset ? [] : base.exdates,
          done: reset ? [] : base.done,
          acks: base.acks,
          snoozes: base.snoozes
        }
      ],
      remove: []
    };
  }
  if (scope === 'this') {
    return {
      save: [{ ...base, exdates: [...new Set([...base.exdates, occDay])] }, { ...fresh, repeat: null, done: series.done.includes(occDay) ? [edited.start] : [] }],
      remove: []
    };
  }
  // This and following: the old series ends the day before, a new one starts here.
  return {
    save: [{ ...keepState(base, '0000-01-01', addDays(occDay, -1)), repeat: endRepeat(series.repeat, addDays(occDay, -1)) }, fresh],
    remove: []
  };
}

function endRepeat(r: Repeat, until: string): Repeat {
  const { count: _count, ...rest } = r;
  return { ...rest, until: r.until && r.until < until ? r.until : until };
}

export function applyDelete(series: CalendarEvent, occDay: string, scope: Scope): EventChanges {
  if (!series.repeat || scope === 'all' || (scope === 'future' && occDay === series.start)) return { save: [], remove: [series.id] };
  const base = strip(series);
  if (scope === 'this') {
    const exdates = [...new Set([...base.exdates, occDay])];
    // Every occurrence removed: delete the series.
    if (series.repeat.until || series.repeat.count) {
      const left = occurrenceStarts({ ...series, exdates }, series.start, series.repeat.until ?? '9999-12-31');
      if (left.length === 0) return { save: [], remove: [series.id] };
    }
    return { save: [{ ...base, exdates }], remove: [] };
  }
  return { save: [{ ...keepState(base, '0000-01-01', addDays(occDay, -1)), repeat: endRepeat(series.repeat, addDays(occDay, -1)) }], remove: [] };
}

/** Mark one occurrence done / not done. Its pending reminders stop. */
export function setDone(ev: CalendarEvent, occDay: string, done: boolean): CalendarEventInput {
  const base = strip(ev);
  const list = new Set(base.done);
  if (done) list.add(occDay);
  else list.delete(occDay);
  return { ...base, done: [...list].sort().slice(-1000), snoozes: done ? base.snoozes.filter((s) => s.key.split('|')[1] !== occDay) : base.snoozes };
}

/** Dismiss a reminder for good (also ends a snooze of it). */
export function acknowledge(ev: CalendarEvent, key: string): CalendarEventInput {
  const base = strip(ev);
  return { ...base, acks: [...new Set([...base.acks, key])].slice(-2000), snoozes: base.snoozes.filter((s) => s.key !== key) };
}

/** Ring again in `minutes`. */
export function snooze(ev: CalendarEvent, key: string, minutes: number, now: number): CalendarEventInput {
  const base = acknowledge(ev, key);
  return { ...base, snoozes: [...base.snoozes, { key, until: now + minutes * 60_000 }].slice(-50) };
}

/** Text search over title, notes, location, category, date and status. */
export function matchesEvent(o: Occurrence, q: string, now: Date): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const ev = o.event;
  const status = o.done ? 'completed done' : isOverdue(o, now) ? 'overdue' : 'upcoming';
  const hay = [ev.title, ev.notes, ev.location, eventCategory(ev.category).name, o.day, formatDay(o.day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), status]
    .join(' ')
    .toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w));
}

/** Blank event for a day (and optionally an hour). */
export function newEventInput(day: string, opts: { hour?: number; reminders?: number[] } = {}): CalendarEventInput {
  const h = opts.hour ?? 9;
  const startTime = minToTime(Math.min(h, 22) * 60);
  return {
    title: '',
    notes: '',
    location: '',
    category: 'personal',
    allDay: false,
    start: day,
    startTime,
    end: day,
    endTime: minToTime(Math.min(h, 22) * 60 + 60),
    reminders: (opts.reminders ?? [30]).map((minutes, i) => ({ id: `r${i + 1}`, type: 'before' as const, minutes, enabled: true })),
    repeat: null,
    exdates: [],
    done: [],
    acks: [],
    snoozes: []
  };
}

/**
 * Notifications to schedule on the phone / desktop: the next `max` reminders within
 * `horizonDays`. Rebuilt on every change, so edits and deletes cancel old ones.
 */
export function calendarNotifications(
  events: CalendarEvent[],
  now: number,
  opts: { preview: boolean; sound: boolean; horizonDays?: number; max?: number }
): { id: number; at: number; title: string; body: string; kind: 'calendar'; silent: boolean }[] {
  const to = now + (opts.horizonDays ?? 60) * 86_400_000;
  return remindersBetween(events, now, to)
    .slice(0, opts.max ?? 60)
    .map((d) => ({ id: hashId(`cal|${d.key}|${d.at}`), at: d.at, ...reminderText(d, d.at, opts.preview), kind: 'calendar' as const, silent: !opts.sound }));
}
