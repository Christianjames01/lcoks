import { AlarmClock, Coffee, PiggyBank } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatTime } from '../../shared/calendar';
import { WEEKDAYS, coffeeBreakEvent, coffeeMonth, describeDays, findCoffeeBreak } from '../../shared/coffee';
import type { CalendarEvent } from '../../shared/calendar';
import { Dialog } from './Dialog';
import { addMonths, parseDay } from '../../shared/money';
import type { VaultSnapshot } from '../../shared/types';
import { api, errorMessage, unwrap } from '../lib/api';
import { useToast } from './Toast';

const monthName = (month: string) => parseDay(`${month}-01`).toLocaleDateString(undefined, { month: 'long' });

/** Expenses: this month's coffee, the coffee budget and the weekday coffee-break reminder. */
export function CoffeeCorner({
  snap,
  month,
  money,
  onBudget,
  onChanged
}: {
  snap: VaultSnapshot;
  month: string;
  money: (v: number) => string;
  onBudget: () => void;
  onChanged: () => Promise<void>;
}) {
  const now = useMemo(() => coffeeMonth(snap.transactions, month), [snap.transactions, month]);
  const before = useMemo(() => coffeeMonth(snap.transactions, addMonths(month, -1)), [snap.transactions, month]);
  const coffeeBreak = findCoffeeBreak(snap.events);
  const budget = snap.settings.coffeeBudget;
  if (!now.cups && !budget && !coffeeBreak) return null;

  const pct = budget > 0 ? Math.min(100, (now.total / budget) * 100) : 0;
  const left = budget - now.total;
  const diff = now.total - before.total;

  const [breakOpen, setBreakOpen] = useState(false);

  return (
    <section className="coffee-corner" aria-label={`Coffee, ${monthName(month)}`}>
      <header className="cc-head">
        <span className="cc-mug" aria-hidden>
          <Coffee size={18} strokeWidth={1.9} />
        </span>
        <span className="cc-title">Coffee · {monthName(month)}</span>
        <button type="button" className="btn sm cc-budget-btn" onClick={onBudget}>
          <PiggyBank size={14} aria-hidden /> {budget ? `Budget ${money(budget)}` : 'Set budget'}
        </button>
      </header>

      <div className="cc-stats">
        <div>
          <span className="cc-num">{now.cups}</span>
          <span className="cc-cap">{now.cups === 1 ? 'cup' : 'cups'}</span>
        </div>
        <div>
          <span className="cc-num">{money(now.total)}</span>
          <span className="cc-cap">spent</span>
        </div>
        <div>
          <span className="cc-num">{now.cups ? money(now.perCup) : '—'}</span>
          <span className="cc-cap">a cup</span>
        </div>
      </div>

      {budget > 0 && (
        <div className={`cc-budget ${left < 0 ? 'over' : pct >= 80 ? 'near' : ''}`}>
          <span className="ms-bar" role="img" aria-label={`${Math.round(pct)}% of the coffee budget used`}>
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="cc-budget-text">
            {left >= 0 ? `${money(now.total)} of ${money(budget)} · ${money(left)} left` : `${money(-left)} over your coffee budget`}
          </span>
        </div>
      )}

      {before.total > 0 && now.cups > 0 && (
        <p className="cc-fun">
          {diff === 0
            ? `Same as ${monthName(addMonths(month, -1))}. Steady brew.`
            : diff < 0
              ? `${money(-diff)} less than ${monthName(addMonths(month, -1))}. Nice.`
              : `${money(diff)} more than ${monthName(addMonths(month, -1))}.`}
        </p>
      )}

      <button type="button" className={`cc-break ${coffeeBreak ? 'on' : ''}`} onClick={() => setBreakOpen(true)} aria-pressed={!!coffeeBreak}>
        <AlarmClock size={15} aria-hidden />
        <span className="grow">
          {coffeeBreak ? `Coffee break · ${describeDays(coffeeBreak.repeat?.weekdays)} ${formatTime(coffeeBreak.startTime)}` : 'Remind me to take a coffee break'}
        </span>
        <span className="cc-break-state">{coffeeBreak ? 'Change' : 'Add'}</span>
      </button>
      {breakOpen && <CoffeeBreakDialog current={coffeeBreak} onClose={() => setBreakOpen(false)} onChanged={onChanged} />}
    </section>
  );
}

const DAY_LETTERS: [number, string, string][] = [
  [1, 'M', 'Monday'],
  [2, 'T', 'Tuesday'],
  [3, 'W', 'Wednesday'],
  [4, 'T', 'Thursday'],
  [5, 'F', 'Friday'],
  [6, 'S', 'Saturday'],
  [0, 'S', 'Sunday']
];

/** Pick the coffee-break time and days; it is a repeating event in Calendar with a reminder at the time. */
function CoffeeBreakDialog({ current, onClose, onChanged }: { current?: CalendarEvent; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [time, setTime] = useState(current?.startTime || '15:00');
  const [days, setDays] = useState<number[]>(current?.repeat?.weekdays?.length ? [...current.repeat.weekdays] : [...WEEKDAYS]);
  const [busy, setBusy] = useState(false);
  const flip = (d: number) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]));
  const run = async (remove: boolean) => {
    setBusy(true);
    try {
      if (remove && current) {
        await unwrap(api.vault.saveEvents([], [current.id]));
        toast('Coffee-break reminder removed.');
      } else {
        const ev = coffeeBreakEvent(new Date(), time, days);
        // Changing keeps the same event (and its place in Calendar).
        await unwrap(api.vault.saveEvents([current ? { ...ev, id: current.id, start: current.start <= ev.start ? current.start : ev.start } : ev], []));
        toast(`Coffee break: ${describeDays(days)} at ${formatTime(time)}.`);
      }
      await onChanged();
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      placement="center"
      size="narrow"
      title="Coffee break"
      subtitle="A reminder in Calendar at this time"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {current && (
            <button type="button" className="btn danger left" onClick={() => void run(true)} disabled={busy}>
              Remove
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void run(false)} disabled={busy || !days.length || !/^\d{2}:\d{2}$/.test(time)}>
            {busy && <span className="spinner" aria-hidden />}
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="cb-time">Time</label>
        <input id="cb-time" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <span className="label">Days</span>
        <div className="cb-days" role="group" aria-label="Days">
          {DAY_LETTERS.map(([d, letter, name]) => (
            <button key={d} type="button" className="cb-day" aria-pressed={days.includes(d)} aria-label={name} title={name} onClick={() => flip(d)}>
              {letter}
            </button>
          ))}
        </div>
        <span className="help-text">{days.length ? `Every ${describeDays(days) === 'weekdays' ? 'weekday' : describeDays(days) === 'every day' ? 'day' : describeDays(days)}` : 'Pick at least one day.'}</span>
      </div>
    </Dialog>
  );
}
