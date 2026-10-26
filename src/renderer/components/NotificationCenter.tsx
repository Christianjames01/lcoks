import { Bell, CalendarClock, CalendarDays, CheckCheck, CircleAlert, HandCoins, ListTodo, Receipt, ShieldAlert } from 'lucide-react';
import { billStatus, debtLeft, debtSettled } from '../../shared/plans';
import { useMemo, useState, type ReactNode } from 'react';
import { eventCategory, formatDay, formatTime, occurrenceBounds, occurrencesInRange, relativeDay, remindersBetween } from '../../shared/calendar';
import { describeUpcoming, trackedDates, upcomingDates } from '../../shared/expiry';
import { dayKey, formatMoney } from '../../shared/money';
import { describeDue, isTaskOverdue, taskRemindersBetween } from '../../shared/tasks';
import type { VaultSnapshot } from '../../shared/types';
import { Dialog } from './Dialog';

import { tr } from '../../shared/i18n';
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
/** Unread: it happened after the last "mark all read", was not opened, and was not added afterwards (old events you enter later are history, not news). */
export const isUnread = (it: { key: string; at: number; made?: number }, s: ReadState, now: number) =>
  it.at > 0 && it.at <= now && it.at > s.before && it.at >= (it.made ?? 0) && !(it.key in s.keys);
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
  /** When the thing was created (for unread: entered after it happened = not news). */
  made?: number;
  /** A whole day (all-day event, expiry): no time of day to show. */
  allDay?: boolean;
  title: string;
  detail: string;
  icon: ReactNode;
  open: () => void;
}

interface Targets {
  onOpenBills: () => void;
  onOpenUtang: () => void;
  onOpenEvent: (eventId: string, day: string) => void;
  onOpenTask: (taskId: string) => void;
  onOpenEntry: (entryId: string) => void;
}

const localTime = (day: string, time: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [h, mi] = (time || '09:00').split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, h, mi).getTime();
};

/** Past events, tasks and expiry dates between `from` and `now`. */
function pastNotices(snap: VaultSnapshot, now: number, from: number, t: Targets): NoticeItem[] {
  const made = (iso: string) => Date.parse(iso) || 0;
  const out: NoticeItem[] = [];
  for (const o of occurrencesInRange(snap.events, dayKey(new Date(from)), dayKey(new Date(now)))) {
    const at = occurrenceBounds(o).start.getTime();
    if (at > now || at < from) continue;
    const ev = o.event;
    out.push({
      key: `p|${o.key}`,
      at,
      made: made(ev.createdAt),
      allDay: ev.allDay,
      title: ev.title,
      detail: `${ev.allDay ? `${relativeDay(o.day, now)} · all day` : `${relativeDay(o.day, now)}, ${formatTime(ev.startTime)}`} · ${eventCategory(ev.category).name}${o.done ? ' · done' : ''}`,
      icon: <CalendarClock size={16} aria-hidden />,
      open: () => t.onOpenEvent(ev.id, o.day)
    });
  }
  for (const task of snap.tasks) {
    // Each completed occurrence of a repeating task.
    for (const h of task.history) {
      const at = Date.parse(h.at);
      if (!Number.isFinite(at) || at > now || at < from) continue;
      out.push({ key: `c|${task.id}|${h.due}`, at, made: made(task.createdAt), title: task.title, detail: tr("Task · done"), icon: <ListTodo size={16} aria-hidden />, open: () => t.onOpenTask(task.id) });
    }
    if (!task.due) continue;
    const at = localTime(task.due, task.dueTime);
    if (at > now || at < from) continue;
    out.push({
      key: `d|${task.id}|${task.due}`,
      at,
      made: made(task.createdAt),
      title: task.title,
      detail: task.completed ? tr("Task · done") : tr("Task · was due {0}{1}", [/^(Today|Yesterday|Tomorrow)$/.test(relativeDay(task.due, now)) ? relativeDay(task.due, now).toLowerCase() : relativeDay(task.due, now), task.dueTime ? `, ${formatTime(task.dueTime)}` : '']),
      icon: task.completed ? <ListTodo size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />,
      open: () => t.onOpenTask(task.id)
    });
  }
  // Bills that came due (paid or not) and utang due days.
  for (const b of snap.bills) {
    for (const p of b.paid) {
      const at = localTime(p.date, '12:00');
      if (at > now || at < from) continue;
      out.push({ key: `bp|${b.id}|${p.period}`, at, made: made(b.createdAt), allDay: true, title: b.name, detail: tr("Bill · paid {0}", [formatMoney(p.amount, snap.settings.currency)]), icon: <Receipt size={16} aria-hidden />, open: () => t.onOpenBills() });
    }
    const st = billStatus(b, dayKey(new Date(now)));
    if (st.state === 'overdue' || st.state === 'today') {
      const at = localTime(st.due, '09:00');
      if (at <= now && at >= from) out.push({ key: `bd|${b.id}|${st.period}`, at, made: made(b.createdAt), title: b.name, detail: st.state === 'today' ? tr("Bill · due today") : tr("Bill · overdue"), icon: <Receipt size={16} aria-hidden />, open: () => t.onOpenBills() });
    }
  }
  for (const d of snap.debts) {
    if (!d.due || debtSettled(d)) continue;
    const at = localTime(d.due, '09:00');
    if (at > now || at < from) continue;
    out.push({ key: `du|${d.id}|${d.due}`, at, made: made(d.createdAt), title: d.person, detail: tr("Utang · {0} {1}", [d.direction === 'owedToMe' ? 'collect' : 'pay back', formatMoney(debtLeft(d), snap.settings.currency)]), icon: <HandCoins size={16} aria-hidden />, open: () => t.onOpenUtang() });
  }
  for (const u of trackedDates(snap.entries, snap.categories, new Date(now))) {
    const at = u.date.getTime();
    if (u.days >= 0 || at > now || at < from) continue;
    out.push({
      key: `x|${u.entry.id}|${u.label}|${dayKey(u.date)}`,
      at,
      made: made(u.entry.updatedAt),
      allDay: true,
      title: u.entry.title,
      detail: `${u.kind === 'renews' ? 'Renewed' : u.kind === 'due' ? 'Was due' : 'Expired'} · ${u.label}`,
      icon: <ShieldAlert size={16} aria-hidden />,
      open: () => t.onOpenEntry(u.entry.id)
    });
  }
  return out;
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
        detail: tr("Task · due {0}", [describeDue(d.task, new Date(now)).replace(/^[A-Z]/, (c) => c.toLowerCase())]),
        icon: <ListTodo size={16} aria-hidden />,
        open: () => t.onOpenTask(d.task.id)
      }));

  // History: what already happened (up to two years back), whether or not it had
  // a reminder — every past event, tasks that came due or were done, and vault
  // items that expired. Nothing is dropped; the panel groups it by day.
  const from = Math.max(since, now - HISTORY_DAYS * DAY);
  const earlier = pastNotices(snap, now, from, t).sort((a, b) => b.at - a.at);
  const soon = [...ev(now, now + DAY), ...tk(now, now + DAY)].sort((a, b) => a.at - b.at).slice(0, 20);
  const overdue: NoticeItem[] = snap.tasks
    .filter((x) => isTaskOverdue(x, new Date(now)))
    .map((x) => ({
      key: `o|${x.id}`,
      at: 0,
      title: x.title,
      detail: tr("Overdue · {0}", [describeDue(x, new Date(now))]),
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

const NO_TARGETS: Targets = { onOpenBills: () => undefined, onOpenUtang: () => undefined, onOpenEvent: () => undefined, onOpenTask: () => undefined, onOpenEntry: () => undefined };

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
${it.allDay ? 'All day' : time(it.at)}` : it.allDay ? tr("All day") : time(it.at)}</span>}
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
            {tr("Show older (")}{items.length - shown} {tr("more)")}
          </button>
        )}
      </>
    );
  };

  const empty = !n.earlier.length && !n.soon.length && !n.overdue.length && !n.expiring.length;
  const onDay = day ? [...n.soon, ...n.earlier].filter((it) => dayKey(new Date(it.at)) === day).sort((x, y) => y.at - x.at) : [];
  return (
    <Dialog placement="top" size="narrow" title={tr("Notifications")} subtitle={tr("Reminders from your calendar, tasks and vault")} onClose={close}>
      {empty ? (
        <div className="nc-empty">
          <Bell size={28} aria-hidden />
          <p>{tr("No notifications yet. Reminders you set on events and tasks show up here.")}</p>
        </div>
      ) : (
        <div className="nc">
          <div className="nc-readbar">
            <span className={unread ? 'nc-unread-n' : 'dim small'}>{unread ? tr("{0} unread", [unread]) : tr("All caught up")}</span>
            {unread > 0 && (
              <button type="button" className="btn sm" onClick={readAll}>
                <CheckCheck size={14} aria-hidden /> {tr("Mark all as read")}
              </button>
            )}
          </div>
          <div className="nc-days" role="group" aria-label={tr("Pick a day")}>
            <button type="button" className="evc-chip" aria-pressed={day === null} onClick={() => setDay(null)}>
              {tr("All")}
            </button>
            {days.map(([k, count]) => (
              <button key={k} type="button" className="evc-chip" aria-pressed={day === k} onClick={() => setDay(k)}>
                {dayName(k)} <span className="tk-chip-n">{count}</span>
              </button>
            ))}
          </div>
          <label className="nc-pick">
            <CalendarDays size={15} aria-hidden />
            <span>{tr("Go to a day")}</span>
            <input type="date" className="input" value={day ?? ''} max={dayKey(new Date(now + DAY))} onChange={(e) => setDay(e.target.value || null)} aria-label={tr("Show notifications of this day")} />
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
              <p className="nc-none">{tr("No notifications on")} {dayName(day)}.</p>
            )
          ) : (
            <>
              {section(tr("Coming up (next 24 hours)"), n.soon, false, true)}
              {section(tr("Overdue tasks"), n.overdue, false)}
              {section(tr("Expiring soon"), n.expiring, false)}
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
    <button type="button" className="icon-btn nc-bell" onClick={onClick} aria-label={count ? tr("Notifications, {0} new", [count]) : tr("Notifications")} title={tr("Notifications")}>
      <Bell size={size} />
      {count > 0 && <span className="nc-badge">{count > 9 ? '9+' : count}</span>}
    </button>
  );
}
