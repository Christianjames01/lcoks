import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePayload, validateSettings, validateTaskInput } from '../src/core/schema';
import { VaultService } from '../src/main/vault/vaultService';
import {
  acknowledgeTask,
  completeTask,
  emptyTask,
  inGroup,
  isTaskOverdue,
  matchesTask,
  nextDue,
  sortTasks,
  taskCounts,
  taskNotifications,
  taskReminderKey,
  taskRemindersBetween,
  uncompleteTask,
  type Task
} from '../src/shared/tasks';

const NOW = new Date(2026, 9, 21, 15, 0); // Wed 21 Oct 2026, 3 PM
let seq = 0;
function task(over: Partial<Task> = {}): Task {
  return { ...emptyTask(), title: 'Task', id: `t${++seq}`, createdAt: `2026-10-0${(seq % 9) + 1}T00:00:00.000Z`, updatedAt: '2026-10-01T00:00:00.000Z', ...over };
}

describe('groups and overdue', () => {
  it('tasks without a due date are never overdue', () => {
    expect(isTaskOverdue(task(), NOW)).toBe(false);
    expect(inGroup(task(), 'today', NOW)).toBe(false);
  });
  it('date-only tasks are overdue after their day; timed ones after their time', () => {
    expect(isTaskOverdue(task({ due: '2026-10-21' }), NOW)).toBe(false);
    expect(isTaskOverdue(task({ due: '2026-10-20' }), NOW)).toBe(true);
    expect(isTaskOverdue(task({ due: '2026-10-21', dueTime: '14:00' }), NOW)).toBe(true);
    expect(isTaskOverdue(task({ due: '2026-10-21', dueTime: '16:00' }), NOW)).toBe(false);
    expect(isTaskOverdue(task({ due: '2026-10-20', completed: true, completedAt: 'x' }), NOW)).toBe(false);
  });
  it('counts come from the real list', () => {
    const list = [
      task({ due: '2026-10-21' }),
      task({ due: '2026-10-22' }),
      task({ due: '2026-10-19' }),
      task({ due: '2026-10-19', completed: true, completedAt: '2026-10-19T00:00:00.000Z' }),
      task()
    ];
    expect(taskCounts(list, NOW)).toEqual({ today: 1, upcoming: 1, overdue: 1, completed: 1 });
  });
});

describe('sorting and search', () => {
  it('sorts by due (no date last), priority, title', () => {
    const a = task({ title: 'b', due: '2026-10-25', priority: 'low' });
    const b = task({ title: 'a', due: '2026-10-22', priority: 'high' });
    const c = task({ title: 'c', priority: 'medium' });
    expect(sortTasks([a, b, c], 'due').map((t) => t.title)).toEqual(['a', 'b', 'c']);
    expect(sortTasks([a, b, c], 'priority').map((t) => t.title)).toEqual(['a', 'c', 'b']);
    expect(sortTasks([a, b, c], 'title').map((t) => t.title)).toEqual(['a', 'b', 'c']);
  });
  it('searches title, description and category', () => {
    const t = task({ title: 'Pay tuition', description: 'Cashier window 3', category: 'finance' });
    expect(matchesTask(t, 'window', [])).toBe(true);
    expect(matchesTask(t, 'finance pay', [])).toBe(true);
    expect(matchesTask(t, 'gym', [])).toBe(false);
  });
});

describe('completing', () => {
  it('a normal task is completed and can be reopened', () => {
    const t = task({ due: '2026-10-21' });
    const done = { ...t, ...completeTask(t, '2026-10-21T08:00:00.000Z') } as Task;
    expect(done.completed).toBe(true);
    expect(done.completedAt).toBe('2026-10-21T08:00:00.000Z');
    const open = uncompleteTask(done);
    expect(open.completed).toBe(false);
    expect(open.completedAt).toBeNull();
  });
  it('a repeating task moves to its next date — one stored task, no copies', () => {
    const t = task({ due: '2026-10-21', repeat: 'weekly' });
    const next = { ...t, ...completeTask(t, 'now') } as Task;
    expect(next.completed).toBe(false);
    expect(next.due).toBe('2026-10-28');
    expect(next.history).toEqual([{ due: '2026-10-21', at: 'now' }]);
    const back = uncompleteTask(next);
    expect(back.due).toBe('2026-10-21');
    expect(back.history).toEqual([]);
  });
  it('next dates follow month lengths', () => {
    expect(nextDue('2026-01-31', 'monthly')).toBe('2026-03-31');
    expect(nextDue('2026-12-31', 'daily')).toBe('2027-01-01');
    expect(nextDue('2024-02-29', 'yearly')).toBe('2028-02-29');
  });
});

describe('reminders', () => {
  it('rings once, before the due time, and not after it is dismissed or done', () => {
    const t = task({ due: '2026-10-22', dueTime: '10:00', reminder: { type: 'before', minutes: 30 } });
    const from = new Date(2026, 9, 22, 9, 0).getTime();
    const to = new Date(2026, 9, 22, 10, 0).getTime();
    const [r] = taskRemindersBetween([t], from, to);
    expect(new Date(r!.at).getHours()).toBe(9);
    expect(new Date(r!.at).getMinutes()).toBe(30);
    const acked = { ...t, ...acknowledgeTask(t, r!.key) } as Task;
    expect(taskRemindersBetween([acked], from, to)).toEqual([]);
    expect(taskRemindersBetween([{ ...t, completed: true }], from, to)).toEqual([]);
  });
  it('moving the due date gives a new reminder key (edits ring again, no duplicates)', () => {
    const t = task({ due: '2026-10-22', dueTime: '10:00' });
    expect(taskReminderKey(t)).not.toBe(taskReminderKey({ ...t, due: '2026-10-23' }));
  });
  it('notifications hide the title unless previews are on', () => {
    const t = task({ title: 'Call Dr. Reyes', due: '2026-10-22', dueTime: '10:00', reminder: { type: 'before', minutes: 0 } });
    const now = new Date(2026, 9, 21).getTime();
    expect(JSON.stringify(taskNotifications([t], now, { preview: false, sound: true }))).not.toContain('Reyes');
    expect(taskNotifications([t], now, { preview: true, sound: true })[0]!.title).toBe('Call Dr. Reyes');
  });
});

describe('validation', () => {
  it('requires a title and a due date for relative reminders and repeats', () => {
    expect(() => validateTaskInput({ ...emptyTask(), title: '  ' })).toThrow();
    expect(() => validateTaskInput({ ...emptyTask(), title: 'x', reminder: { type: 'before', minutes: 5 } })).toThrow();
    expect(() => validateTaskInput({ ...emptyTask(), title: 'x', repeat: 'daily' })).toThrow();
    expect(() => validateTaskInput({ ...emptyTask(), title: 'x', due: '2026-02-30' })).toThrow();
    const ok = validateTaskInput({ ...emptyTask('2026-10-22'), title: ' Pay ', priority: 'urgent', reminder: { type: 'at', at: '2026-10-21T08:00' } });
    expect(ok.title).toBe('Pay');
    expect(ok.priority).toBe('medium');
    expect(ok.reminder).toEqual({ type: 'at', at: '2026-10-21T08:00' });
  });
  it('custom categories: unique, not clashing with built-in ones', () => {
    const s = validateSettings({ taskCategories: [{ id: 'c1', name: 'Church' }, { id: 'c1', name: 'Dup' }, { id: 'work', name: 'Work 2' }, { id: 'c2', name: '' }] });
    expect(s.taskCategories).toEqual([{ id: 'c1', name: 'Church' }]);
  });
  it('payload keeps valid tasks and skips broken ones', () => {
    const p = validatePayload({ schema: 1, entries: [], tasks: [{ ...emptyTask(), title: 'Kept', id: 'k1' }, { title: '' }] });
    expect(p.tasks.map((t) => t.title)).toEqual(['Kept']);
    expect(validatePayload({ schema: 1, entries: [] }).tasks).toEqual([]);
  });
});

describe('vault storage', () => {
  it('creates, edits (same record), completes and deletes tasks — encrypted, kept after re-unlock', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-tasks-'));
    try {
      const file = path.join(dir, 'vault', 'vault.vault');
      const pw = 'Tasks-Test-Master-Pass-2026!';
      const v = new VaultService(file);
      await v.create(pw, null);
      const [saved] = await v.saveTasks([{ ...emptyTask('2026-10-25'), title: 'Pay tuition fee' }], []);
      expect((await fs.readFile(file, 'utf8')).includes('tuition')).toBe(false);
      await v.saveTasks([{ ...saved!, title: 'Pay tuition fee (2nd sem)' }], []);
      const [done] = await v.saveTasks([completeTask(saved!, new Date().toISOString())], []);
      expect(done!.completed).toBe(true);
      v.lock();
      await v.unlock(pw);
      const snap = await v.snapshot();
      expect(snap.tasks).toHaveLength(1);
      expect(snap.tasks[0]!.id).toBe(saved!.id);
      await expect(v.saveTasks([], ['nope'])).rejects.toThrow();
      await v.saveTasks([], [saved!.id]);
      expect((await v.snapshot()).tasks).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
