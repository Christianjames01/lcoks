import { AlarmClock, CalendarDays, CircleCheck, Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SNOOZE_CHOICES, acknowledge, eventCategory, formatDay, formatTime, occurrenceBounds, relativeDay, remindersBetween, setDone, snooze, timeUntil, type DueReminder } from '../../shared/calendar';
import type { VaultSnapshot } from '../../shared/types';
import { api, errorMessage, unwrap } from '../lib/api';
import { Dialog } from './Dialog';
import { useToast } from './Toast';

const CHECK_MS = 15_000;

/** Short two-note chime (no audio files, nothing loaded from the network). */
function chime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* sound is optional */
  }
}

/**
 * In-app alarm pop-ups for calendar reminders that come due while the vault is open.
 * Reminders that rang while the app was closed were already shown as notifications;
 * they appear in the calendar's Overdue / Today lists instead of popping up again.
 */
export function ReminderAlerts({ snap, onChanged, onView }: { snap: VaultSnapshot; onChanged: () => Promise<void>; onView: (eventId: string, day: string) => void }) {
  const toast = useToast();
  const [queue, setQueue] = useState<DueReminder[]>([]);
  const [busy, setBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
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
      const due = remindersBetween(snapRef.current.events, since.current, now);
      since.current = now;
      if (!due.length) return;
      setQueue((q) => {
        const have = new Set(q.map((d) => `${d.key}@${d.at}`));
        return [...q, ...due.filter((d) => !have.has(`${d.key}@${d.at}`))];
      });
      if (snapRef.current.settings.calendarSound) chime();
      api.app.haptic('warning');
    };
    check();
    const t = setInterval(check, CHECK_MS);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  const current = queue[0];
  if (!current) return null;
  // Use the latest saved version of the event (it may have changed since it rang).
  const ev = snap.events.find((e) => e.id === current.event.id);
  if (!ev) {
    queueMicrotask(() => setQueue((q) => q.slice(1)));
    return null;
  }

  const next = () => {
    setSnoozeOpen(false);
    setQueue((q) => q.slice(1));
  };
  const save = async (input: Parameters<typeof api.vault.saveEvents>[0][number], message?: string) => {
    setBusy(true);
    try {
      await unwrap(api.vault.saveEvents([input], []));
      await onChanged();
      if (message) toast(message);
      next();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  const occ = { event: ev, day: current.day, endDay: current.day };
  const { start } = occurrenceBounds(occ);
  const whenText = ev.allDay ? `${relativeDay(current.day, now)} (all day)` : `${relativeDay(current.day, now)} at ${formatTime(ev.startTime)}`;
  const started = start.getTime() <= now;
  const cat = eventCategory(ev.category);
  const headline = ev.allDay ? `${ev.title} — ${relativeDay(current.day, now).toLowerCase()}` : started ? `${ev.title} — now` : `${ev.title} ${timeUntil(start.getTime(), now)}`;

  return (
    <Dialog
      placement="center"
      size="narrow"
      role="alertdialog"
      busy={busy}
      title={
        <span className="rem-title">
          <AlarmClock size={18} aria-hidden /> {headline}
        </span>
      }
      subtitle={queue.length > 1 ? `Reminder 1 of ${queue.length}` : current.snoozed ? 'Snoozed reminder' : 'Reminder'}
      onClose={() => void save(acknowledge(ev, current.key))}
      footer={
        <div className="rem-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => setSnoozeOpen((v) => !v)} aria-expanded={snoozeOpen}>
            <Clock size={15} aria-hidden /> Remind me later
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              void save(acknowledge(ev, current.key));
              onView(ev.id, current.day);
            }}
          >
            <CalendarDays size={15} aria-hidden /> View event
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void save(setDone({ ...ev, acks: [...ev.acks, current.key] }, current.day, true), 'Marked as done.')}>
            <CircleCheck size={15} aria-hidden /> Mark as done
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save(acknowledge(ev, current.key))} data-autofocus>
            Dismiss
          </button>
        </div>
      }
    >
      <div className="rem-body">
        <div className="rem-when">
          <span className="evc-cat">
            <i style={{ background: cat.color }} aria-hidden />
            {cat.name}
          </span>
          <span>{formatDay(current.day, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          {!ev.allDay && <span>{formatTime(ev.startTime)}</span>}
        </div>
        <p className="rem-message">
          {started && !ev.allDay ? `Your event started ${timeUntil(start.getTime(), now)}.` : `Your scheduled event is ${whenText.charAt(0).toLowerCase() + whenText.slice(1)}.`}
          {ev.location ? ` Location: ${ev.location}.` : ''}
        </p>
        <div className={`rem-status ${started ? 'late' : ''}`}>{started ? (ev.allDay ? 'Today' : `Started ${timeUntil(start.getTime(), now)}`) : `Starts ${timeUntil(start.getTime(), now)}`}</div>
        {snoozeOpen && (
          <div className="rem-snooze" role="group" aria-label="Remind me again in">
            {SNOOZE_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                className={`evc-chip ${m === snap.settings.calendarSnooze ? 'default' : ''}`}
                disabled={busy}
                onClick={() => void save(snooze(ev, current.key, m, Date.now()), `I'll remind you again in ${m < 60 ? `${m} minutes` : '1 hour'}.`)}
              >
                {m < 60 ? `${m} min` : '1 hour'}
              </button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
