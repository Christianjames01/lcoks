import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acknowledge,
  applyDelete,
  applyEdit,
  atLocal,
  calendarNotifications,
  isOverdue,
  newEventInput,
  occurrenceStarts,
  occurrencesInRange,
  remindersBetween,
  reminderText,
  setDone,
  snooze,
  type CalendarEvent,
  type CalendarEventInput
} from '../src/shared/calendar';
import { validateEventInput, validatePayload } from '../src/core/schema';
import { VaultService } from '../src/main/vault/vaultService';

let seq = 0;
function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  const base = newEventInput('2026-10-25', { hour: 10, reminders: [] });
  return { ...base, title: 'Submit requirements', id: `e${++seq}`, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...over };
}

describe('occurrences', () => {
  it('single event', () => {
    expect(occurrenceStarts(ev(), '2026-10-01', '2026-10-31')).toEqual(['2026-10-25']);
    expect(occurrenceStarts(ev(), '2026-11-01', '2026-11-30')).toEqual([]);
  });

  it('daily with interval and count', () => {
    const e = ev({ start: '2026-10-01', end: '2026-10-01', repeat: { freq: 'daily', interval: 2, count: 3 } });
    expect(occurrenceStarts(e, '2026-01-01', '2027-01-01')).toEqual(['2026-10-01', '2026-10-03', '2026-10-05']);
  });

  it('weekly on several weekdays until a date, with an exception', () => {
    // 2026-10-05 is a Monday.
    const e = ev({ start: '2026-10-05', end: '2026-10-05', repeat: { freq: 'weekly', interval: 1, weekdays: [1, 3], until: '2026-10-21' }, exdates: ['2026-10-14'] });
    expect(occurrenceStarts(e, '2026-10-01', '2026-12-31')).toEqual(['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-19', '2026-10-21']);
  });

  it('monthly on the 31st skips short months', () => {
    const e = ev({ start: '2026-01-31', end: '2026-01-31', repeat: { freq: 'monthly', interval: 1 } });
    expect(occurrenceStarts(e, '2026-01-01', '2026-06-30')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('yearly on Feb 29 only in leap years', () => {
    const e = ev({ start: '2024-02-29', end: '2024-02-29', repeat: { freq: 'yearly', interval: 1 } });
    expect(occurrenceStarts(e, '2024-01-01', '2032-12-31')).toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
  });

  it('finds occurrences far in the future without walking forever', () => {
    const e = ev({ start: '2020-01-01', end: '2020-01-01', repeat: { freq: 'daily', interval: 1 } });
    expect(occurrenceStarts(e, '2026-10-20', '2026-10-22')).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });

  it('multi-day events show on every day they cover', () => {
    const e = ev({ start: '2026-10-25', end: '2026-10-27', allDay: true, startTime: '', endTime: '' });
    expect(occurrencesInRange([e], '2026-10-26', '2026-10-26')).toHaveLength(1);
  });

  it('overdue only when ended and not done', () => {
    const e = ev();
    const [o] = occurrencesInRange([e], '2026-10-25', '2026-10-25');
    expect(isOverdue(o!, new Date(2026, 9, 25, 10, 30))).toBe(false);
    expect(isOverdue(o!, new Date(2026, 9, 25, 12, 0))).toBe(true);
    const [d] = occurrencesInRange([{ ...e, done: ['2026-10-25'] }], '2026-10-25', '2026-10-25');
    expect(isOverdue(d!, new Date(2026, 9, 26))).toBe(false);
  });
});

describe('reminders', () => {
  const rules: CalendarEvent['reminders'] = [
    { id: 'a', type: 'before', minutes: 7 * 1440, enabled: true },
    { id: 'b', type: 'before', minutes: 1440, enabled: true },
    { id: 'c', type: 'dayAt', days: 0, time: '08:00', enabled: true },
    { id: 'd', type: 'before', minutes: 30, enabled: true },
    { id: 'e', type: 'before', minutes: 0, enabled: true },
    { id: 'f', type: 'before', minutes: 10, enabled: false },
    { id: 'g', type: 'at', at: '2026-10-20T19:15', enabled: true }
  ];

  it('rings at times computed from the event, skipping disabled ones', () => {
    const e = ev({ reminders: rules });
    const due = remindersBetween([e], atLocal('2026-10-01', '00:00').getTime(), atLocal('2026-10-31', '00:00').getTime());
    const at = due.map((d) => new Date(d.at).toString());
    expect(due.map((d) => d.rule?.id)).toEqual(['a', 'g', 'b', 'c', 'd', 'e']);
    expect(at[0]).toBe(new Date(2026, 9, 18, 10, 0).toString());
    expect(at[3]).toBe(new Date(2026, 9, 25, 8, 0).toString());
    expect(at[5]).toBe(new Date(2026, 9, 25, 10, 0).toString());
  });

  it('dismissed and done reminders stay quiet; snoozed ones ring again', () => {
    const e = ev({ reminders: [rules[3]!] });
    const from = atLocal('2026-10-25', '09:00').getTime();
    const to = atLocal('2026-10-25', '11:00').getTime();
    const [first] = remindersBetween([e], from, to);
    expect(first).toBeTruthy();
    const acked = { ...e, ...acknowledge(e, first!.key) } as CalendarEvent;
    expect(remindersBetween([acked], from, to)).toHaveLength(0);
    const snoozed = { ...e, ...snooze(e, first!.key, 10, first!.at) } as CalendarEvent;
    const again = remindersBetween([snoozed], from, to);
    expect(again).toHaveLength(1);
    expect(again[0]!.snoozed).toBe(true);
    expect(again[0]!.at).toBe(first!.at + 10 * 60_000);
    const done = { ...e, ...setDone(e, '2026-10-25', true) } as CalendarEvent;
    expect(remindersBetween([done], from, to)).toHaveLength(0);
  });

  it('each occurrence of a repeating event gets its own reminder', () => {
    const e = ev({ start: '2026-10-05', end: '2026-10-05', repeat: { freq: 'daily', interval: 1, count: 3 }, reminders: [rules[4]!] });
    const due = remindersBetween([e], atLocal('2026-10-01', '00:00').getTime(), atLocal('2026-10-31', '00:00').getTime());
    expect(new Set(due.map((d) => d.key)).size).toBe(3);
  });

  it('notifications hide the title unless previews are on', () => {
    const e = ev({ title: 'Doctor: Dr. Santos', reminders: [rules[3]!] });
    const now = atLocal('2026-10-25', '09:00').getTime();
    const [d] = remindersBetween([e], now, now + 3_600_000);
    expect(JSON.stringify(reminderText(d!, now, false))).not.toContain('Santos');
    expect(reminderText(d!, now, true).title).toBe('Doctor: Dr. Santos');
    const list = calendarNotifications([e], now, { preview: false, sound: false });
    expect(list).toHaveLength(1);
    expect(list[0]!.silent).toBe(true);
    expect(list[0]!.kind).toBe('calendar');
  });
});

describe('editing and deleting repeating events', () => {
  const series = () => ev({ start: '2026-10-05', end: '2026-10-05', repeat: { freq: 'weekly', interval: 1 }, done: ['2026-10-05'] });
  const edited = (s: CalendarEvent, day: string): CalendarEventInput => ({ ...s, title: 'Changed', start: day, end: day });

  it('only this occurrence', () => {
    const s = series();
    const c = applyEdit(s, '2026-10-12', edited(s, '2026-10-12'), 'this');
    expect(c.save).toHaveLength(2);
    expect(c.save[0]!.exdates).toContain('2026-10-12');
    expect(c.save[1]!.id).toBeUndefined();
    expect(c.save[1]!.repeat).toBeNull();
    expect(c.save[1]!.title).toBe('Changed');
  });

  it('this and following', () => {
    const s = series();
    const c = applyEdit(s, '2026-10-19', edited(s, '2026-10-19'), 'future');
    expect(c.save[0]!.repeat!.until).toBe('2026-10-18');
    expect(c.save[1]!.start).toBe('2026-10-19');
    expect(c.save[1]!.repeat!.freq).toBe('weekly');
  });

  it('whole series moves with the occurrence', () => {
    const s = series();
    const c = applyEdit(s, '2026-10-12', { ...s, title: 'Changed', start: '2026-10-13', end: '2026-10-13' }, 'all');
    expect(c.save).toHaveLength(1);
    expect(c.save[0]!.id).toBe(s.id);
    expect(c.save[0]!.start).toBe('2026-10-06');
  });

  it('delete scopes', () => {
    const s = series();
    expect(applyDelete(s, '2026-10-12', 'this').save[0]!.exdates).toContain('2026-10-12');
    expect(applyDelete(s, '2026-10-12', 'future').save[0]!.repeat!.until).toBe('2026-10-11');
    expect(applyDelete(s, '2026-10-12', 'all')).toEqual({ save: [], remove: [s.id] });
    expect(applyDelete(ev(), '2026-10-25', 'this')).toEqual({ save: [], remove: [expect.any(String)] });
  });
});

describe('validation', () => {
  it('accepts a full event and drops duplicate reminders', () => {
    const v = validateEventInput({
      ...newEventInput('2026-10-25', { reminders: [30] }),
      title: '  Exam  ',
      reminders: [
        { id: 'a', type: 'before', minutes: 30, enabled: true },
        { id: 'b', type: 'before', minutes: 30, enabled: true },
        { id: 'c', type: 'at', at: '2026-10-24T08:00', enabled: false }
      ],
      repeat: { freq: 'weekly', interval: 1, weekdays: [6, 1, 1], count: 4 },
      __proto__: { bad: 1 }
    });
    expect(v.title).toBe('Exam');
    expect(v.reminders.map((r) => r.id)).toEqual(['a', 'c']);
    expect(v.repeat).toEqual({ freq: 'weekly', interval: 1, weekdays: [1, 6], count: 4 });
  });

  it('rejects bad input', () => {
    const ok = { ...newEventInput('2026-10-25'), title: 'x' };
    expect(() => validateEventInput({ ...ok, title: ' ' })).toThrow();
    expect(() => validateEventInput({ ...ok, end: '2026-10-24' })).toThrow();
    expect(() => validateEventInput({ ...ok, startTime: '11:00', endTime: '10:00' })).toThrow();
    expect(() => validateEventInput({ ...ok, start: '2026-02-30', end: '2026-02-30' })).toThrow();
    expect(() => validateEventInput({ ...ok, repeat: { freq: 'daily', interval: 1, until: '2026-01-01' } })).toThrow();
  });

  it('payload keeps valid events and skips broken ones', () => {
    const p = validatePayload({ schema: 1, entries: [], events: [{ ...newEventInput('2026-10-25'), title: 'Kept', id: 'k1' }, { title: 'broken' }] });
    expect(p.events.map((e) => e.title)).toEqual(['Kept']);
    expect(validatePayload({ schema: 1, entries: [] }).events).toEqual([]);
  });
});

describe('vault storage', () => {
  it('saves, edits and deletes events encrypted, and keeps them after re-unlock', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-cal-'));
    try {
      const file = path.join(dir, 'vault', 'vault.vault');
      const pw = 'Calendar-Test-Master-Pass-2026!';
      const v = new VaultService(file);
      await v.create(pw, null);
      const [saved] = await v.saveEvents([{ ...newEventInput('2026-10-25', { reminders: [30, 1440] }), title: 'Exam week' }], []);
      expect(saved!.id).toBeTruthy();
      expect((await fs.readFile(file, 'utf8')).includes('Exam week')).toBe(false);
      await v.saveEvents([{ ...saved!, title: 'Final exam' }], []);
      v.lock();
      await v.unlock(pw);
      const snap = await v.snapshot();
      expect(snap.events.map((e) => [e.title, e.reminders.length])).toEqual([['Final exam', 2]]);
      await expect(v.saveEvents([], ['missing'])).rejects.toThrow();
      await v.saveEvents([], [saved!.id]);
      expect((await v.snapshot()).events).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
