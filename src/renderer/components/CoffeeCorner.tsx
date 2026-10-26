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

import { tr } from '../../shared/i18n';
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
    <section className="coffee-corner" aria-label={tr("Coffee, {0}", [monthName(month)])}>
      <header className="cc-head">
        <span className="cc-mug" aria-hidden>
          <Coffee size={18} strokeWidth={1.9} />
        </span>
        <span className="cc-title">{tr("Coffee ·")} {monthName(month)}</span>
        <button type="button" className="btn sm cc-budget-btn" onClick={onBudget}>
          <PiggyBank size={14} aria-hidden /> {budget ? tr("Budget {0}", [money(budget)]) : tr("Set budget")}
        </button>
      </header>

      <div className="cc-stats">
        <div>
          <span className="cc-num">{now.cups}</span>
          <span className="cc-cap">{tr(now.cups === 1 ? 'cup' : 'cups')}</span>
        </div>
        <div>
          <span className="cc-num">{money(now.total)}</span>
          <span className="cc-cap">{tr("spent")}</span>
        </div>
        <div>
          <span className="cc-num">{now.cups ? money(now.perCup) : '—'}</span>
          <span className="cc-cap">{tr("a cup")}</span>
        </div>
      </div>

      {budget > 0 && (
        <div className={`cc-budget ${left < 0 ? 'over' : pct >= 80 ? 'near' : ''}`}>
          <span className="ms-bar" role="img" aria-label={tr("{0}% of the coffee budget used", [Math.round(pct)])}>
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="cc-budget-text">
            {left >= 0 ? tr("{0} of {1} · {2} left", [money(now.total), money(budget), money(left)]) : tr("{0} over your coffee budget", [money(-left)])}
          </span>
        </div>
      )}

      {before.total > 0 && now.cups > 0 && (
        <p className="cc-fun">
          {diff === 0
            ? tr("Same as {0}. Steady brew.", [monthName(addMonths(month, -1))])
            : diff < 0
              ? tr("{0} less than {1}. Nice.", [money(-diff), monthName(addMonths(month, -1))])
              : tr("{0} more than {1}.", [money(diff), monthName(addMonths(month, -1))])}
        </p>
      )}

      <button type="button" className={`cc-break ${coffeeBreak ? 'on' : ''}`} onClick={() => setBreakOpen(true)} aria-pressed={!!coffeeBreak}>
        <AlarmClock size={15} aria-hidden />
        <span className="grow">
          {coffeeBreak ? tr("Coffee break · {0} {1}", [describeDays(coffeeBreak.repeat?.weekdays), formatTime(coffeeBreak.startTime)]) : tr("Remind me to take a coffee break")}
        </span>
        <span className="cc-break-state">{coffeeBreak ? tr("Change") : tr("Add")}</span>
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
        toast(tr("Coffee-break reminder removed."));
      } else {
        const ev = coffeeBreakEvent(new Date(), time, days);
        // Changing keeps the same event (and its place in Calendar).
        await unwrap(api.vault.saveEvents([current ? { ...ev, id: current.id, start: current.start <= ev.start ? current.start : ev.start } : ev], []));
        toast(tr("Coffee break: {0} at {1}.", [describeDays(days), formatTime(time)]));
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
      title={tr("Coffee break")}
      subtitle={tr("A reminder in Calendar at this time")}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {current && (
            <button type="button" className="btn danger left" onClick={() => void run(true)} disabled={busy}>
              {tr("Remove")}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </button>
          <button type="button" className="btn primary" onClick={() => void run(false)} disabled={busy || !days.length || !/^\d{2}:\d{2}$/.test(time)}>
            {busy && <span className="spinner" aria-hidden />}
            {tr("Save")}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="cb-time">{tr("Time")}</label>
        <input id="cb-time" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <span className="label">{tr("Days")}</span>
        <div className="cb-days" role="group" aria-label={tr("Days")}>
          {DAY_LETTERS.map(([d, letter, name]) => (
            <button key={d} type="button" className="cb-day" aria-pressed={days.includes(d)} aria-label={name} title={name} onClick={() => flip(d)}>
              {letter}
            </button>
          ))}
        </div>
        <span className="help-text">{days.length ? tr("Every {0}", [describeDays(days) === 'weekdays' ? 'weekday' : describeDays(days) === 'every day' ? 'day' : describeDays(days)]) : tr("Pick at least one day.")}</span>
      </div>
    </Dialog>
  );
}
