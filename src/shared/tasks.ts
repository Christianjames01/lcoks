// Tasks: to-dos with optional due date/time, priority, category, one reminder and
// a simple repeat. Pure logic shared by the vault core (validation), the renderer
// and the notification scheduler. Dates are local day keys + HH:MM like the calendar.
import { addDays, atLocal, formatDay, formatTime, hashId, occurrenceStarts } from './calendar';
import { dayKey } from './money';

import { tr } from './i18n';
export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskRepeat = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type TaskReminder = { type: 'before'; minutes: number } | { type: 'at'; at: string };

export interface TaskCategory {
  id: string;
  name: string;
}

export const TASK_CATEGORIES: TaskCategory[] = [
  { id: 'personal', name: 'Personal' },
  { id: 'work', name: 'Work' },
  { id: 'school', name: 'School' },
  { id: 'finance', name: 'Finance' },
  { id: 'health', name: 'Health' },
  { id: 'other', name: 'Other' }
];
export const TASK_CATEGORY_IDS = new Set(TASK_CATEGORIES.map((c) => c.id));
export const MAX_TASK_CATEGORIES = 20;

export const PRIORITIES: { id: TaskPriority; name: string; rank: number }[] = [
  { id: 'high', name: 'High', rank: 0 },
  { id: 'medium', name: 'Medium', rank: 1 },
  { id: 'low', name: 'Low', rank: 2 }
];

export const TASK_REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: tr("At the due time") },
  { minutes: 5, label: tr("5 minutes before") },
  { minutes: 15, label: tr("15 minutes before") },
  { minutes: 30, label: tr("30 minutes before") },
  { minutes: 60, label: tr("1 hour before") },
  { minutes: 1440, label: tr("1 day before") }
];

export interface TaskCompletion {
  /** The due day that was completed. */
  due: string;
  /** ISO time it was completed. */
  at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  notes: string;
  /** Due day (YYYY-MM-DD) or '' for no due date. */
  due: string;
  /** HH:MM or '' (only with a due day). */
  dueTime: string;
  priority: TaskPriority;
  /** Built-in id or a custom category id; unknown ids show as Other. */
  category: string;
  reminder: TaskReminder | null;
  /** Repeating tasks move to the next due date when completed. */
  repeat: TaskRepeat | null;
  completed: boolean;
  completedAt: string | null;
  /** Completed occurrences of a repeating task (most recent last). */
  history: TaskCompletion[];
  /** Reminder keys already shown — never shown twice. */
  acks: string[];
  createdAt: string;
  updatedAt: string;
}

export type TaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

/** Date-only tasks: reminders count from 09:00 on the day. */
export const TASK_DAY_TIME = '09:00';

export function categoryName(id: string, custom: TaskCategory[]): string {
  return TASK_CATEGORIES.find((c) => c.id === id)?.name ?? custom.find((c) => c.id === id)?.name ?? 'Other';
}

export const priorityName = (p: TaskPriority) => PRIORITIES.find((x) => x.id === p)!.name;

export function emptyTask(due = ''): TaskInput {
  return {
    title: '',
    description: '',
    notes: '',
    due,
    dueTime: '',
    priority: 'medium',
    category: 'personal',
    reminder: null,
    repeat: null,
    completed: false,
    completedAt: null,
    history: [],
    acks: []
  };
}

/** When the task is due (end of the day for date-only tasks), or null. */
export function dueDeadline(t: Pick<Task, 'due' | 'dueTime'>): Date | null {
  if (!t.due) return null;
  return t.dueTime ? atLocal(t.due, t.dueTime) : atLocal(addDays(t.due, 1), '00:00');
}

/** Not done and past its deadline. Tasks without a due date are never overdue. */
export function isTaskOverdue(t: Task, now: Date): boolean {
  const d = dueDeadline(t);
  return !t.completed && !!d && d.getTime() <= now.getTime();
}

export type TaskGroup = 'all' | 'today' | 'upcoming' | 'overdue' | 'completed' | 'reminders';

export function inGroup(t: Task, g: TaskGroup, now: Date): boolean {
  const today = dayKey(now);
  switch (g) {
    case 'today':
      return !t.completed && t.due === today;
    case 'upcoming':
      return !t.completed && !!t.due && t.due > today;
    case 'overdue':
      return isTaskOverdue(t, now);
    case 'completed':
      return t.completed;
    case 'reminders':
      return !t.completed && !!t.reminder && !!t.due;
    default:
      return true;
  }
}

export function taskCounts(tasks: Task[], now: Date): Record<'today' | 'upcoming' | 'overdue' | 'completed', number> {
  const c = { today: 0, upcoming: 0, overdue: 0, completed: 0 };
  for (const t of tasks) for (const g of ['today', 'upcoming', 'overdue', 'completed'] as const) if (inGroup(t, g, now)) c[g]++;
  return c;
}

export type TaskSort = 'due' | 'priority' | 'created' | 'updated' | 'title';

export function sortTasks(list: Task[], sort: TaskSort): Task[] {
  const rank = (p: TaskPriority) => PRIORITIES.find((x) => x.id === p)!.rank;
  const dueKey = (t: Task) => (t.due ? `${t.due}T${t.dueTime || '99:99'}` : '9999');
  const cmp: Record<TaskSort, (a: Task, b: Task) => number> = {
    due: (a, b) => dueKey(a).localeCompare(dueKey(b)) || rank(a.priority) - rank(b.priority),
    priority: (a, b) => rank(a.priority) - rank(b.priority) || dueKey(a).localeCompare(dueKey(b)),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  };
  return [...list].sort((a, b) => cmp[sort](a, b) || a.title.localeCompare(b.title));
}

export function matchesTask(t: Task, q: string, custom: TaskCategory[]): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [t.title, t.description, t.notes, categoryName(t.category, custom), priorityName(t.priority)].join(' ').toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w));
}

/** The next due day of a repeating task (monthly on the 31st skips short months, like the calendar). */
export function nextDue(due: string, repeat: TaskRepeat): string {
  const next = occurrenceStarts({ start: due, repeat: { freq: repeat, interval: 1 }, exdates: [] }, addDays(due, 1), addDays(due, 1500)); // 4+ years: Feb 29 yearly
  return next[0] ?? addDays(due, 1);
}

const strip = (t: Task): TaskInput => {
  const { createdAt: _c, updatedAt: _u, ...rest } = t;
  return { ...rest, reminder: rest.reminder ? { ...rest.reminder } : null, history: rest.history.map((h) => ({ ...h })), acks: [...rest.acks] };
};

/**
 * Complete a task. A repeating task with a due date records this occurrence and
 * moves to the next due date (one stored task — no copies, so nothing duplicates).
 */
export function completeTask(t: Task, nowIso: string): TaskInput {
  const base = strip(t);
  if (t.repeat && t.due) {
    return { ...base, due: nextDue(t.due, t.repeat), history: [...base.history, { due: t.due, at: nowIso }].slice(-100), completed: false, completedAt: null };
  }
  return { ...base, completed: true, completedAt: nowIso };
}

/** Undo: a done task becomes open again; a repeating task goes back to the occurrence it last completed. */
export function uncompleteTask(t: Task): TaskInput {
  const base = strip(t);
  if (t.completed) return { ...base, completed: false, completedAt: null };
  const last = base.history[base.history.length - 1];
  if (t.repeat && last) return { ...base, due: last.due, history: base.history.slice(0, -1) };
  return base;
}

export const taskReminderKey = (t: Pick<Task, 'id' | 'due' | 'dueTime'>) => `${t.id}|${t.due}T${t.dueTime || 'day'}`;

/** When the reminder rings, or null (no reminder, no due date for a relative one). */
export function taskReminderAt(t: Task): number | null {
  if (!t.reminder || t.completed) return null;
  if (t.reminder.type === 'at') return atLocal(t.reminder.at.slice(0, 10), t.reminder.at.slice(11)).getTime();
  if (!t.due) return null;
  return atLocal(t.due, t.dueTime || TASK_DAY_TIME).getTime() - t.reminder.minutes * 60_000;
}

export function describeTaskReminder(r: TaskReminder | null): string {
  if (!r) return 'No reminder';
  if (r.type === 'before') return TASK_REMINDER_PRESETS.find((p) => p.minutes === r.minutes)?.label ?? `${r.minutes} minutes before`;
  return `${formatDay(r.at.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' })} at ${formatTime(r.at.slice(11))}`;
}

export function describeDue(t: Pick<Task, 'due' | 'dueTime'>, now: Date): string {
  if (!t.due) return 'No due date';
  const today = dayKey(now);
  const day = t.due === today ? 'Today' : t.due === addDays(today, 1) ? 'Tomorrow' : t.due === addDays(today, -1) ? 'Yesterday' : formatDay(t.due, { weekday: 'short', month: 'short', day: 'numeric', year: t.due.slice(0, 4) !== today.slice(0, 4) ? 'numeric' : undefined });
  return t.dueTime ? `${day}, ${formatTime(t.dueTime)}` : day;
}

export const REPEAT_NAMES: Record<TaskRepeat, string> = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

export interface DueTaskReminder {
  key: string;
  task: Task;
  at: number;
}

/** Task reminders ringing in (from, to], not yet shown. */
export function taskRemindersBetween(tasks: Task[], from: number, to: number): DueTaskReminder[] {
  const out: DueTaskReminder[] = [];
  for (const t of tasks) {
    const at = taskReminderAt(t);
    if (at === null || at <= from || at > to) continue;
    const key = taskReminderKey(t);
    if (t.acks.includes(key)) continue;
    out.push({ key, task: t, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Notifications for the phone / desktop scheduler. Titles only with previews on. */
export function taskNotifications(
  tasks: Task[],
  now: number,
  opts: { preview: boolean; sound: boolean; max?: number }
): { id: number; at: number; title: string; body: string; kind: 'calendar'; silent: boolean }[] {
  return taskRemindersBetween(tasks, now, now + 60 * 86_400_000)
    .slice(0, opts.max ?? 40)
    .map((d) => {
      const due = describeDue(d.task, new Date(d.at));
      return {
        id: hashId(`task|${d.key}`),
        at: d.at,
        title: opts.preview ? d.task.title : tr("VaultLocks task reminder"),
        body: opts.preview ? tr("Due {0}", [due.charAt(0).toLowerCase() + due.slice(1)]) : tr("You have a task due. Open VaultLocks to see it."),
        kind: 'calendar' as const,
        silent: !opts.sound
      };
    });
}

/** Dismiss a reminder for good. */
export function acknowledgeTask(t: Task, key: string): TaskInput {
  const base = strip(t);
  return { ...base, acks: [...new Set([...base.acks, key])].slice(-200) };
}
