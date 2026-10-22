import {
  AlarmClock,
  Bell,
  BellOff,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  Clock,
  MapPin,
  Pencil,
  Plus,
  Repeat as RepeatIcon,
  Search,
  Settings2,
  Square,
  SquareCheck,
  Trash2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  EVENT_CATEGORIES,
  REMINDER_PRESETS,
  SNOOZE_CHOICES,
  addDays,
  applyDelete,
  applyEdit,
  atLocal,
  daysBetween,
  describeReminder,
  describeRepeat,
  eventCategory,
  formatDay,
  formatTime,
  isOverdue,
  matchesEvent,
  minToTime,
  newEventInput,
  occurrenceBounds,
  occurrencesInRange,
  reminderSignature,
  setDone,
  timeToMin,
  weekdayOf,
  type CalendarEvent,
  type CalendarEventInput,
  type EventChanges,
  type Occurrence,
  type ReminderRule,
  type Repeat,
  type RepeatFreq,
  type Scope
} from '../../shared/calendar';
import { addMonths, dayKey, monthOf, parseDay } from '../../shared/money';
import type { ExactAlarmStatus, NotificationPermission } from '../../shared/api';
import { phoneCalendarItems, phoneCalendarTarget, setPhoneCalendarTarget, type PhoneCalendarInfo, type PhoneCalendarItem } from '../../shared/phoneCalendar';
import { completeTask, describeDue, isTaskOverdue, priorityName, uncompleteTask, type Task } from '../../shared/tasks';
import type { VaultSettings, VaultSnapshot } from '../../shared/types';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';

type View = 'month' | 'week' | 'day' | 'agenda';
type Filter = 'all' | 'today' | 'upcoming' | 'completed' | 'reminders' | 'overdue';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_PX = 48;
const VIEW_KEY = 'vaultlocks.calendarView';

/** "Open this event" request (from a reminder pop-up or the dashboard). */
export interface CalendarFocus {
  id: number;
  day?: string;
  eventId?: string;
  /** Open the add form. */
  add?: boolean;
}

const startOfWeek = (day: string) => addDays(day, -weekdayOf(day));

function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function CalendarView({
  snap,
  mobile,
  onChanged,
  focus,
  onFocusHandled,
  onOpenTask
}: {
  snap: VaultSnapshot;
  mobile: boolean;
  onChanged: () => Promise<void>;
  focus: CalendarFocus | null;
  onFocusHandled: () => void;
  /** Tasks show on their due date; selecting one opens it in Tasks. */
  onOpenTask: (taskId: string) => void;
}) {
  const toast = useToast();
  const now = useNow();
  const today = dayKey(now);
  const [view, setViewState] = useState<View>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === 'week' || v === 'day' || v === 'agenda' ? v : 'month';
    } catch {
      return 'month';
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const [selected, setSelected] = useState(today);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editor, setEditor] = useState<{ series?: CalendarEvent; occDay?: string; input: CalendarEventInput } | null>(null);
  const [detail, setDetail] = useState<{ eventId: string; day: string } | null>(null);
  const [ask, setAsk] = useState<{ kind: 'edit' | 'delete'; run: (scope: Scope) => Promise<void> } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ occ: Occurrence } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const events = snap.events;
  // One entry per task at its current due date (a repeating task has one stored due date — no copies).
  const tasksByDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of snap.tasks) if (t.due) m.set(t.due, [...(m.get(t.due) ?? []), t]);
    return m;
  }, [snap.tasks]);
  const toggleTask = async (t: Task) => {
    try {
      await unwrap(api.vault.saveTasks([t.completed ? uncompleteTask(t) : completeTask(t, new Date().toISOString())], []));
      await onChanged();
      toast(t.completed ? 'Task marked as not done.' : 'Task completed.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  // Requests from outside: open an event, or the add form.
  useEffect(() => {
    if (!focus) return;
    if (focus.day) setSelected(focus.day);
    if (focus.eventId && focus.day) setDetail({ eventId: focus.eventId, day: focus.day });
    if (focus.add) openNew(focus.day ?? selected);
    onFocusHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const openNew = (day: string, hour?: number) =>
    // Default: the next whole hour that leaves room for a "30 minutes before" reminder.
    setEditor({ input: newEventInput(day, { hour: hour ?? Math.min(22, new Date().getHours() + (new Date().getMinutes() >= 30 ? 2 : 1)), reminders: snap.settings.calendarDefaultReminders }) });

  const commit = async (changes: EventChanges, message: string) => {
    await unwrap(api.vault.saveEvents(changes.save, changes.remove));
    await onChanged();
    toast(message);
  };

  const openEdit = (occ: Occurrence) => {
    const ev = occ.event;
    const span = daysBetween(ev.start, ev.end);
    setDetail(null);
    setEditor({
      series: ev,
      occDay: occ.day,
      input: {
        ...ev,
        start: occ.day,
        end: addDays(occ.day, span),
        reminders: ev.reminders.map((r) => ({ ...r })),
        repeat: ev.repeat ? { ...ev.repeat } : null
      }
    });
  };

  const toggleDone = async (occ: Occurrence) => {
    try {
      await commit({ save: [setDone(occ.event, occ.day, !occ.done)], remove: [] }, occ.done ? 'Marked as not done.' : 'Marked as done.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const askDelete = (occ: Occurrence) => {
    setDetail(null);
    if (!occ.event.repeat) return setConfirmDelete({ occ });
    setAsk({
      kind: 'delete',
      run: async (scope) => {
        await commit(applyDelete(occ.event, occ.day, scope), scope === 'this' ? 'This event was deleted.' : scope === 'future' ? 'This and following events were deleted.' : 'All events in the series were deleted.');
      }
    });
  };

  // ---------------------------------------------------------------- data
  const searching = query.trim() !== '' || filter !== 'all';
  const results = useMemo(() => {
    if (!searching) return [];
    const from = filter === 'upcoming' || filter === 'today' ? today : addDays(today, -365);
    const to = filter === 'today' ? today : filter === 'overdue' ? today : addDays(today, 365);
    return occurrencesInRange(events, from, to).filter((o) => {
      if (!matchesEvent(o, query, now)) return false;
      switch (filter) {
        case 'today':
          return o.day <= today && o.endDay >= today;
        case 'upcoming':
          return !o.done && occurrenceBounds(o).end > now;
        case 'completed':
          return o.done;
        case 'reminders':
          return o.event.reminders.some((r) => r.enabled);
        case 'overdue':
          return isOverdue(o, now);
        default:
          return true;
      }
    });
  }, [searching, events, query, filter, today, now]);

  const move = (dir: -1 | 1) => {
    if (view === 'month') {
      const m = addMonths(monthOf(selected), dir);
      const d = parseDay(selected).getDate();
      const max = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
      setSelected(`${m}-${String(Math.min(d, max)).padStart(2, '0')}`);
    } else setSelected(addDays(selected, view === 'week' ? 7 * dir : dir));
  };

  const heading =
    view === 'month' || view === 'agenda'
      ? parseDay(selected).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : view === 'week'
        ? weekLabel(startOfWeek(selected))
        : formatDay(selected, { weekday: 'long', month: 'long', day: 'numeric' });

  const detailOcc = detail ? occurrencesInRange(events, detail.day, detail.day).find((o) => o.event.id === detail.eventId && o.day === detail.day) : undefined;

  return (
    <div className="page calendar-page">
      <div className="page-narrow">
        {!mobile && <h1 className="h1 money-title">Calendar</h1>}

        <div className="evc-search" role="search">
          <div className="evc-search-box">
            <Search size={16} aria-hidden />
            <input
              className="input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events, dates, categories…"
              aria-label="Search calendar"
              autoComplete="off"
              maxLength={120}
            />
            {query && (
              <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="evc-filters" role="group" aria-label="Filter events">
            {(
              [
                ['all', 'All events'],
                ['today', 'Today'],
                ['upcoming', 'Upcoming'],
                ['overdue', 'Overdue'],
                ['reminders', 'With reminders'],
                ['completed', 'Completed']
              ] as [Filter, string][]
            ).map(([f, label]) => (
              <button key={f} type="button" className="evc-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {searching ? (
          <section className="card evc-panel" aria-label="Search results">
            <div className="evc-panel-head">
              <h2 className="evc-panel-title">
                {results.length} result{results.length === 1 ? '' : 's'}
              </h2>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Clear
              </button>
            </div>
            <OccurrenceList items={results} now={now} showDate onOpen={(o) => setDetail({ eventId: o.event.id, day: o.day })} onToggle={toggleDone} empty="No events match." />
          </section>
        ) : (
          <>
            <header className="money-head evc-head">
              <div className="month-switch" role="group" aria-label="Date">
                <button type="button" className="icon-btn" onClick={() => move(-1)} aria-label={`Previous ${view === 'agenda' ? 'month' : view}`}>
                  <ChevronLeft size={18} />
                </button>
                <span className="month-label evc-label" aria-live="polite">
                  {heading}
                </span>
                <button type="button" className="icon-btn" onClick={() => move(1)} aria-label={`Next ${view === 'agenda' ? 'month' : view}`}>
                  <ChevronRight size={18} />
                </button>
              </div>
              {selected !== today && (
                <button type="button" className="btn sm" onClick={() => setSelected(today)}>
                  Today
                </button>
              )}
              <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Reminder settings" title="Reminder settings">
                <Settings2 size={18} />
              </button>
            </header>

            <div className="segmented evc-views" role="tablist" aria-label="Calendar view">
              {(
                [
                  ['month', 'Month'],
                  ['week', 'Week'],
                  ['day', 'Day'],
                  ['agenda', 'Agenda']
                ] as [View, string][]
              ).map(([v, l]) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} aria-pressed={view === v} onClick={() => setView(v)}>
                  {l}
                </button>
              ))}
            </div>

            {view === 'month' && (
              <>
                <section className="card evc-panel" aria-label={heading}>
                  <MonthGrid month={monthOf(selected)} today={today} selected={selected} events={events} tasksByDay={tasksByDay} mobile={mobile} onSelect={setSelected} />
                </section>
                <DayPanel
                  day={selected}
                  today={today}
                  events={events}
                  tasks={tasksByDay.get(selected) ?? []}
                  onOpenTask={onOpenTask}
                  onToggleTask={toggleTask}
                  now={now}
                  onAdd={() => openNew(selected)}
                  onOpen={(o) => setDetail({ eventId: o.event.id, day: o.day })}
                  onToggle={toggleDone}
                />
                <MonthEvents
                  month={monthOf(selected)}
                  today={today}
                  events={events}
                  now={now}
                  onSelectDay={setSelected}
                  onOpen={(o) => setDetail({ eventId: o.event.id, day: o.day })}
                  onToggle={toggleDone}
                />
              </>
            )}
            {view === 'week' && (
              <section className="card evc-panel evc-week-panel" aria-label={heading}>
                <WeekGrid
                  weekStart={startOfWeek(selected)}
                  today={today}
                  selected={selected}
                  events={events}
                  now={now}
                  onSelect={setSelected}
                  onSlot={(day, hour) => openNew(day, hour)}
                  onOpen={(o) => setDetail({ eventId: o.event.id, day: o.day })}
                />
              </section>
            )}
            {view === 'day' && (
              <DayPanel
                day={selected}
                today={today}
                events={events}
                tasks={tasksByDay.get(selected) ?? []}
                onOpenTask={onOpenTask}
                onToggleTask={toggleTask}
                now={now}
                large
                onAdd={() => openNew(selected)}
                onOpen={(o) => setDetail({ eventId: o.event.id, day: o.day })}
                onToggle={toggleDone}
                onEdit={openEdit}
                onDelete={askDelete}
              />
            )}
            {view === 'agenda' && <Agenda events={events} now={now} today={today} onOpen={(o) => setDetail({ eventId: o.event.id, day: o.day })} onToggle={toggleDone} />}
          </>
        )}

        {!mobile && (
          <div className="evc-add-row">
            <button type="button" className="btn primary" onClick={() => openNew(selected)}>
              <CalendarPlus size={16} aria-hidden /> Add event
            </button>
          </div>
        )}
      </div>

      {detailOcc && (
        <EventDetail
          occ={detailOcc}
          now={now}
          onClose={() => setDetail(null)}
          onEdit={() => openEdit(detailOcc)}
          onDelete={() => askDelete(detailOcc)}
          onToggle={() => toggleDone(detailOcc)}
        />
      )}

      {editor && (
        <EventEditor
          initial={editor.input}
          isNew={!editor.series}
          onClose={() => setEditor(null)}
          onDelete={
            editor.series && editor.occDay
              ? () => {
                  const occ = occurrencesInRange(events, editor.occDay!, editor.occDay!).find((o) => o.event.id === editor.series!.id);
                  setEditor(null);
                  if (occ) askDelete(occ);
                }
              : undefined
          }
          onSave={async (input) => {
            const { series, occDay } = editor;
            if (!series || !occDay) {
              await commit({ save: [input], remove: [] }, 'Event saved.');
              setSelected(input.start);
              setEditor(null);
              return;
            }
            if (!series.repeat) {
              await commit(applyEdit(series, occDay, input, 'all'), 'Changes saved.');
              setEditor(null);
              return;
            }
            setAsk({
              kind: 'edit',
              run: async (scope) => {
                await commit(applyEdit(series, occDay, input, scope), 'Changes saved.');
                setEditor(null);
              }
            });
          }}
        />
      )}

      {ask && <ScopeDialog kind={ask.kind} onCancel={() => setAsk(null)} onPick={ask.run} onDone={() => setAsk(null)} />}

      {confirmDelete && (
        <ConfirmDialog
          placement="center"
          title="Delete this event?"
          danger
          confirmLabel="Delete"
          message={`“${confirmDelete.occ.event.title}” and its reminders will be deleted.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              await commit(applyDelete(confirmDelete.occ.event, confirmDelete.occ.day, 'all'), 'Event deleted.');
              setConfirmDelete(null);
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}

      {settingsOpen && (
        <ReminderSettings
          settings={snap.settings}
          onClose={() => setSettingsOpen(false)}
          onChanged={onChanged}
          phoneItems={() => phoneCalendarItems(snap.events, snap.tasks, new Date(), snap.settings.phoneCalendarNames)}
        />
      )}
    </div>
  );
}

function weekLabel(start: string): string {
  const end = addDays(start, 6);
  const a = parseDay(start);
  const b = parseDay(end);
  const sameMonth = a.getMonth() === b.getMonth();
  return `${a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`;
}

function timeRange(o: Occurrence): string {
  const ev = o.event;
  if (ev.allDay) return o.day === o.endDay ? 'All day' : `All day · until ${formatDay(o.endDay)}`;
  const end = o.endDay === o.day ? formatTime(ev.endTime) : `${formatDay(o.endDay)} ${formatTime(ev.endTime)}`;
  return `${formatTime(ev.startTime)} – ${end}`;
}

// ---------------------------------------------------------------- month --

function MonthGrid({
  month,
  today,
  selected,
  events,
  tasksByDay,
  mobile,
  onSelect
}: {
  month: string;
  today: string;
  selected: string;
  events: CalendarEvent[];
  tasksByDay: Map<string, Task[]>;
  mobile: boolean;
  onSelect: (day: string) => void;
}) {
  const first = `${month}-01`;
  const gridStart = startOfWeek(first);
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const weeks = Math.ceil((weekdayOf(first) + daysInMonth) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const occ = useMemo(() => occurrencesInRange(events, cells[0]!, cells[cells.length - 1]!), [events, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const byDay = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const o of occ) {
      for (let d = o.day < cells[0]! ? cells[0]! : o.day; d <= o.endDay && d <= cells[cells.length - 1]!; d = addDays(d, 1)) {
        const list = m.get(d) ?? [];
        list.push(o);
        m.set(d, list);
      }
    }
    return m;
  }, [occ]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = addDays(selected, step);
    onSelect(next);
    requestAnimationFrame(() => (document.querySelector(`.evc-day[data-day="${next}"]`) as HTMLElement | null)?.focus());
  };

  const max = mobile ? 3 : 2;
  return (
    <div className="evc-grid" role="grid" aria-label="Month" onKeyDown={onKey}>
      {WEEKDAYS.map((w) => (
        <span key={w} className="cal-wd" role="columnheader" aria-label={w}>
          {mobile ? w.charAt(0) : w}
        </span>
      ))}
      {cells.map((day) => {
        const list = byDay.get(day) ?? [];
        const dayTasks = tasksByDay.get(day) ?? [];
        const outside = monthOf(day) !== month;
        return (
          <button
            key={day}
            type="button"
            role="gridcell"
            className={`evc-day ${outside ? 'outside' : ''}`}
            data-day={day}
            aria-selected={day === selected}
            aria-current={day === today ? 'date' : undefined}
            aria-label={`${formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}${list.length ? `, ${list.length} event${list.length === 1 ? '' : 's'}` : ''}${dayTasks.length ? `, ${dayTasks.length} task${dayTasks.length === 1 ? '' : 's'}` : ''}`}
            tabIndex={day === selected ? 0 : -1}
            onClick={() => onSelect(day)}
          >
            <span className="evc-num">{Number(day.slice(8))}</span>
            {mobile ? (
              list.length + dayTasks.length > 0 && (
                <span className="evc-dots" aria-hidden>
                  {list.slice(0, max).map((o) => (
                    <i key={o.key} style={{ background: eventCategory(o.event.category).color }} className={o.done ? 'done' : ''} />
                  ))}
                  {dayTasks.slice(0, Math.max(1, max - list.length)).map((t) => (
                    <i key={t.id} className={`task ${t.completed ? 'done' : ''}`} />
                  ))}
                </span>
              )
            ) : (
              <span className="evc-labels" aria-hidden>
                {list.slice(0, max).map((o) => (
                  <span key={o.key} className={`evc-label-chip ${o.done ? 'done' : ''}`} style={{ ['--ev' as string]: eventCategory(o.event.category).color }}>
                    {!o.event.allDay && o.day === day ? `${formatTime(o.event.startTime).replace(':00', '').replace(' ', '').toLowerCase()} ` : ''}
                    {o.event.title}
                  </span>
                ))}
                {dayTasks.slice(0, Math.max(0, max - list.length)).map((t) => (
                  <span key={t.id} className={`evc-label-chip evc-task-chip ${t.completed ? 'done' : ''}`}>
                    {t.completed ? '☑' : '☐'} {t.title}
                  </span>
                ))}
                {list.length + dayTasks.length > max && <span className="evc-more">+{list.length + dayTasks.length - max} more</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Every event of the month under the calendar, grouped by day (tap a day to jump to it). */
function MonthEvents({
  month,
  today,
  events,
  now,
  onSelectDay,
  onOpen,
  onToggle
}: {
  month: string;
  today: string;
  events: CalendarEvent[];
  now: Date;
  onSelectDay: (day: string) => void;
  onOpen: (o: Occurrence) => void;
  onToggle: (o: Occurrence) => void;
}) {
  const first = `${month}-01`;
  const last = addDays(addMonths(month, 1) + '-01', -1);
  const days = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const o of occurrencesInRange(events, first, last)) {
      // Multi-day events are listed on their first day in this month.
      const d = o.day < first ? first : o.day;
      m.set(d, [...(m.get(d) ?? []), o]);
    }
    return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [events, first, last]);
  const total = days.reduce((n, [, list]) => n + list.length, 0);
  const label = parseDay(first).toLocaleDateString(undefined, { month: 'long' });

  return (
    <section className="card evc-panel evc-month-list" aria-label={`All events in ${label}`}>
      <div className="evc-panel-head">
        <h2 className="evc-panel-title">
          All events in {label} <span className="muted">({total})</span>
        </h2>
      </div>
      {days.length === 0 ? (
        <div className="evc-empty muted">No events this month.</div>
      ) : (
        days.map(([day, list]) => (
          <div key={day} className={`evc-month-day ${day === today ? 'today' : ''} ${day < today ? 'past' : ''}`}>
            <button type="button" className="evc-month-day-head" onClick={() => onSelectDay(day)} aria-label={`Show ${formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}`}>
              <span className="evc-month-day-num">{Number(day.slice(8))}</span>
              <span className="evc-month-day-name">{day === today ? 'Today' : formatDay(day, { weekday: 'long' })}</span>
            </button>
            <OccurrenceList items={list} now={now} onOpen={onOpen} onToggle={onToggle} empty="" />
          </div>
        ))
      )}
    </section>
  );
}

// ------------------------------------------------------------------ day --

function DayPanel({
  day,
  today,
  events,
  tasks,
  onOpenTask,
  onToggleTask,
  now,
  large,
  onAdd,
  onOpen,
  onToggle,
  onEdit,
  onDelete
}: {
  day: string;
  today: string;
  events: CalendarEvent[];
  tasks: Task[];
  onOpenTask: (taskId: string) => void;
  onToggleTask: (t: Task) => void;
  now: Date;
  large?: boolean;
  onAdd: () => void;
  onOpen: (o: Occurrence) => void;
  onToggle: (o: Occurrence) => void;
  onEdit?: (o: Occurrence) => void;
  onDelete?: (o: Occurrence) => void;
}) {
  const list = useMemo(() => occurrencesInRange(events, day, day), [events, day]);
  const title = day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : day === addDays(today, -1) ? 'Yesterday' : formatDay(day, { weekday: 'long' });
  return (
    <section className={`card evc-panel ${large ? 'large' : ''}`} aria-label={`Events on ${formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}`}>
      <div className="evc-panel-head">
        <div className="grow">
          <h2 className="evc-panel-title">{title}</h2>
          <div className="muted small">{formatDay(day, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>
        <button type="button" className="btn sm" onClick={onAdd}>
          <Plus size={14} aria-hidden /> Add
        </button>
      </div>
      <OccurrenceList
        items={list}
        now={now}
        onOpen={onOpen}
        onToggle={onToggle}
        onEdit={onEdit}
        onDelete={onDelete}
        empty={tasks.length ? 'No events.' : 'Nothing scheduled. Tap Add to plan something.'}
      />
      {tasks.length > 0 && (
        <div className="evc-tasks">
          <h3 className="evc-tasks-title">Tasks due</h3>
          <ul className="evc-list">
            {tasks.map((t) => (
              <li key={t.id} className={`evc-item evc-task ${t.completed ? 'done' : ''}`}>
                <button
                  type="button"
                  className="evc-check"
                  role="checkbox"
                  aria-checked={t.completed}
                  aria-label={t.completed ? `Mark task ${t.title} as not done` : `Complete task ${t.title}`}
                  onClick={() => onToggleTask(t)}
                >
                  {t.completed ? <SquareCheck size={22} aria-hidden /> : <Square size={22} aria-hidden />}
                </button>
                <button type="button" className="evc-item-main" onClick={() => onOpenTask(t.id)}>
                  <span className="evc-item-title">{t.title}</span>
                  <span className="evc-item-meta">
                    <span>Task</span>
                    <span>{t.dueTime ? formatTime(t.dueTime) : 'Any time'}</span>
                    <span>{priorityName(t.priority)} priority</span>
                    {isTaskOverdue(t, now) && <span className="evc-badge overdue">Overdue · {describeDue(t, now)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function OccurrenceList({
  items,
  now,
  showDate,
  onOpen,
  onToggle,
  onEdit,
  onDelete,
  empty
}: {
  items: Occurrence[];
  now: Date;
  showDate?: boolean;
  onOpen: (o: Occurrence) => void;
  onToggle: (o: Occurrence) => void;
  onEdit?: (o: Occurrence) => void;
  onDelete?: (o: Occurrence) => void;
  empty: string;
}) {
  if (!items.length) return <div className="evc-empty muted">{empty}</div>;
  return (
    <ul className="evc-list">
      {items.map((o) => {
        const cat = eventCategory(o.event.category);
        const overdue = isOverdue(o, now);
        const reminders = o.event.reminders.filter((r) => r.enabled).length;
        return (
          <li key={o.key} className={`evc-item ${o.done ? 'done' : ''}`} style={{ ['--ev' as string]: cat.color }}>
            <button
              type="button"
              className="evc-check"
              role="checkbox"
              aria-checked={o.done}
              aria-label={o.done ? `Mark ${o.event.title} as not done` : `Mark ${o.event.title} as done`}
              onClick={() => onToggle(o)}
            >
              {o.done ? <CircleCheck size={22} aria-hidden /> : <Circle size={22} aria-hidden />}
            </button>
            <button type="button" className="evc-item-main" onClick={() => onOpen(o)}>
              <span className="evc-item-title">{o.event.title}</span>
              <span className="evc-item-meta">
                {showDate && <span>{formatDay(o.day, { weekday: 'short', month: 'short', day: 'numeric', year: o.day.slice(0, 4) !== dayKey(now).slice(0, 4) ? 'numeric' : undefined })}</span>}
                <span>
                  <Clock size={12} aria-hidden /> {timeRange(o)}
                </span>
                <span className="evc-cat">
                  <i style={{ background: cat.color }} aria-hidden />
                  {cat.name}
                </span>
                {reminders > 0 && (
                  <span title={`${reminders} reminder${reminders === 1 ? '' : 's'}`}>
                    <Bell size={12} aria-hidden /> {reminders}
                  </span>
                )}
                {o.event.repeat && (
                  <span title={describeRepeat(o.event.repeat, o.event.start)}>
                    <RepeatIcon size={12} aria-hidden /> Repeats
                  </span>
                )}
                {o.event.location && (
                  <span>
                    <MapPin size={12} aria-hidden /> {o.event.location}
                  </span>
                )}
                {overdue && <span className="evc-badge overdue">Overdue</span>}
                {o.done && <span className="evc-badge done">Done</span>}
              </span>
            </button>
            {(onEdit || onDelete) && (
              <span className="evc-item-actions">
                {onEdit && (
                  <button type="button" className="icon-btn" onClick={() => onEdit(o)} aria-label={`Edit ${o.event.title}`} title="Edit">
                    <Pencil size={15} />
                  </button>
                )}
                {onDelete && (
                  <button type="button" className="icon-btn" onClick={() => onDelete(o)} aria-label={`Delete ${o.event.title}`} title="Delete">
                    <Trash2 size={15} />
                  </button>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ----------------------------------------------------------------- week --

interface Placed {
  o: Occurrence;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/** Lay out one day's timed events: overlapping ones share the width side by side. */
function layoutDay(list: Occurrence[], day: string): Placed[] {
  const items = list
    .filter((o) => !o.event.allDay && o.day <= day && o.endDay >= day)
    .map((o) => {
      const s = o.day === day ? timeToMin(o.event.startTime) : 0;
      const e = o.endDay === day ? timeToMin(o.event.endTime) : 24 * 60;
      return { o, s, e: Math.max(e, s + 30) };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out: Placed[] = [];
  let cluster: { o: Occurrence; s: number; e: number; lane: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) out.push({ o: c.o, top: (c.s / 60) * HOUR_PX, height: Math.max(22, ((c.e - c.s) / 60) * HOUR_PX - 2), lane: c.lane, lanes });
    cluster = [];
  };
  for (const it of items) {
    if (it.s >= clusterEnd && cluster.length) flush();
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? 0, c.e);
    let lane = laneEnds.findIndex((end) => end <= it.s);
    if (lane < 0) lane = laneEnds.length;
    cluster.push({ ...it, lane });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return out;
}

function WeekGrid({
  weekStart,
  today,
  selected,
  events,
  now,
  onSelect,
  onSlot,
  onOpen
}: {
  weekStart: string;
  today: string;
  selected: string;
  events: CalendarEvent[];
  now: Date;
  onSelect: (day: string) => void;
  onSlot: (day: string, hour: number) => void;
  onOpen: (o: Occurrence) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const occ = useMemo(() => occurrencesInRange(events, weekStart, addDays(weekStart, 6)), [events, weekStart]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, (Math.min(now.getHours(), 18) - 1) * HOUR_PX);
    // Only when the week changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);
  const allDay = days.map((d) => occ.filter((o) => o.event.allDay && o.day <= d && o.endDay >= d));
  const hasAllDay = allDay.some((l) => l.length);
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX;

  return (
    <div className="evc-week">
      <div className="evc-week-head">
        <span className="evc-gutter" aria-hidden />
        {days.map((d) => (
          <button key={d} type="button" className="evc-week-day" aria-current={d === today ? 'date' : undefined} aria-pressed={d === selected} onClick={() => onSelect(d)}>
            <span className="evc-wd">{WEEKDAYS[weekdayOf(d)]}</span>
            <span className="evc-num">{Number(d.slice(8))}</span>
          </button>
        ))}
      </div>
      {hasAllDay && (
        <div className="evc-allday">
          <span className="evc-gutter small muted">all-day</span>
          {allDay.map((list, i) => (
            <div key={days[i]} className="evc-allday-col">
              {list.map((o) => (
                <button key={o.key} type="button" className={`evc-block allday ${o.done ? 'done' : ''}`} style={{ ['--ev' as string]: eventCategory(o.event.category).color }} onClick={() => onOpen(o)}>
                  {o.event.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div ref={scrollRef} className="evc-week-scroll">
        <div className="evc-week-body" style={{ height: 24 * HOUR_PX }}>
          <div className="evc-gutter evc-hours" aria-hidden>
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : formatTime(minToTime(h * 60)).replace(':00', '')}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div
              key={d}
              className={`evc-col ${d === today ? 'today' : ''}`}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                onSlot(d, Math.max(0, Math.min(23, Math.floor(y / HOUR_PX))));
              }}
              role="presentation"
            >
              {layoutDay(occ, d).map((p) => (
                <button
                  key={p.o.key}
                  type="button"
                  className={`evc-block ${p.o.done ? 'done' : ''}`}
                  style={{
                    ['--ev' as string]: eventCategory(p.o.event.category).color,
                    top: p.top,
                    height: p.height,
                    left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                    width: `calc(${100 / p.lanes}% - 4px)`
                  }}
                  onClick={() => onOpen(p.o)}
                  aria-label={`${p.o.event.title}, ${timeRange(p.o)}`}
                >
                  <span className="evc-block-title">{p.o.event.title}</span>
                  {p.height > 34 && <span className="evc-block-time">{formatTime(p.o.event.startTime)}</span>}
                </button>
              ))}
              {d === today && <span className="evc-now" style={{ top: nowTop }} aria-hidden />}
            </div>
          ))}
        </div>
      </div>
      <div className="evc-hint muted small">Tap an empty time to add an event there.</div>
    </div>
  );
}

// --------------------------------------------------------------- agenda --

function Agenda({ events, now, today, onOpen, onToggle }: { events: CalendarEvent[]; now: Date; today: string; onOpen: (o: Occurrence) => void; onToggle: (o: Occurrence) => void }) {
  const [showDone, setShowDone] = useState(false);
  const groups = useMemo(() => {
    const all = occurrencesInRange(events, addDays(today, -60), addDays(today, 120));
    const tomorrow = addDays(today, 1);
    const weekEnd = addDays(today, 7);
    const g: { id: string; title: string; items: Occurrence[] }[] = [
      { id: 'overdue', title: 'Overdue', items: all.filter((o) => isOverdue(o, now)) },
      { id: 'today', title: 'Today', items: all.filter((o) => !o.done && !isOverdue(o, now) && o.day <= today && o.endDay >= today) },
      { id: 'tomorrow', title: 'Tomorrow', items: all.filter((o) => !o.done && o.day === tomorrow) },
      { id: 'week', title: 'This week', items: all.filter((o) => !o.done && o.day > tomorrow && o.day <= weekEnd) },
      // Repeats only for the next month, so a daily habit doesn't bury one-off deadlines.
      { id: 'upcoming', title: 'Upcoming', items: all.filter((o) => !o.done && o.day > weekEnd && (!o.event.repeat || o.day <= addDays(today, 30))) },
      { id: 'completed', title: 'Completed', items: all.filter((o) => o.done).reverse() }
    ];
    return g;
  }, [events, now, today]);
  const week = groups.filter((g) => g.id === 'today' || g.id === 'tomorrow' || g.id === 'week').flatMap((g) => g.items);
  const withReminders = week.filter((o) => o.event.reminders.some((r) => r.enabled)).length;
  const open = groups.filter((g) => g.id !== 'completed').reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="evc-agenda">
      <div className="evc-agenda-summary" role="status">
        <span>
          <strong>{groups[1]!.items.length}</strong> today
        </span>
        <span>
          <strong>{week.length}</strong> in the next 7 days
        </span>
        <span>
          <Bell size={13} aria-hidden /> <strong>{withReminders}</strong> with reminders
        </span>
        {groups[0]!.items.length > 0 && (
          <span className="overdue">
            <strong>{groups[0]!.items.length}</strong> overdue
          </span>
        )}
      </div>
      {groups.map((g) =>
        g.id === 'completed' ? (
          g.items.length > 0 && (
            <section key={g.id} className="card evc-panel" aria-label={g.title}>
              <button type="button" className="evc-panel-head evc-toggle" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
                <h2 className="evc-panel-title">
                  {g.title} <span className="muted">({g.items.length})</span>
                </h2>
                <ChevronRight size={16} className="evc-chev" aria-hidden />
              </button>
              {showDone && <OccurrenceList items={g.items} now={now} showDate onOpen={onOpen} onToggle={onToggle} empty="" />}
            </section>
          )
        ) : (
          g.items.length > 0 && (
            <section key={g.id} className={`card evc-panel ${g.id === 'overdue' ? 'overdue' : ''}`} aria-label={g.title}>
              <div className="evc-panel-head">
                <h2 className="evc-panel-title">{g.title}</h2>
              </div>
              <OccurrenceList items={g.items} now={now} showDate={g.id !== 'today' && g.id !== 'tomorrow'} onOpen={onOpen} onToggle={onToggle} empty="" />
            </section>
          )
        )
      )}
      {open === 0 && !groups[5]!.items.length && <div className="card evc-panel evc-empty muted">Nothing planned yet. Add an event to see it here.</div>}
    </div>
  );
}

// --------------------------------------------------------------- detail --

function EventDetail({ occ, now, onClose, onEdit, onDelete, onToggle }: { occ: Occurrence; now: Date; onClose: () => void; onEdit: () => void; onDelete: () => void; onToggle: () => void }) {
  const ev = occ.event;
  const cat = eventCategory(ev.category);
  const { start } = occurrenceBounds(occ);
  const overdue = isOverdue(occ, now);
  return (
    <Dialog
      placement="center"
      size="narrow"
      title={ev.title}
      subtitle={
        <span className="evc-cat">
          <i style={{ background: cat.color }} aria-hidden />
          {cat.name}
        </span>
      }
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
            {occ.done ? <Circle size={15} aria-hidden /> : <CircleCheck size={15} aria-hidden />} {occ.done ? 'Not done' : 'Mark done'}
          </button>
        </>
      }
    >
      <div className="evc-detail">
        <div className="evc-detail-row">
          <Clock size={16} aria-hidden />
          <div>
            <div>{formatDay(occ.day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
            <div className="muted small">
              {timeRange(occ)}
              {!occ.done && !ev.allDay && ` · ${start > now ? 'starts' : 'started'} ${relative(start.getTime(), now.getTime())}`}
            </div>
          </div>
        </div>
        {ev.location && (
          <div className="evc-detail-row">
            <MapPin size={16} aria-hidden />
            <div>{ev.location}</div>
          </div>
        )}
        {ev.repeat && (
          <div className="evc-detail-row">
            <RepeatIcon size={16} aria-hidden />
            <div>{describeRepeat(ev.repeat, ev.start)}</div>
          </div>
        )}
        <div className="evc-detail-row">
          {ev.reminders.some((r) => r.enabled) ? <Bell size={16} aria-hidden /> : <BellOff size={16} aria-hidden />}
          <div>
            {ev.reminders.length === 0
              ? 'No reminders'
              : ev.reminders.map((r) => (
                  <div key={r.id} className={r.enabled ? '' : 'muted'}>
                    {describeReminder(r)}
                    {!r.enabled && ' (off)'}
                  </div>
                ))}
          </div>
        </div>
        {(overdue || occ.done) && <div className={`evc-badge ${occ.done ? 'done' : 'overdue'}`}>{occ.done ? 'Completed' : 'Overdue — not marked done yet'}</div>}
        {ev.notes && <p className="evc-notes">{ev.notes}</p>}
      </div>
    </Dialog>
  );
}

function relative(target: number, now: number): string {
  const diff = target - now;
  const abs = Math.abs(diff);
  const [n, u] = abs < 3_600_000 ? [Math.round(abs / 60_000), 'minute'] : abs < 86_400_000 ? [Math.round(abs / 3_600_000), 'hour'] : [Math.round(abs / 86_400_000), 'day'];
  if (n === 0) return 'now';
  return diff > 0 ? `in ${n} ${u}${n === 1 ? '' : 's'}` : `${n} ${u}${n === 1 ? '' : 's'} ago`;
}

// ---------------------------------------------------------- scope dialog --

function ScopeDialog({ kind, onPick, onCancel, onDone }: { kind: 'edit' | 'delete'; onPick: (s: Scope) => Promise<void>; onCancel: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const pick = async (s: Scope) => {
    setBusy(true);
    try {
      await onPick(s);
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  const verb = kind === 'edit' ? 'Change' : 'Delete';
  return (
    <Dialog placement="center" size="narrow" role="alertdialog" title={kind === 'edit' ? 'Edit a repeating event' : 'Delete a repeating event'} onClose={onCancel} busy={busy}>
      <p className="muted" style={{ margin: '0 0 14px', lineHeight: 1.55 }}>
        {kind === 'edit' ? 'Which events should change?' : 'Which events should be deleted? Their reminders are cancelled too.'}
      </p>
      <div className="evc-scope">
        <button type="button" className="btn block" disabled={busy} onClick={() => pick('this')} data-autofocus>
          {verb} only this event
        </button>
        <button type="button" className="btn block" disabled={busy} onClick={() => pick('future')}>
          {verb} this and following events
        </button>
        <button type="button" className={`btn block ${kind === 'delete' ? 'danger' : 'primary'}`} disabled={busy} onClick={() => pick('all')}>
          {verb} all events in the series
        </button>
        <button type="button" className="btn block ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

// --------------------------------------------------------------- editor --

type RepeatMode = 'none' | RepeatFreq | 'custom';
type EndMode = 'never' | 'until' | 'count';

function repeatModeOf(r: Repeat | null): RepeatMode {
  if (!r) return 'none';
  const simple = r.interval === 1 && (!r.weekdays || r.weekdays.length <= 1);
  return simple ? r.freq : 'custom';
}

let ruleSeq = 0;
const newRuleId = () => `r${Date.now().toString(36)}${(ruleSeq++).toString(36)}`;

function EventEditor({
  initial,
  isNew,
  onClose,
  onSave,
  onDelete
}: {
  initial: CalendarEventInput;
  isNew: boolean;
  onClose: () => void;
  onSave: (input: CalendarEventInput) => Promise<void>;
  onDelete?: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.notes);
  const [location, setLocation] = useState(initial.location);
  const [category, setCategory] = useState(initial.category);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [start, setStart] = useState(initial.start);
  const [startTime, setStartTime] = useState(initial.startTime || '09:00');
  const [end, setEnd] = useState(initial.end);
  const [endTime, setEndTime] = useState(initial.endTime || '10:00');
  const [reminders, setReminders] = useState<ReminderRule[]>(initial.reminders);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(repeatModeOf(initial.repeat));
  const [freq, setFreq] = useState<RepeatFreq>(initial.repeat?.freq ?? 'weekly');
  const [interval, setIntervalN] = useState(initial.repeat?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(initial.repeat?.weekdays ?? [weekdayOf(initial.start)]);
  const [endMode, setEndMode] = useState<EndMode>(initial.repeat?.until ? 'until' : initial.repeat?.count ? 'count' : 'never');
  const [until, setUntil] = useState(initial.repeat?.until ?? addDays(initial.start, 30));
  const [count, setCount] = useState(initial.repeat?.count ?? 10);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<'' | 'dayAt' | 'at'>('');
  const [dayAtDays, setDayAtDays] = useState(0);
  const [dayAtTime, setDayAtTime] = useState('08:00');
  const [customAt, setCustomAt] = useState(`${addDays(initial.start, -1)}T08:00`);
  const [ruleError, setRuleError] = useState<string | null>(null);

  // Keep the end with the start when the start moves.
  const moveStart = (d: string) => {
    const span = Math.max(0, daysBetween(start, end));
    setStart(d);
    setEnd(addDays(d, span));
    if (repeatMode === 'none' || weekdays.length <= 1) setWeekdays([weekdayOf(d)]);
  };
  const moveStartTime = (t: string) => {
    if (start === end && t) {
      const dur = Math.max(15, timeToMin(endTime) - timeToMin(startTime));
      setEndTime(minToTime(Math.min(23 * 60 + 59, timeToMin(t) + dur)));
    }
    setStartTime(t);
  };

  const addRule = (rule: ReminderRule) => {
    if (reminders.some((r) => reminderSignature(r) === reminderSignature(rule))) return setRuleError('That reminder is already set.');
    if (reminders.length >= 12) return setRuleError('At most 12 reminders per event.');
    setRuleError(null);
    setReminders([...reminders, rule]);
    setAdding('');
  };

  const buildRepeat = (): Repeat | null => {
    if (repeatMode === 'none') return null;
    const f = repeatMode === 'custom' ? freq : repeatMode;
    const r: Repeat = { freq: f, interval: repeatMode === 'custom' ? Math.max(1, Math.min(99, Math.round(interval) || 1)) : 1 };
    if (f === 'weekly') r.weekdays = repeatMode === 'custom' && weekdays.length ? [...weekdays].sort() : [weekdayOf(start)];
    if (endMode === 'until') r.until = until;
    else if (endMode === 'count') r.count = Math.max(1, Math.min(1000, Math.round(count) || 1));
    return r;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError({ field: 'title', message: 'Give the event a title.' });
    if (!start) return setError({ field: 'start', message: 'Choose a start date.' });
    if (!end || end < start) return setError({ field: 'end', message: 'The end date can’t be before the start.' });
    if (!allDay) {
      if (!startTime || !endTime) return setError({ field: 'time', message: 'Choose a start and end time.' });
      if (start === end && timeToMin(endTime) < timeToMin(startTime)) return setError({ field: 'time', message: 'The event must end after it starts.' });
    }
    if (repeatMode !== 'none' && endMode === 'until' && until < start) return setError({ field: 'repeat', message: 'The repeat must end after the event starts.' });
    setError(null);
    setBusy(true);
    try {
      await onSave({
        ...initial,
        title: title.trim(),
        notes,
        location: location.trim(),
        category,
        allDay,
        start,
        end,
        startTime: allDay ? '' : startTime,
        endTime: allDay ? '' : endTime,
        reminders,
        repeat: buildRepeat()
      });
    } catch (err) {
      const msg = errorMessage(err);
      setError({ field: 'form', message: msg });
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const errFor = (f: string) =>
    error?.field === f ? (
      <div className="error-text" role="alert">
        {error.message}
      </div>
    ) : null;

  const nowMs = Date.now();
  const refAt = atLocal(start, allDay ? '09:00' : startTime || '09:00').getTime();

  return (
    <Dialog
      placement="center"
      title={isNew ? 'New event' : 'Edit event'}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {onDelete && (
            <button type="button" className="btn" onClick={onDelete} disabled={busy} style={{ marginRight: 'auto' }}>
              <Trash2 size={15} aria-hidden /> Delete
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="event-form" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden />}
            Save
          </button>
        </>
      }
    >
      <form id="event-form" className="evc-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="ev-title">Title</label>
          <input
            id="ev-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Submit school requirements"
            maxLength={200}
            aria-invalid={error?.field === 'title'}
            autoComplete="off"
            data-autofocus
          />
          {errFor('title')}
        </div>

        <div className="setting evc-switch-row">
          <label className="grow" htmlFor="ev-allday">
            All-day
          </label>
          <input id="ev-allday" type="checkbox" className="switch" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        </div>

        <div className="evc-when">
          <div className="field">
            <label htmlFor="ev-start">Starts</label>
            <div className="evc-dt">
              <input id="ev-start" className="input" type="date" value={start} onChange={(e) => e.target.value && moveStart(e.target.value)} required aria-invalid={error?.field === 'start'} />
              {!allDay && <input className="input" type="time" value={startTime} onChange={(e) => moveStartTime(e.target.value)} aria-label="Start time" required />}
            </div>
            {errFor('start')}
          </div>
          <div className="field">
            <label htmlFor="ev-end">Ends</label>
            <div className="evc-dt">
              <input id="ev-end" className="input" type="date" value={end} min={start} onChange={(e) => e.target.value && setEnd(e.target.value)} required aria-invalid={error?.field === 'end'} />
              {!allDay && <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="End time" required aria-invalid={error?.field === 'time'} />}
            </div>
            {errFor('end')}
            {errFor('time')}
          </div>
        </div>

        <div className="field">
          <span className="label">Category</span>
          <div className="cat-picker" role="radiogroup" aria-label="Category">
            {EVENT_CATEGORIES.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={category === c.id} className="cat-chip" onClick={() => setCategory(c.id)}>
                <i className="evc-cat-dot" style={{ background: c.color }} aria-hidden />
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Reminders</span>
          {reminders.length === 0 && <div className="help-text">No reminders. Add one below.</div>}
          <ul className="evc-rules">
            {reminders.map((r) => {
              const at = r.type === 'before' ? refAt - r.minutes * 60_000 : r.type === 'dayAt' ? atLocal(addDays(start, -r.days), r.time).getTime() : atLocal(r.at.slice(0, 10), r.at.slice(11)).getTime();
              const passed = at <= nowMs && repeatMode === 'none';
              return (
                <li key={r.id} className={`evc-rule ${r.enabled ? '' : 'off'}`}>
                  <AlarmClock size={16} aria-hidden />
                  <span className="grow">
                    {describeReminder(r)}
                    {passed && <span className="muted small"> · time has passed</span>}
                  </span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={r.enabled}
                    aria-label={`${describeReminder(r)} ${r.enabled ? 'on' : 'off'}`}
                    onChange={(e) => setReminders(reminders.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))}
                  />
                  <button type="button" className="icon-btn" aria-label={`Remove reminder: ${describeReminder(r)}`} onClick={() => setReminders(reminders.filter((x) => x.id !== r.id))}>
                    <X size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="evc-add-rule">
            <select
              className="input"
              aria-label="Add a reminder"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'dayAt' || v === 'at') return setAdding(v);
                if (v !== '') addRule({ id: newRuleId(), type: 'before', minutes: Number(v), enabled: true });
              }}
            >
              <option value="">+ Add reminder…</option>
              {REMINDER_PRESETS.map((p) => (
                <option key={p.minutes} value={p.minutes}>
                  {p.label}
                </option>
              ))}
              <option value="dayAt">On the day / days before at a time…</option>
              <option value="at">Custom date and time…</option>
            </select>
          </div>
          {adding === 'dayAt' && (
            <div className="evc-rule-form">
              <select className="input" value={dayAtDays} onChange={(e) => setDayAtDays(Number(e.target.value))} aria-label="Which day">
                <option value={0}>On the day</option>
                {[1, 2, 3, 5, 7, 14].map((d) => (
                  <option key={d} value={d}>
                    {d} day{d === 1 ? '' : 's'} before
                  </option>
                ))}
              </select>
              <input className="input" type="time" value={dayAtTime} onChange={(e) => setDayAtTime(e.target.value)} aria-label="Reminder time" />
              <button type="button" className="btn sm primary" disabled={!dayAtTime} onClick={() => addRule({ id: newRuleId(), type: 'dayAt', days: dayAtDays, time: dayAtTime, enabled: true })}>
                Add
              </button>
              <button type="button" className="btn sm" onClick={() => setAdding('')}>
                Cancel
              </button>
            </div>
          )}
          {adding === 'at' && (
            <div className="evc-rule-form">
              <input className="input" type="datetime-local" value={customAt} onChange={(e) => setCustomAt(e.target.value)} aria-label="Reminder date and time" />
              <button type="button" className="btn sm primary" disabled={!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(customAt)} onClick={() => addRule({ id: newRuleId(), type: 'at', at: customAt.slice(0, 16), enabled: true })}>
                Add
              </button>
              <button type="button" className="btn sm" onClick={() => setAdding('')}>
                Cancel
              </button>
            </div>
          )}
          {ruleError && (
            <div className="error-text" role="alert">
              {ruleError}
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="ev-repeat">Repeat</label>
          <select id="ev-repeat" className="input" value={repeatMode} onChange={(e) => setRepeatMode(e.target.value as RepeatMode)}>
            <option value="none">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week on {WEEKDAYS[weekdayOf(start)]}</option>
            <option value="monthly">Every month on day {Number(start.slice(8))}</option>
            <option value="yearly">Every year on {formatDay(start, { month: 'short', day: 'numeric' })}</option>
            <option value="custom">Custom…</option>
          </select>
          {repeatMode === 'custom' && (
            <div className="evc-repeat">
              <div className="evc-rule-form">
                <span className="muted">Every</span>
                <input className="input evc-n" type="number" min={1} max={99} value={interval} onChange={(e) => setIntervalN(Number(e.target.value))} aria-label="Repeat interval" />
                <select className="input" value={freq} onChange={(e) => setFreq(e.target.value as RepeatFreq)} aria-label="Repeat unit">
                  <option value="daily">day(s)</option>
                  <option value="weekly">week(s)</option>
                  <option value="monthly">month(s)</option>
                  <option value="yearly">year(s)</option>
                </select>
              </div>
              {freq === 'weekly' && (
                <div className="evc-weekdays" role="group" aria-label="On these days">
                  {WEEKDAYS.map((w, i) => (
                    <button
                      key={w}
                      type="button"
                      className="evc-chip"
                      aria-pressed={weekdays.includes(i)}
                      onClick={() => setWeekdays(weekdays.includes(i) ? (weekdays.length > 1 ? weekdays.filter((x) => x !== i) : weekdays) : [...weekdays, i])}
                    >
                      {w.charAt(0)}
                      <span className="cal-wd-rest">{w.slice(1)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {repeatMode !== 'none' && (
            <div className="evc-rule-form">
              <span className="muted">Ends</span>
              <select className="input" value={endMode} onChange={(e) => setEndMode(e.target.value as EndMode)} aria-label="Repeat ends">
                <option value="never">Never</option>
                <option value="until">On a date</option>
                <option value="count">After a number of times</option>
              </select>
              {endMode === 'until' && <input className="input" type="date" value={until} min={start} onChange={(e) => e.target.value && setUntil(e.target.value)} aria-label="Repeat until" />}
              {endMode === 'count' && (
                <input className="input evc-n" type="number" min={1} max={1000} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of times" />
              )}
            </div>
          )}
          {errFor('repeat')}
        </div>

        <div className="field">
          <label htmlFor="ev-location">Location (optional)</label>
          <input id="ev-location" className="input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="ev-notes">Notes (optional)</label>
          <textarea id="ev-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
        </div>
        {errFor('form')}
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------- settings --

function ReminderSettings({
  settings,
  onClose,
  onChanged,
  phoneItems
}: {
  settings: VaultSettings;
  onClose: () => void;
  onChanged: () => Promise<void>;
  phoneItems: () => PhoneCalendarItem[];
}) {
  const toast = useToast();
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [exact, setExact] = useState<ExactAlarmStatus | null>(null);
  const [phoneCal, setPhoneCal] = useState<'granted' | 'denied' | 'unsupported' | null>(null);
  const [calendars, setCalendars] = useState<PhoneCalendarInfo[]>([]);
  const [target, setTarget] = useState(phoneCalendarTarget());
  useEffect(() => {
    if (phoneCal !== 'granted') return;
    void api.phoneCalendar.list().then((r) => r.ok && setCalendars(r.value));
  }, [phoneCal]);
  const chooseTarget = async (id: number) => {
    setTarget(id);
    setPhoneCalendarTarget(id);
    const items = phoneItems();
    const r = await api.phoneCalendar.sync(true, items, id);
    if (!r.ok) return toast(`Couldn’t update the phone calendar: ${r.message}`, 'error');
    const name = id ? calendars.find((c) => c.id === id)?.name ?? 'that calendar' : '“VaultLocks”';
    toast(`Moved ${r.value} item${r.value === 1 ? '' : 's'} to ${name}. Check your phone’s Calendar app.`);
  };
  useEffect(() => {
    void api.notifications.status().then(setPermission);
    void api.notifications.exactStatus().then(setExact);
    void api.phoneCalendar.status().then(setPhoneCal);
  }, []);
  const togglePhoneCalendar = async (on: boolean) => {
    if (on && phoneCal !== 'granted') {
      const s = await api.phoneCalendar.request();
      setPhoneCal(s);
      if (s !== 'granted') return toast('Allow calendar access for VaultLocks to show events in the phone’s calendar widgets.', 'error');
    }
    await update({ phoneCalendarOff: !on });
    toast(on ? 'Your next 14 days now show in the phone’s calendar widgets.' : 'Removed from the phone’s calendar.');
  };
  const update = async (patch: Partial<VaultSettings>) => {
    try {
      await unwrap(api.vault.updateSettings(patch));
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const defaults = settings.calendarDefaultReminders;
  return (
    <Dialog placement="center" title="Reminder settings" onClose={onClose}>
      <div className="evc-settings">
        <Row title="Event & task reminders" desc="Alarm pop-ups in the app, and notifications on this device. Also used for task reminders.">
          <input type="checkbox" className="switch" checked={settings.calendarReminders} onChange={(e) => update({ calendarReminders: e.target.checked })} aria-label="Event and task reminders" />
        </Row>
        <Row title="Sound" desc="Play a chime with reminders.">
          <input type="checkbox" className="switch" checked={settings.calendarSound} onChange={(e) => update({ calendarSound: e.target.checked })} aria-label="Reminder sound" />
        </Row>
        <Row title="Show event titles in notifications" desc="Off: notifications only say you have an event and when. Titles stay inside the vault.">
          <input type="checkbox" className="switch" checked={settings.calendarPreview} onChange={(e) => update({ calendarPreview: e.target.checked })} aria-label="Show event titles in notifications" />
        </Row>
        {phoneCal && phoneCal !== 'unsupported' && (
          <>
            <Row
              title="Show in the phone’s calendar widgets"
              desc="On automatically: your next 14 days of events and tasks appear in the phone’s own Calendar widgets on the lock screen and home screen. They are copied into a separate “VaultLocks” calendar on this phone, updated each time you unlock or change something (on iPhone with iCloud Calendar on, that calendar can also sync to your iCloud). Turning this off removes it."
            >
              <input type="checkbox" className="switch" checked={!settings.phoneCalendarOff && phoneCal === 'granted'} onChange={(e) => void togglePhoneCalendar(e.target.checked)} aria-label="Show in the phone’s calendar widgets" />
            </Row>
            {!settings.phoneCalendarOff && phoneCal === 'granted' && (
              <div className="evc-rule-form" style={{ marginTop: 0, paddingBottom: 10 }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={async () => {
                    const items = phoneItems();
                    const r = await api.phoneCalendar.sync(true, items, phoneCalendarTarget());
                    if (!r.ok) return toast(`Couldn’t update the phone calendar: ${r.message}`, 'error');
                    const today = items.filter((i) => new Date(i.start).toDateString() === new Date().toDateString()).length;
                    toast(`Copied ${r.value} item${r.value === 1 ? '' : 's'} to the phone’s “VaultLocks” calendar (${today} today).`);
                  }}
                >
                  Sync now
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={async () => {
                    const r = await api.phoneCalendar.open();
                    if (!r.ok) toast(r.message, 'error');
                  }}
                >
                  Open phone calendar
                </button>
              </div>
            )}
            {!settings.phoneCalendarOff && phoneCal === 'granted' && calendars.length > 0 && (
              <div className="evc-setting-block">
                <div className="title">Put them in</div>
                <select className="input" value={target} onChange={(e) => void chooseTarget(Number(e.target.value))} aria-label="Phone calendar to use">
                  <option value={0}>VaultLocks’ own calendar (this phone only)</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.account && c.account !== c.name ? ` · ${c.account}` : ''}
                    </option>
                  ))}
                </select>
                <div className="help-text">
                  If nothing shows in your phone’s Calendar (Xiaomi/HyperOS often hides VaultLocks’ own calendar), pick your phone or Google calendar here. VaultLocks only
                  changes the events it added; a Google calendar also syncs them to your Google account.
                </div>
              </div>
            )}
            <Row title="Show names in the widget" desc="Off: the widget only shows “VaultLocks event” or “VaultLocks task” and the time. Names are readable by anyone who sees your phone’s calendar.">
              <input
                type="checkbox"
                className="switch"
                checked={settings.phoneCalendarNames}
                disabled={settings.phoneCalendarOff}
                onChange={(e) => void update({ phoneCalendarNames: e.target.checked })}
                aria-label="Show names in the widget"
              />
            </Row>
          </>
        )}
        <div className="evc-setting-block">
          <div className="title">Default reminders for new events</div>
          <div className="evc-weekdays" role="group" aria-label="Default reminders">
            {REMINDER_PRESETS.map((p) => (
              <button
                key={p.minutes}
                type="button"
                className="evc-chip"
                aria-pressed={defaults.includes(p.minutes)}
                onClick={() =>
                  update({
                    calendarDefaultReminders: defaults.includes(p.minutes) ? defaults.filter((m) => m !== p.minutes) : [...defaults, p.minutes].sort((a, b) => a - b).slice(0, 5)
                  })
                }
              >
                {p.label.replace(' before', '')}
              </button>
            ))}
          </div>
        </div>
        <div className="evc-setting-block">
          <div className="title">Remind me later</div>
          <div className="segmented" role="group" aria-label="Snooze length">
            {SNOOZE_CHOICES.map((m) => (
              <button key={m} type="button" aria-pressed={settings.calendarSnooze === m} onClick={() => update({ calendarSnooze: m })}>
                {m < 60 ? `${m} min` : '1 hour'}
              </button>
            ))}
          </div>
        </div>
        <Row
          title="Notification permission"
          desc={
            permission === 'granted'
              ? 'Allowed. Reminders arrive even when VaultLocks is closed on the phone. On a computer, while VaultLocks is open or in the tray.'
              : permission === 'denied'
                ? 'Blocked. Allow notifications for VaultLocks in the system settings. Reminders still pop up inside the app.'
                : permission === 'unsupported'
                  ? 'Notifications aren’t available here. Reminders pop up while the app is open.'
                  : 'Needed for reminders when VaultLocks is closed.'
          }
        >
          {permission === 'granted' ? (
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                try {
                  await unwrap(api.notifications.test());
                  toast('A sample reminder will appear in a few seconds.');
                } catch (e) {
                  toast(errorMessage(e), 'error');
                }
              }}
            >
              Send test
            </button>
          ) : permission === 'prompt' ? (
            <button type="button" className="btn sm primary" onClick={async () => setPermission(await api.notifications.request())}>
              Allow
            </button>
          ) : null}
        </Row>
        {exact && exact !== 'unsupported' && (
          <Row
            title="Exact timing"
            desc={
              exact === 'granted'
                ? 'On. Reminders ring at the exact minute, even when the phone is saving battery.'
                : 'Off. Android may ring reminders a few minutes late to save battery. Allow “Alarms & reminders” for VaultLocks to get exact times.'
            }
          >
            {exact === 'denied' && (
              <button
                type="button"
                className="btn sm primary"
                onClick={async () => {
                  const s = await api.notifications.requestExact();
                  setExact(s);
                  if (s === 'granted') {
                    await onChanged(); // reschedules everything as exact alarms
                    toast('Reminders now ring at the exact time.');
                  }
                }}
              >
                Allow
              </button>
            )}
          </Row>
        )}
      </div>
    </Dialog>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="grow">
        <div className="title">{title}</div>
        <div className="desc">{desc}</div>
      </div>
      {children}
    </div>
  );
}

