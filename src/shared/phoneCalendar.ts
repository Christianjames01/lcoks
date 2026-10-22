// What VaultLocks copies into the phone's calendar (Android, opt-in) so the phone's
// own calendar widgets — lock screen and home screen — show today's events and tasks.
// Only what the user chose leaves the vault: titles, or just "VaultLocks event".
import { addDays, atLocal, occurrencesInRange, type CalendarEvent } from './calendar';
import { dayKey, parseDay } from './money';
import type { Task } from './tasks';

export interface PhoneCalendarItem {
  title: string;
  /** Epoch ms. All-day items run from UTC midnight to UTC midnight (Android's rule). */
  start: number;
  end: number;
  allDay: boolean;
}

export const PHONE_CALENDAR_DAYS = 14;

const utcMidnight = (day: string) => {
  const d = parseDay(day);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

/** Events and open tasks with a due date from today through the next PHONE_CALENDAR_DAYS days. */
export function phoneCalendarItems(events: CalendarEvent[], tasks: Task[], now: Date, names: boolean, days = PHONE_CALENDAR_DAYS): PhoneCalendarItem[] {
  const from = dayKey(now);
  const to = addDays(from, days - 1);
  const out: PhoneCalendarItem[] = [];
  for (const o of occurrencesInRange(events, from, to)) {
    if (o.done) continue;
    const ev = o.event;
    const title = names ? ev.title : 'VaultLocks event';
    if (ev.allDay) out.push({ title, start: utcMidnight(o.day), end: utcMidnight(addDays(o.endDay, 1)), allDay: true });
    else out.push({ title, start: atLocal(o.day, ev.startTime).getTime(), end: atLocal(o.endDay, ev.endTime).getTime(), allDay: false });
  }
  for (const t of tasks) {
    if (t.completed || !t.due || t.due < from || t.due > to) continue;
    const title = names ? `☐ ${t.title}` : 'VaultLocks task';
    if (t.dueTime) {
      const start = atLocal(t.due, t.dueTime).getTime();
      out.push({ title, start, end: start + 30 * 60_000, allDay: false });
    } else out.push({ title, start: utcMidnight(t.due), end: utcMidnight(addDays(t.due, 1)), allDay: true });
  }
  return out.sort((a, b) => a.start - b.start).slice(0, 300);
}
