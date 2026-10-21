import {
  AlarmClock,
  Bell,
  CalendarClock,
  Circle,
  CircleAlert,
  CircleCheck,
  Flag,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Plus,
  Repeat,
  Search,
  Square,
  SquareCheck,
  Tag,
  Trash2,
  Undo2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addDays, formatDay, formatTime } from '../../shared/calendar';
import { dayKey } from '../../shared/money';
import {
  PRIORITIES,
  REPEAT_NAMES,
  TASK_CATEGORIES,
  TASK_REMINDER_PRESETS,
  acknowledgeTask,
  categoryName,
  completeTask,
  describeDue,
  describeTaskReminder,
  emptyTask,
  inGroup,
  isTaskOverdue,
  matchesTask,
  priorityName,
  sortTasks,
  taskCounts,
  taskRemindersBetween,
  uncompleteTask,
  type DueTaskReminder,
  type Task,
  type TaskCategory,
  type TaskGroup,
  type TaskInput,
  type TaskPriority,
  type TaskRepeat,
  type TaskSort
} from '../../shared/tasks';
import type { NotificationPermission } from '../../shared/api';
import type { VaultSnapshot } from '../../shared/types';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { ActionSheet } from '../components/HoldActions';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';

/** "Open this task" / "new task" request from outside (calendar, reminder, + button). */
export interface TaskFocus {
  id: number;
  taskId?: string;
  add?: boolean;
  due?: string;
}

const PREFS_KEY = 'vaultlocks.taskPrefs';

function loadPrefs(): { sort: TaskSort } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { sort?: TaskSort };
    return { sort: p.sort && ['due', 'priority', 'created', 'updated', 'title'].includes(p.sort) ? p.sort : 'due' };
  } catch {
    return { sort: 'due' };
  }
}

function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Save tasks; the caller decides what to say on success. */
async function saveTasks(save: TaskInput[], remove: string[] = []): Promise<Task[]> {
  return unwrap(api.vault.saveTasks(save, remove));
}

export function TasksView({
  snap,
  mobile,
  onChanged,
  focus,
  onFocusHandled
}: {
  snap: VaultSnapshot;
  mobile: boolean;
  onChanged: () => Promise<void>;
  focus: TaskFocus | null;
  onFocusHandled: () => void;
}) {
  const toast = useToast();
  const now = useNow();
  const custom = snap.settings.taskCategories;
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<TaskGroup>('all');
  const [priority, setPriority] = useState<TaskPriority | 'all'>('all');
  const [category, setCategory] = useState<string>('all');
  const [sort, setSortState] = useState<TaskSort>(() => loadPrefs().sort);
  const [editor, setEditor] = useState<{ task?: Task; input: TaskInput } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const pending = useRef(new Set<string>());

  useEffect(() => {
    void api.notifications.status().then(setPermission);
  }, []);

  const setSort = (s: TaskSort) => {
    setSortState(s);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: s }));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!focus) return;
    if (focus.taskId) setDetailId(focus.taskId);
    if (focus.add) setEditor({ input: emptyTask(focus.due ?? '') });
    onFocusHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const tasks = snap.tasks;
  const counts = useMemo(() => taskCounts(tasks, now), [tasks, now]);
  const reminderCount = useMemo(() => tasks.filter((t) => inGroup(t, 'reminders', now)).length, [tasks, now]);
  const visible = useMemo(
    () =>
      sortTasks(
        tasks.filter(
          (t) =>
            inGroup(t, group, now) &&
            (group === 'completed' || group === 'all' || !t.completed) &&
            (priority === 'all' || t.priority === priority) &&
            (category === 'all' || (TASK_CATEGORIES.some((c) => c.id === t.category) || custom.some((c) => c.id === t.category) ? t.category : 'other') === category) &&
            matchesTask(t, query, custom)
        ),
        sort
      ),
    [tasks, group, priority, category, query, sort, now, custom]
  );
  // "All": open tasks first, completed ones after.
  const ordered = group === 'all' ? [...visible.filter((t) => !t.completed), ...visible.filter((t) => t.completed)] : visible;
  const detail = detailId ? tasks.find((t) => t.id === detailId) : undefined;

  const toggle = async (t: Task) => {
    if (pending.current.has(t.id)) return; // no double taps
    pending.current.add(t.id);
    try {
      const done = !t.completed;
      const input = done ? completeTask(t, new Date().toISOString()) : uncompleteTask(t);
      await saveTasks([input]);
      await onChanged();
      if (done && t.repeat && t.due) toast(`Done. Next one: ${describeDue({ due: input.due, dueTime: input.dueTime }, new Date())}.`);
      else toast(done ? 'Task completed.' : 'Task marked as not done.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      pending.current.delete(t.id);
    }
  };

  const undoRepeat = async (t: Task) => {
    try {
      await saveTasks([uncompleteTask(t)]);
      await onChanged();
      toast('Last completion undone.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const filtered = query.trim() !== '' || group !== 'all' || priority !== 'all' || category !== 'all';
  const today = dayKey(now);
  // "All", sorted by date and not searching: grouped like the iPhone Reminders app.
  const sections = useMemo(() => {
    if (group !== 'all' || sort !== 'due' || query.trim()) return null;
    const tomorrow = addDays(today, 1);
    const defs: [string, string][] = [
      ['overdue', 'Overdue'],
      ['today', 'Today'],
      ['tomorrow', 'Tomorrow'],
      ['later', 'Later'],
      ['nodate', 'No due date'],
      ['completed', 'Completed']
    ];
    const bucket = (t: Task) =>
      t.completed ? 'completed' : isTaskOverdue(t, now) ? 'overdue' : t.due === today ? 'today' : t.due === tomorrow ? 'tomorrow' : t.due ? 'later' : 'nodate';
    return defs.map(([id, title]) => ({ id, title, items: ordered.filter((t) => bucket(t) === id) })).filter((x) => x.items.length);
  }, [group, sort, query, ordered, today, now]);
  // Today's progress: tasks due today, and repeating ones already completed for today.
  const progress = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const t of tasks) {
      if (t.due === today) {
        total++;
        if (t.completed) done++;
      }
      if (t.repeat && t.history.some((h) => h.due === today)) {
        total++;
        done++;
      }
    }
    return { total, done };
  }, [tasks, today]);
  const needsPermission = permission === 'prompt' && tasks.some((t) => !t.completed && t.reminder);

  return (
    <div className="page tasks-page">
      <div className="page-narrow">
        <header className="tk-hero">
          <div className="grow">
            {!mobile && <h1 className="h1">Tasks</h1>}
            <div className="tk-date">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            <p className="tk-sub">
              {progress.total === 0
                ? 'Plan your day, one task at a time.'
                : progress.done === progress.total
                  ? `All ${progress.total} done for today. Nice work.`
                  : `${progress.done} of ${progress.total} done today`}
            </p>
          </div>
          <ProgressRing done={progress.done} total={progress.total} />
        </header>

        <div className="tk-actions">
          <div className="evc-search-box tk-search" role="search">
            <Search size={16} aria-hidden />
            <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks…" aria-label="Search tasks" autoComplete="off" maxLength={120} />
            {query && (
              <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            className={`tk-bell ${group === 'reminders' ? 'on' : ''}`}
            onClick={() => setGroup(group === 'reminders' ? 'all' : 'reminders')}
            aria-pressed={group === 'reminders'}
            aria-label={`${reminderCount} task${reminderCount === 1 ? '' : 's'} with reminders. Show them`}
            title="Tasks with reminders"
          >
            <Bell size={18} aria-hidden />
            {reminderCount > 0 && <span className="tk-bell-count">{reminderCount}</span>}
          </button>
          <button type="button" className="btn primary tk-new" onClick={() => setEditor({ input: emptyTask() })} aria-label="New Task">
            <Plus size={16} aria-hidden /> <span className="tk-new-text">New Task</span>
          </button>
        </div>

        <div className="tk-summary" role="group" aria-label="Task summary">
          {(
            [
              ['today', 'Today', counts.today, <CalendarClock key="i" size={17} aria-hidden />],
              ['upcoming', 'Upcoming', counts.upcoming, <ListTodo key="i" size={17} aria-hidden />],
              ['overdue', 'Overdue', counts.overdue, <CircleAlert key="i" size={17} aria-hidden />],
              ['completed', 'Completed', counts.completed, <CircleCheck key="i" size={17} aria-hidden />]
            ] as [TaskGroup, string, number, ReactNode][]
          ).map(([g, label, n, icon]) => (
            <button key={g} type="button" className={`tk-stat ${g}`} aria-pressed={group === g} onClick={() => setGroup(group === g ? 'all' : g)} aria-label={`${label}: ${n}. Show these tasks`}>
              <span className="tk-stat-top">
                <span className="tk-stat-icon" aria-hidden>
                  {icon}
                </span>
                <span className="tk-stat-n">{n}</span>
              </span>
              <span className="tk-stat-label">{label}</span>
            </button>
          ))}
        </div>

        <div className="evc-filters" role="group" aria-label="Filter tasks">
          {(
            [
              ['all', 'All Tasks'],
              ['today', 'Today'],
              ['upcoming', 'Upcoming'],
              ['overdue', 'Overdue'],
              ['completed', 'Completed']
            ] as [TaskGroup, string][]
          ).map(([g, label]) => (
            <button key={g} type="button" className="evc-chip" aria-pressed={group === g} onClick={() => setGroup(g)}>
              {label}
            </button>
          ))}
        </div>

        <div className="tk-tools">
          <label className="tk-select">
            <span className="sr-only">Sort by</span>
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value as TaskSort)} aria-label="Sort tasks">
              <option value="due">Sort: Due date</option>
              <option value="priority">Sort: Priority</option>
              <option value="created">Sort: Recently created</option>
              <option value="updated">Sort: Recently updated</option>
              <option value="title">Sort: A–Z</option>
            </select>
          </label>
          <label className="tk-select">
            <span className="sr-only">Priority</span>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority | 'all')} aria-label="Filter by priority">
              <option value="all">All priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} priority
                </option>
              ))}
            </select>
          </label>
          <label className="tk-select">
            <span className="sr-only">Category</span>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
              <option value="all">All categories</option>
              {[...TASK_CATEGORIES, ...custom].map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {needsPermission && (
          <div className="tk-banner" role="note">
            <Bell size={16} aria-hidden />
            <span className="grow">Allow notifications so task reminders can ring even when VaultLocks is closed.</span>
            <button type="button" className="btn sm primary" onClick={async () => setPermission(await api.notifications.request())}>
              Allow
            </button>
          </div>
        )}
        {permission === 'denied' && tasks.some((t) => !t.completed && t.reminder) && (
          <div className="tk-banner muted" role="note">
            <Bell size={16} aria-hidden />
            <span className="grow">Notifications are blocked, so reminders only pop up while VaultLocks is open. You can allow them in the system settings.</span>
          </div>
        )}

        <section className={`tk-panel ${ordered.length ? "" : "card"}`} aria-label="Tasks">
          {ordered.length === 0 ? (
            <div className="tk-empty">
              <ListTodo size={28} aria-hidden />
              {tasks.length === 0 ? (
                <>
                  <p>No tasks yet. Create your first task to get organized.</p>
                  <button type="button" className="btn primary" onClick={() => setEditor({ input: emptyTask() })}>
                    <Plus size={16} aria-hidden /> New Task
                  </button>
                </>
              ) : (
                <>
                  <p>{query.trim() ? `No tasks match “${query.trim()}”.` : group === 'completed' ? 'No completed tasks yet.' : group === 'overdue' ? 'Nothing overdue. Nice work.' : 'No tasks here.'}</p>
                  {filtered && (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        setQuery('');
                        setGroup('all');
                        setPriority('all');
                        setCategory('all');
                      }}
                    >
                      Show all tasks
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            (sections ?? [{ id: 'all', title: '', items: ordered }]).map((sec) => (
              <div key={sec.id} className={`tk-section ${sec.id}`}>
                {sec.title && (
                  <h2 className="tk-section-title">
                    {sec.title} <span className="tk-section-n">{sec.items.length}</span>
                  </h2>
                )}
                <ul className="tk-list">
                  {sec.items.map((t) => (
                    <TaskRow key={t.id} task={t} now={now} custom={custom} onToggle={() => void toggle(t)} onOpen={() => setDetailId(t.id)} onMore={() => setMenuFor(t)} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      </div>

      {menuFor && (
        <ActionSheet
          title={menuFor.title}
          onClose={() => setMenuFor(null)}
          items={[
            { key: 'edit', label: 'Edit', icon: <Pencil size={16} />, run: () => setEditor({ task: menuFor, input: { ...menuFor } }) },
            {
              key: 'done',
              label: menuFor.completed ? 'Mark as not done' : 'Mark complete',
              icon: menuFor.completed ? <Square size={16} /> : <SquareCheck size={16} />,
              run: () => void toggle(menuFor)
            },
            { key: 'delete', label: 'Delete', icon: <Trash2 size={16} />, danger: true, run: () => setDeleting(menuFor) }
          ]}
        />
      )}

      {detail && (
        <TaskDetail
          task={detail}
          now={now}
          custom={custom}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            setEditor({ task: detail, input: { ...detail } });
          }}
          onToggle={() => void toggle(detail)}
          onUndo={() => void undoRepeat(detail)}
          onDelete={() => {
            setDetailId(null);
            setDeleting(detail);
          }}
        />
      )}

      {editor && (
        <TaskEditor
          initial={editor.input}
          isNew={!editor.task}
          custom={custom}
          onManageCategories={() => setCategoriesOpen(true)}
          onClose={() => setEditor(null)}
          onSave={async (input) => {
            // Editing keeps the stored completion state and history (the form doesn't change them).
            const base = editor.task;
            const [saved] = await saveTasks([base ? { ...input, id: base.id, completed: base.completed, completedAt: base.completedAt, history: base.history, acks: base.acks } : input]);
            await onChanged();
            setEditor(null);
            toast(base ? 'Task updated.' : 'Task saved.');
            return saved;
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          placement="center"
          title="Delete this task?"
          danger
          confirmLabel="Delete Task"
          message={
            <>
              <div className="tk-del-title">{deleting.title}</div>
              It will be deleted for good, with its reminder.
            </>
          }
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await saveTasks([], [deleting.id]);
              await onChanged();
              setDeleting(null);
              toast('Task deleted.');
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}

      {categoriesOpen && <CategoryManager snap={snap} onClose={() => setCategoriesOpen(false)} onChanged={onChanged} />}
    </div>
  );
}

/** Today's progress as a small ring (empty ring when nothing is due today). */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <div className="tk-ring" role="img" aria-label={total ? `${done} of ${total} tasks done today` : 'Nothing due today'}>
      <svg viewBox="0 0 56 56" width="56" height="56" aria-hidden>
        <circle cx="28" cy="28" r={r} className="tk-ring-track" />
        {pct > 0 && <circle cx="28" cy="28" r={r} className="tk-ring-fill" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 28 28)" />}
      </svg>
      <span className="tk-ring-text">{total ? `${Math.round(pct * 100)}%` : '—'}</span>
    </div>
  );
}

// ------------------------------------------------------------------- row --

function PriorityBadge({ p }: { p: TaskPriority }) {
  return (
    <span className={`tk-prio ${p}`} aria-label={`${priorityName(p)} priority`}>
      <Flag size={11} aria-hidden fill={p === 'high' ? 'currentColor' : 'none'} />
      {priorityName(p)}
    </span>
  );
}

function TaskRow({ task: t, now, custom, onToggle, onOpen, onMore }: { task: Task; now: Date; custom: TaskCategory[]; onToggle: () => void; onOpen: () => void; onMore: () => void }) {
  const overdue = isTaskOverdue(t, now);
  return (
    <li className={`tk-row ${t.completed ? 'done' : ''}`}>
      <button type="button" className="tk-check" role="checkbox" aria-checked={t.completed} aria-label={t.completed ? `Mark “${t.title}” as not done` : `Complete “${t.title}”`} onClick={onToggle}>
        {t.completed ? <CircleCheck size={24} aria-hidden /> : <Circle size={24} aria-hidden />}
      </button>
      <button type="button" className="tk-main" onClick={onOpen}>
        <span className="tk-title">{t.title}</span>
        {t.description && <span className="tk-desc">{t.description}</span>}
        <span className="tk-meta">
          {t.due && (
            <span className={overdue ? 'tk-overdue' : ''}>
              <CalendarClock size={12} aria-hidden /> {overdue ? 'Overdue · ' : ''}
              {describeDue(t, now)}
            </span>
          )}
          <PriorityBadge p={t.priority} />
          <span>
            <Tag size={12} aria-hidden /> {categoryName(t.category, custom)}
          </span>
          {t.reminder && !t.completed && (
            <span title={describeTaskReminder(t.reminder)} aria-label={`Reminder: ${describeTaskReminder(t.reminder)}`}>
              <Bell size={12} aria-hidden />
            </span>
          )}
          {t.repeat && (
            <span aria-label={REPEAT_NAMES[t.repeat]} title={REPEAT_NAMES[t.repeat]}>
              <Repeat size={12} aria-hidden /> {REPEAT_NAMES[t.repeat].replace('Every ', '')}
            </span>
          )}
        </span>
      </button>
      <button type="button" className="icon-btn tk-more" onClick={onMore} aria-label={`More actions for “${t.title}”`} aria-haspopup="menu">
        <MoreHorizontal size={18} />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------- detail --

function TaskDetail({
  task: t,
  now,
  custom,
  onClose,
  onEdit,
  onToggle,
  onUndo,
  onDelete
}: {
  task: Task;
  now: Date;
  custom: TaskCategory[];
  onClose: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onUndo: () => void;
  onDelete: () => void;
}) {
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const overdue = isTaskOverdue(t, now);
  const last = t.history[t.history.length - 1];
  return (
    <Dialog
      placement="center"
      size="narrow"
      title={<span className={t.completed ? 'tk-done-title' : ''}>{t.title}</span>}
      subtitle={t.completed ? 'Completed' : overdue ? 'Overdue' : t.due ? 'Open' : 'Open · no due date'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onDelete}>
            <Trash2 size={15} aria-hidden /> Delete
          </button>
          <button type="button" className="btn" onClick={onEdit}>
            <Pencil size={15} aria-hidden /> Edit
          </button>
          <button type="button" className="btn primary" onClick={onToggle} data-autofocus>
            {t.completed ? <Square size={15} aria-hidden /> : <SquareCheck size={15} aria-hidden />} {t.completed ? 'Mark not done' : 'Mark Complete'}
          </button>
        </>
      }
    >
      <dl className="tk-dl">
        {t.description && (
          <>
            <dt>Description</dt>
            <dd className="tk-pre">{t.description}</dd>
          </>
        )}
        <dt>Due</dt>
        <dd className={overdue ? 'tk-overdue' : ''}>{describeDue(t, now)}</dd>
        <dt>Priority</dt>
        <dd>
          <PriorityBadge p={t.priority} />
        </dd>
        <dt>Category</dt>
        <dd>{categoryName(t.category, custom)}</dd>
        <dt>Reminder</dt>
        <dd>{describeTaskReminder(t.reminder)}</dd>
        <dt>Repeat</dt>
        <dd>
          {t.repeat ? REPEAT_NAMES[t.repeat] : 'Does not repeat'}
          {t.repeat && t.history.length > 0 && (
            <div className="muted small">
              Done {t.history.length} time{t.history.length === 1 ? '' : 's'} · last on {formatDay(last!.due, { month: 'short', day: 'numeric' })}{' '}
              <button type="button" className="linkish" onClick={onUndo}>
                <Undo2 size={12} aria-hidden /> Undo
              </button>
            </div>
          )}
        </dd>
        {t.notes && (
          <>
            <dt>Notes</dt>
            <dd className="tk-pre">{t.notes}</dd>
          </>
        )}
        <dt>Created</dt>
        <dd>{when(t.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{when(t.updatedAt)}</dd>
        {t.completed && t.completedAt && (
          <>
            <dt>Completed</dt>
            <dd>{when(t.completedAt)}</dd>
          </>
        )}
      </dl>
    </Dialog>
  );
}

// ---------------------------------------------------------------- editor --

type ReminderChoice = 'none' | `b${number}` | 'custom';

function TaskEditor({
  initial,
  isNew,
  custom,
  onClose,
  onSave,
  onManageCategories
}: {
  initial: TaskInput;
  isNew: boolean;
  custom: TaskCategory[];
  onClose: () => void;
  onSave: (input: TaskInput) => Promise<Task | undefined>;
  onManageCategories: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [notes, setNotes] = useState(initial.notes);
  const [due, setDue] = useState(initial.due);
  const [dueTime, setDueTime] = useState(initial.dueTime);
  const [priority, setPriority] = useState<TaskPriority>(initial.priority);
  const [category, setCategory] = useState(initial.category);
  const [reminder, setReminder] = useState<ReminderChoice>(initial.reminder ? (initial.reminder.type === 'at' ? 'custom' : `b${initial.reminder.minutes}`) : 'none');
  const [customAt, setCustomAt] = useState(initial.reminder?.type === 'at' ? initial.reminder.at : `${initial.due || dayKey(new Date())}T08:00`);
  const [repeat, setRepeat] = useState<TaskRepeat | 'none'>(initial.repeat ?? 'none');
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);

  const build = (): TaskInput => ({
    ...initial,
    title: title.trim(),
    description,
    notes,
    due,
    dueTime: due ? dueTime : '',
    priority,
    category,
    reminder: reminder === 'none' ? null : reminder === 'custom' ? { type: 'at', at: customAt.slice(0, 16) } : { type: 'before', minutes: Number(reminder.slice(1)) },
    repeat: repeat === 'none' ? null : repeat
  });
  const dirty = JSON.stringify(build()) !== JSON.stringify({ ...initial, title: initial.title.trim() });
  // Escape / backdrop / ✕ never throw away typed changes without asking.
  const attemptClose = () => (dirty && !busy ? setDiscard(true) : onClose());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError({ field: 'title', message: 'Give the task a title.' });
    if (dueTime && !due) return setError({ field: 'due', message: 'Pick a due date for this time.' });
    if (reminder !== 'none' && reminder !== 'custom' && !due) return setError({ field: 'reminder', message: 'This reminder counts from the due date — set one, or choose a custom date and time.' });
    if (reminder === 'custom' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(customAt)) return setError({ field: 'reminder', message: 'Choose the reminder date and time.' });
    if (repeat !== 'none' && !due) return setError({ field: 'repeat', message: 'A repeating task needs a due date.' });
    setError(null);
    setBusy(true);
    try {
      await onSave(build());
    } catch (err) {
      const msg = errorMessage(err);
      setError({ field: 'form', message: msg });
      toast(msg, 'error');
      setBusy(false);
    }
  };

  const errFor = (f: string) =>
    error?.field === f ? (
      <div className="error-text" role="alert">
        {error.message}
      </div>
    ) : null;

  return (
    <>
      <Dialog
        placement="center"
        title={isNew ? 'New Task' : 'Edit Task'}
        onClose={attemptClose}
        busy={busy}
        footer={
          <>
            <button type="button" className="btn" onClick={attemptClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="task-form" className="btn primary" disabled={busy}>
              {busy && <span className="spinner" aria-hidden />}
              Save Task
            </button>
          </>
        }
      >
        <form id="task-form" className="evc-form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="tk-title">Task title</label>
            <input
              id="tk-title"
              className="input"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error?.field === 'title') setError(null);
              }}
              placeholder="e.g. Pay tuition fee"
              maxLength={200}
              autoComplete="off"
              aria-invalid={error?.field === 'title'}
              aria-required
            />
            {errFor('title')}
          </div>
          <div className="field">
            <label htmlFor="tk-desc">Description (optional)</label>
            <textarea id="tk-desc" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
          </div>
          <div className="evc-when">
            <div className="field">
              <label htmlFor="tk-due">Due date (optional)</label>
              <div className="tk-date-row">
                <input id="tk-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-invalid={error?.field === 'due'} />
                {due && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Clear due date"
                    onClick={() => {
                      setDue('');
                      setDueTime('');
                      if (repeat !== 'none') setRepeat('none');
                    }}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              {errFor('due')}
            </div>
            <div className="field">
              <label htmlFor="tk-time">Due time (optional)</label>
              <input id="tk-time" className="input" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!due} />
              {!due && <div className="help-text">Set a date first.</div>}
            </div>
          </div>
          <div className="field">
            <span className="label">Priority</span>
            <div className="segmented tk-prio-pick" role="radiogroup" aria-label="Priority">
              {(['low', 'medium', 'high'] as TaskPriority[]).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={priority === p} aria-pressed={priority === p} onClick={() => setPriority(p)}>
                  <Flag size={13} aria-hidden fill={p === 'high' ? 'currentColor' : 'none'} /> {priorityName(p)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Category</span>
            <div className="cat-picker" role="radiogroup" aria-label="Category">
              {[...TASK_CATEGORIES, ...custom].map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={category === c.id} className="cat-chip" onClick={() => setCategory(c.id)}>
                  {c.name}
                </button>
              ))}
              <button type="button" className="cat-chip tk-manage" onClick={onManageCategories}>
                <Pencil size={13} aria-hidden /> Edit categories
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="tk-rem">Reminder</label>
            <select id="tk-rem" className="input" value={reminder} onChange={(e) => setReminder(e.target.value as ReminderChoice)} aria-invalid={error?.field === 'reminder'}>
              <option value="none">None</option>
              {TASK_REMINDER_PRESETS.map((p) => (
                <option key={p.minutes} value={`b${p.minutes}`}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom date and time…</option>
            </select>
            {reminder === 'custom' && (
              <input className="input tk-custom-at" type="datetime-local" value={customAt} onChange={(e) => setCustomAt(e.target.value)} aria-label="Reminder date and time" />
            )}
            {reminder !== 'none' && reminder !== 'custom' && !due && <div className="help-text">Counts from the due date{dueTime ? '' : ' (9:00 AM when there is no time)'}.</div>}
            {errFor('reminder')}
          </div>
          <div className="field">
            <label htmlFor="tk-repeat">Repeat</label>
            <select id="tk-repeat" className="input" value={repeat} onChange={(e) => setRepeat(e.target.value as TaskRepeat | 'none')} disabled={!due} aria-invalid={error?.field === 'repeat'}>
              <option value="none">None</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <div className="help-text">{due ? 'When you complete it, it moves to the next date.' : 'Set a due date to repeat this task.'}</div>
            {errFor('repeat')}
          </div>
          <div className="field">
            <label htmlFor="tk-notes">Notes (optional)</label>
            <textarea id="tk-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
          </div>
          {errFor('form')}
        </form>
      </Dialog>
      {discard && (
        <ConfirmDialog
          placement="center"
          title="Discard changes?"
          confirmLabel="Discard"
          danger
          message="What you typed in this task will be lost."
          onCancel={() => setDiscard(false)}
          onConfirm={() => {
            setDiscard(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------ categories --

function CategoryManager({ snap, onClose, onChanged }: { snap: VaultSnapshot; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [list, setList] = useState<TaskCategory[]>(snap.settings.taskCategories);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<TaskCategory | null>(null);

  const persist = async (next: TaskCategory[], message: string) => {
    setBusy(true);
    try {
      await unwrap(api.vault.updateSettings({ taskCategories: next }));
      await onChanged();
      setList(next);
      toast(message);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    if ([...TASK_CATEGORIES, ...list].some((c) => c.name.toLowerCase() === n.toLowerCase())) return toast('That category already exists.', 'error');
    if (list.length >= 20) return toast('At most 20 categories.', 'error');
    await persist([...list, { id: `c${Date.now().toString(36)}`, name: n.slice(0, 30) }], 'Category added.');
    setName('');
  };

  return (
    <>
      <Dialog placement="center" size="narrow" title="Task categories" onClose={onClose} busy={busy}>
        <p className="muted small" style={{ marginTop: 0 }}>
          Built-in: {TASK_CATEGORIES.map((c) => c.name).join(', ')}. Removing your own category moves its tasks to Other — no task is deleted.
        </p>
        <ul className="tk-cats">
          {list.map((c) => (
            <CategoryRow
              key={c.id}
              cat={c}
              busy={busy}
              onRename={(n) => void persist(list.map((x) => (x.id === c.id ? { ...x, name: n } : x)), 'Category renamed.')}
              onRemove={() => setRemoving(c)}
            />
          ))}
        </ul>
        <form
          className="tk-cat-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. Church" maxLength={30} aria-label="New category name" />
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            Add
          </button>
        </form>
      </Dialog>
      {removing && (
        <ConfirmDialog
          placement="center"
          title={`Remove “${removing.name}”?`}
          confirmLabel="Remove"
          danger
          message={`${snap.tasks.filter((t) => t.category === removing.id).length} task(s) in it move to Other.`}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              // Tasks first: if anything fails, the category is still there and nothing is lost.
              const affected = snap.tasks.filter((t) => t.category === removing.id).map((t) => ({ ...t, category: 'other' }));
              for (let i = 0; i < affected.length; i += 500) await saveTasks(affected.slice(i, i + 500));
              await persist(
                list.filter((c) => c.id !== removing.id),
                'Category removed.'
              );
              setRemoving(null);
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
    </>
  );
}

function CategoryRow({ cat, busy, onRename, onRemove }: { cat: TaskCategory; busy: boolean; onRename: (name: string) => void; onRemove: () => void }) {
  const [value, setValue] = useState(cat.name);
  const changed = value.trim() !== '' && value.trim() !== cat.name;
  return (
    <li className="tk-cat">
      <input className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={30} aria-label={`Rename ${cat.name}`} />
      {changed && (
        <button type="button" className="btn sm" disabled={busy} onClick={() => onRename(value.trim())}>
          Save
        </button>
      )}
      <button type="button" className="icon-btn" disabled={busy} onClick={onRemove} aria-label={`Remove ${cat.name}`}>
        <Trash2 size={15} />
      </button>
    </li>
  );
}

// -------------------------------------------------------------- reminders --

/** In-app pop-up when a task reminder comes due while the vault is open. */
export function TaskAlerts({ snap, onChanged, onView }: { snap: VaultSnapshot; onChanged: () => Promise<void>; onView: (taskId: string) => void }) {
  const toast = useToast();
  const [queue, setQueue] = useState<DueTaskReminder[]>([]);
  const [busy, setBusy] = useState(false);
  const since = useRef(Date.now());
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const enabled = snap.settings.calendarReminders;

  useEffect(() => {
    if (!enabled) {
      setQueue([]);
      return;
    }
    const check = () => {
      const now = Date.now();
      const due = taskRemindersBetween(snapRef.current.tasks, since.current, now);
      since.current = now;
      if (due.length) setQueue((q) => [...q, ...due.filter((d) => !q.some((x) => x.key === d.key))]);
    };
    check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, [enabled]);

  const current = queue[0];
  if (!current) return null;
  const task = snap.tasks.find((t) => t.id === current.task.id);
  if (!task || task.completed) {
    queueMicrotask(() => setQueue((q) => q.slice(1)));
    return null;
  }
  const act = async (input: TaskInput | null, message?: string) => {
    setBusy(true);
    try {
      if (input) {
        await saveTasks([input]);
        await onChanged();
      }
      if (message) toast(message);
      setQueue((q) => q.slice(1));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const dismissInput = acknowledgeTask(task, current.key);
  return (
    <Dialog
      placement="center"
      size="narrow"
      role="alertdialog"
      busy={busy}
      title={
        <span className="rem-title">
          <AlarmClock size={18} aria-hidden /> {task.title}
        </span>
      }
      subtitle={queue.length > 1 ? `Task reminder 1 of ${queue.length}` : 'Task reminder'}
      onClose={() => void act(dismissInput)}
      footer={
        <div className="rem-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              void act(dismissInput);
              onView(task.id);
            }}
          >
            View task
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void act(completeTask({ ...task, acks: [...task.acks, current.key] }, new Date().toISOString()), 'Task completed.')}>
            <SquareCheck size={15} aria-hidden /> Mark complete
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void act(dismissInput)} data-autofocus style={{ gridColumn: '1 / -1' }}>
            Dismiss
          </button>
        </div>
      }
    >
      <div className="rem-body">
        <p className="rem-message">{task.due ? `Due ${describeDue(task, new Date()).replace(/^[A-Z]/, (c) => c.toLowerCase())}.` : 'This is your reminder.'}</p>
        <div className="rem-when">
          <PriorityBadge p={task.priority} />
          <span>{categoryName(task.category, snap.settings.taskCategories)}</span>
          {task.dueTime && <span>{formatTime(task.dueTime)}</span>}
        </div>
      </div>
    </Dialog>
  );
}
