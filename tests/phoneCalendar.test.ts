import { describe, expect, it } from 'vitest';
import { newEventInput, type CalendarEvent } from '../src/shared/calendar';
import { phoneCalendarItems } from '../src/shared/phoneCalendar';
import { emptyTask, type Task } from '../src/shared/tasks';

const NOW = new Date(2026, 9, 22, 9, 0); // Thu 22 Oct 2026
const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  ...newEventInput('2026-10-22', { hour: 14, reminders: [] }),
  title: 'Team meeting',
  id: 'e1',
  createdAt: '',
  updatedAt: '',
  ...over
});
const task = (over: Partial<Task>): Task => ({ ...emptyTask('2026-10-22'), title: 'Pay tuition', id: 't1', createdAt: '', updatedAt: '', ...over });

describe('phone calendar copy', () => {
  it('copies events and due tasks with names, in time order', () => {
    const items = phoneCalendarItems([ev({})], [task({ dueTime: '08:00' })], NOW, true);
    expect(items.map((i) => i.title)).toEqual(['☐ Pay tuition', 'Team meeting']);
    expect(new Date(items[1]!.start).getHours()).toBe(14);
    expect(items[1]!.allDay).toBe(false);
  });

  it('privacy mode never includes names', () => {
    const items = phoneCalendarItems([ev({ title: 'Doctor Santos' })], [task({ title: 'Secret thing' })], NOW, false);
    expect(JSON.stringify(items)).not.toMatch(/Santos|Secret/);
    expect(items.map((i) => i.title).sort()).toEqual(['VaultLocks event', 'VaultLocks task']);
  });

  it('all-day items run UTC midnight to midnight; done and completed ones are left out', () => {
    const items = phoneCalendarItems(
      [ev({ allDay: true, startTime: '', endTime: '' }), ev({ id: 'e2', title: 'Done one', done: ['2026-10-22'] })],
      [task({ completed: true, completedAt: 'x' })],
      NOW,
      true
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.start).toBe(Date.UTC(2026, 9, 22));
    expect(items[0]!.end).toBe(Date.UTC(2026, 9, 23));
  });

  it('only the next 14 days, repeating events expanded', () => {
    const daily = ev({ start: '2026-10-01', end: '2026-10-01', repeat: { freq: 'daily', interval: 1 } });
    const items = phoneCalendarItems([daily], [task({ due: '2026-12-01' })], NOW, true);
    expect(items).toHaveLength(14);
  });
});

describe('default phone calendar', () => {
  it('picks the main Google calendar (named after the Gmail address)', async () => {
    const { defaultGoogleCalendar } = await import('../src/shared/phoneCalendar');
    const list = [
      { id: 1, name: 'Phone', account: 'Phone', type: 'LOCAL', visible: true },
      { id: 2, name: 'Holidays in Philippines', account: 'me@gmail.com', type: 'com.google', visible: true },
      { id: 3, name: 'me@gmail.com', account: 'me@gmail.com', type: 'com.google', visible: true }
    ];
    expect(defaultGoogleCalendar(list)?.id).toBe(3);
    expect(defaultGoogleCalendar(list.slice(0, 1))).toBeUndefined();
  });
});
