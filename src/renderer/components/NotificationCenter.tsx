import { Bell, CalendarClock, CalendarDays, CheckCheck, CircleAlert, ListTodo, ShieldAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { eventCategory, formatDay, formatTime, relativeDay, remindersBetween } from '../../shared/calendar';
import { describeUpcoming, upcomingDates } from '../../shared/expiry';
import { dayKey } from '../../shared/money';
import { describeDue, isTaskOverdue, taskRemindersBetween } from '../../shared/tasks';
import type { VaultSnapshot } from '../../shared/types';
import { Dialog } from './Dialog';

const SEEN_KEY = 'vaultlocks.notificationsSeen';
const READ_KEY = 'vaultlocks.notificationsRead';
const DAY = 86_400_000;
/** How far back the notification history goes. */
const HISTORY_DAYS = 730;
/** History rows shown before "Show older". */
const PAGE = 60;

/**
 * Which notifications were read (on this device only; no titles, just keys):
 * everything up to \`before\` ("Mark all as read"), plus single ones opened since.
 */
export interface ReadState {
  before: number;
  keys: Record<string, number>;
}

export function readState(): ReadState {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ReadState>;
      if (p && typeof p.before === 'number' && p.keys && typeof p.keys === 'object') return { before: p.before, keys: { ...p.keys } };
    }
    // Before per-notification reads: everything up to the last time the panel was opened counts as read.
    return { before: Number(localStorage.getItem(SEEN_KEY)) || 0, keys: {} };
  } catch {
    return { before: 0, keys: {} };
  }
}
function saveRead(s: ReadState): void {
  try {
    // Keep it small: drop marks that "before" already covers or that left the history.
    const oldest = Date.now() - HISTORY_DAYS * DAY;
    const keys = Object.fromEntries(Object.entries(s.keys).filter(([, at]) => at > s.before && at > oldest));
    localStorage.setItem(READ_KEY, JSON.stringify({ before: s.before, keys }));
  } catch {
    /* ignore */
  }
}
export const isUnread = (it: { key: string; at: number }, s: ReadState, now: number) => it.at > 0 && it.at <= now && it.at > s.before && !(it.key in s.keys);
export function markRead(it: { key: string; at: number }): void {
  const s = readState();
  s.keys[it.key] = it.at;
  saveRead(s);
}
export function markAllRead(now: number): void {
  saveRead({ before: now, keys: {} });
}

export interface NoticeItem {
  key: string;
  at: number;
  title: string;
  detail: string;
  icon: ReactNode;
  open: () => void;
}

interface Targets {
  onOpenEvent: (eventId: string, day: string) => void;
  onOpenTask: (taskId: string) => void;
  onOpenEntry: (entryId: string) => void;
}

/** Everything the bell shows, built from the vault (nothing extra is stored). */
export function buildNotices(snap: VaultSnapshot, now: number, t: Targets, since = 0) {
  // History includes reminders already dismissed: clear their "shown" marks for this view only.
  const events = snap.events.map((e) => ({ ...e, acks: [], snoozes: [] }));
  const tasks = snap.tasks.map((x) => ({ ...x, acks: [] }));
  // Only reminders that could have rung: after the event / task was made.
  const made = (iso: string) => Date.parse(iso) || 0;
  const ev = (from: number, to: number): NoticeItem[] =>
    remindersBetween(events, from, to)
      .filter((d) => d.at >= made(d.event.createdAt))
      .map((d) => ({
        key: `e|${d.key}|${d.at}`,
        at: d.at,
        title: d.event.title,
        detail: `${d.event.allDay ? relativeDay(d.day, now) : `${relativeDay(d.day, now)}, ${formatTime(d.event.startTime)}`} · ${eventCategory(d.event.category).name}`,
        icon: <CalendarClock size={16} aria-hidden />,
        open: () => t.onOpenEvent(d.event.id, d.day)
      }));
  const tk = (from: number, to: number): NoticeItem[] =>
    taskRemindersBetween(tasks, from, to)
      .filter((d) => d.at >= made(d.task.createdAt))
      .map((d) => ({
        key: `t|${d.key}`,
        at: d.at,
        title: d.task.title,
        detail: `Task · due ${describeDue(d.task, new Date(now)).replace(/^[A-Z]/, (c) => c.toLowerCase())}`,
        icon: <ListTodo size={16} aria-hidden />,
        open: () => t.onOpenTask(d.task.id)
      }));

  // History: every reminder since the oldest event / task (up to two years back).
  // Nothing is dropped; the panel groups it by day.
  const oldest = Math.max(since, now - HISTORY_DAYS * DAY, Math.min(now, ...[...snap.events, ...snap.tasks].map((x) => made(x.createdAt))));
  const earlier = [...ev(oldest, now), ...tk(oldest, now)].sort((a, b) => b.at - a.at);
  const soon = [...ev(now, now + DAY), ...tk(now, now + DAY)].sort((a, b) => a.at - b.at).slice(0, 20);
  const overdue: NoticeItem[] = snap.tasks
    .filter((x) => isTaskOverdue(x, new Date(now)))
    .map((x) => ({
      key: `o|${x.id}`,
      at: 0,
      title: x.title,
      detail: `Overdue · ${describeDue(x, new Date(now))}`,
      icon: <CircleAlert size={16} aria-hidden />,
      open: () => t.onOpenTask(x.id)
    }));
  const expiring: NoticeItem[] = upcomingDates(snap.entries, new Date(now), 7, snap.categories)
    .filter((u) => u.days >= 0)
    .map((u) => ({
      key: `x|${u.entry.id}|${u.label}`,
      at: 0,
      title: u.entry.title,
      detail: `${describeUpcoming(u)} · ${u.label}`,
      icon: <ShieldAlert size={16} aria-hidden />,
      open: () => t.onOpenEntry(u.entry.id)
    }));
  return { earlier, soon, overdue, expiring };
}

const NO_TARGETS: Targets = { onOpenEvent: () => undefined, onOpenTask: () => undefined, onOpenEntry: () => undefined };

/** Number on the bell: reminders that rang and were not read yet. */
export function unreadCount(snap: VaultSnapshot, now: number): number {
  const s = readState();
  return buildNotices(snap, now, NO_TARGETS, s.before).earlier.filter((it) => isUnread(it, s, now)).length;
}

export function NotificationCenter({ snap, onClose, ...targets }: Targets & { snap: VaultSnapshot; onClose: () => void }) {
  const now = useMemo(() => Date.now(), []);
  const [read, setRead] = useState(readState);
  const n = useMemo(() => buildNotices(snap, now, targets), [snap, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const unread = n.earlier.filter((it) => isUnread(it, read, now)).length;
  // Closing keeps unread ones unread; opening one marks just that one as read.
  const close = onClose;
  const go = (it: NoticeItem) => {
    if (it.at > 0) markRead(it);
    onClose();
    it.open();
  };
  const readAll = () => {
    markAllRead(now);
    setRead(readState());
  };
  const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = dayKey(new Date(now));
  const dayName = (k: string) =>
    k === today ? 'Today' : k === dayKey(new Date(now - DAY)) ? 'Yesterday' : k === dayKey(new Date(now + DAY)) ? 'Tomorrow' : formatDay(k, { weekday: 'short', month: 'short', day: 'numeric' });

  // Days that have notifications (newest first) for the day picker.
  const days = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of [...n.soon, ...n.earlier]) {
      const k = dayKey(new Date(it.at));
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((x, y) => y[0].localeCompare(x[0]));
  }, [n]);
  const [day, setDay] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  const row = (it: NoticeItem, stamp: boolean, withDay = false) => (
    <li key={it.key}>
      <button type="button" className={`nc-item ${stamp && isUnread(it, read, now) ? 'new' : ''}`} onClick={() => go(it)}>
        <span className="nc-icon">{it.icon}</span>
        <span className="nc-main">
          <span className="nc-item-title">{it.title}</span>
          <span className="nc-item-detail">{it.detail}</span>
        </span>
        {it.at > 0 && <span className="nc-time">{withDay ? `${dayName(dayKey(new Date(it.at)))}
${time(it.at)}` : time(it.at)}</span>}
      </button>
    </li>
  );
  const section = (title: string, items: NoticeItem[], stamp: boolean, withDay = false) =>
    items.length > 0 && (
      <section className="nc-section" aria-label={title}>
        <h3 className="nc-title">{title}</h3>
        <ul className="nc-list">{items.map((it) => row(it, stamp, withDay))}</ul>
      </section>
    );
  // History grouped under day headings; long histories load in pages.
  const history = (items: NoticeItem[]) => {
    const groups: [string, NoticeItem[]][] = [];
    for (const it of items.slice(0, shown)) {
      const k = dayKey(new Date(it.at));
      const last = groups[groups.length - 1];
      if (last && last[0] === k) last[1].push(it);
      else groups.push([k, [it]]);
    }
    return (
      <>
        {groups.map(([k, list]) => (
          <section key={k} className="nc-section" aria-label={dayName(k)}>
            <h3 className="nc-title nc-day">
              {dayName(k)} <span className="nc-day-n">{list.length}</span>
            </h3>
            <ul className="nc-list">{list.map((it) => row(it, true))}</ul>
          </section>
        ))}
        {items.length > shown && (
          <button type="button" className="btn block nc-more" onClick={() => setShown((v) => v + PAGE)}>
            Show older ({items.length - shown} more)
          </button>
        )}
      </>
    );
  };

  const empty = !n.earlier.length && !n.soon.length && !n.overdue.length && !n.expiring.length;
  const onDay = day ? [...n.soon, ...n.earlier].filter((it) => dayKey(new Date(it.at)) === day).sort((x, y) => y.at - x.at) : [];
  return (
    <Dialog placement="top" size="narrow" title="Notifications" subtitle="Reminders from your calendar, tasks and vault" onClose={close}>
      {empty ? (
        <div className="nc-empty">
          <Bell size={28} aria-hidden />
          <p>No notifications yet. Reminders you set on events and tasks show up here.</p>
        </div>
      ) : (
        <div className="nc">
          <div className="nc-readbar">
            <span className={unread ? 'nc-unread-n' : 'dim small'}>{unread ? `${unread} unread` : 'All caught up'}</span>
            {unread > 0 && (
              <button type="button" className="btn sm" onClick={readAll}>
                <CheckCheck size={14} aria-hidden /> Mark all as read
              </button>
            )}
          </div>
          <div className="nc-days" role="group" aria-label="Pick a day">
            <button type="button" className="evc-chip" aria-pressed={day === null} onClick={() => setDay(null)}>
              All
            </button>
            {days.map(([k, count]) => (
              <button key={k} type="button" className="evc-chip" aria-pressed={day === k} onClick={() => setDay(k)}>
                {dayName(k)} <span className="tk-chip-n">{count}</span>
              </button>
            ))}
          </div>
          <label className="nc-pick">
            <CalendarDays size={15} aria-hidden />
            <span>Go to a day</span>
            <input type="date" className="input" value={day ?? ''} max={dayKey(new Date(now + DAY))} onChange={(e) => setDay(e.target.value || null)} aria-label="Show notifications of this day" />
          </label>
          {day ? (
            onDay.length ? (
              <section className="nc-section" aria-label={dayName(day)}>
                <h3 className="nc-title nc-day">
                  {dayName(day)} <span className="nc-day-n">{onDay.length}</span>
                </h3>
                <ul className="nc-list">{onDay.map((it) => row(it, true))}</ul>
              </section>
            ) : (
              <p className="nc-none">No notifications on {dayName(day)}.</p>
            )
          ) : (
            <>
              {section('Coming up (next 24 hours)', n.soon, false, true)}
              {section('Overdue tasks', n.overdue, false)}
              {section('Expiring soon', n.expiring, false)}
              {history(n.earlier)}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function BellButton({ count, onClick, size = 19 }: { count: number; onClick: () => void; size?: number }) {
  return (
    <button type="button" className="icon-btn nc-bell" onClick={onClick} aria-label={count ? `Notifications, ${count} new` : 'Notifications'} title="Notifications">
      <Bell size={size} />
      {count > 0 && <span className="nc-badge">{count > 9 ? '9+' : count}</span>}
    </button>
  );
}
