import { Bell, CalendarClock, CircleAlert, ListTodo, ShieldAlert } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { eventCategory, formatDay, formatTime, relativeDay, remindersBetween } from '../../shared/calendar';
import { describeUpcoming, upcomingDates } from '../../shared/expiry';
import { dayKey } from '../../shared/money';
import { describeDue, isTaskOverdue, taskRemindersBetween } from '../../shared/tasks';
import type { VaultSnapshot } from '../../shared/types';
import { Dialog } from './Dialog';

const SEEN_KEY = 'vaultlocks.notificationsSeen';
const DAY = 86_400_000;

export function notificationsSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
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
export function buildNotices(snap: VaultSnapshot, now: number, t: Targets) {
  // History includes reminders already dismissed: clear their "shown" marks for this view only.
  const events = snap.events.map((e) => ({ ...e, acks: [], snoozes: [] }));
  const tasks = snap.tasks.map((x) => ({ ...x, acks: [] }));
  const ev = (from: number, to: number): NoticeItem[] =>
    remindersBetween(events, from, to).map((d) => ({
      key: `e|${d.key}|${d.at}`,
      at: d.at,
      title: d.event.title,
      detail: `${d.event.allDay ? relativeDay(d.day, now) : `${relativeDay(d.day, now)}, ${formatTime(d.event.startTime)}`} · ${eventCategory(d.event.category).name}`,
      icon: <CalendarClock size={16} aria-hidden />,
      open: () => t.onOpenEvent(d.event.id, d.day)
    }));
  const tk = (from: number, to: number): NoticeItem[] =>
    taskRemindersBetween(tasks, from, to).map((d) => ({
      key: `t|${d.key}`,
      at: d.at,
      title: d.task.title,
      detail: `Task · due ${describeDue(d.task, new Date(now)).replace(/^[A-Z]/, (c) => c.toLowerCase())}`,
      icon: <ListTodo size={16} aria-hidden />,
      open: () => t.onOpenTask(d.task.id)
    }));

  const earlier = [...ev(now - 7 * DAY, now), ...tk(now - 7 * DAY, now)].sort((a, b) => b.at - a.at).slice(0, 40);
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

/** Number on the bell: reminders that rang since the panel was last opened. */
export function unreadCount(snap: VaultSnapshot, now: number): number {
  const seen = notificationsSeen();
  const from = Math.max(seen, now - 7 * DAY);
  if (from >= now) return 0;
  const events = snap.events.map((e) => ({ ...e, acks: [], snoozes: [] }));
  const tasks = snap.tasks.map((x) => ({ ...x, acks: [] }));
  return remindersBetween(events, from, now).length + taskRemindersBetween(tasks, from, now).length;
}

export function NotificationCenter({ snap, onClose, ...targets }: Targets & { snap: VaultSnapshot; onClose: () => void }) {
  const now = useMemo(() => Date.now(), []);
  const seen = useMemo(() => notificationsSeen(), []);
  const n = useMemo(() => buildNotices(snap, now, targets), [snap, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    markSeen();
    onClose();
  };
  const go = (it: NoticeItem) => {
    markSeen();
    onClose();
    it.open();
  };
  const when = (at: number) => {
    const d = new Date(at);
    const day = dayKey(d) === dayKey(new Date(now)) ? 'Today' : formatDay(dayKey(d), { weekday: 'short', month: 'short', day: 'numeric' });
    return `${day}
${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  };
  const section = (title: string, items: NoticeItem[], stamp: boolean) =>
    items.length > 0 && (
      <section className="nc-section" aria-label={title}>
        <h3 className="nc-title">{title}</h3>
        <ul className="nc-list">
          {items.map((it) => (
            <li key={it.key}>
              <button type="button" className={`nc-item ${stamp && it.at > seen ? 'new' : ''}`} onClick={() => go(it)}>
                <span className="nc-icon">{it.icon}</span>
                <span className="nc-main">
                  <span className="nc-item-title">{it.title}</span>
                  <span className="nc-item-detail">{it.detail}</span>
                </span>
                {it.at > 0 && <span className="nc-time">{when(it.at)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  const empty = !n.earlier.length && !n.soon.length && !n.overdue.length && !n.expiring.length;
  return (
    <Dialog placement="top" size="narrow" title="Notifications" subtitle="Reminders from your calendar, tasks and vault" onClose={close}>
      {empty ? (
        <div className="nc-empty">
          <Bell size={28} aria-hidden />
          <p>No notifications yet. Reminders you set on events and tasks show up here.</p>
        </div>
      ) : (
        <div className="nc">
          {section('Coming up (next 24 hours)', n.soon, false)}
          {section('Overdue tasks', n.overdue, false)}
          {section('Earlier', n.earlier, true)}
          {section('Expiring soon', n.expiring, false)}
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
