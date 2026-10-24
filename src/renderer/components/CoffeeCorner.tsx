import { AlarmClock, Coffee, PiggyBank } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatTime } from '../../shared/calendar';
import { coffeeBreakEvent, coffeeMonth, findCoffeeBreak } from '../../shared/coffee';
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
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => coffeeMonth(snap.transactions, month), [snap.transactions, month]);
  const before = useMemo(() => coffeeMonth(snap.transactions, addMonths(month, -1)), [snap.transactions, month]);
  const coffeeBreak = findCoffeeBreak(snap.events);
  const budget = snap.settings.coffeeBudget;
  if (!now.cups && !budget && !coffeeBreak) return null;

  const pct = budget > 0 ? Math.min(100, (now.total / budget) * 100) : 0;
  const left = budget - now.total;
  const diff = now.total - before.total;

  const toggleBreak = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (coffeeBreak) {
        await unwrap(api.vault.saveEvents([], [coffeeBreak.id]));
        toast('Coffee-break reminder removed.');
      } else {
        await unwrap(api.vault.saveEvents([coffeeBreakEvent()], []));
        toast('Coffee break added to your calendar: weekdays at 3:00 PM.');
      }
      await onChanged();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

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

      <button type="button" className={`cc-break ${coffeeBreak ? 'on' : ''}`} onClick={toggleBreak} disabled={busy} aria-pressed={!!coffeeBreak}>
        <AlarmClock size={15} aria-hidden />
        <span className="grow">
          {coffeeBreak ? `Coffee break · weekdays ${formatTime(coffeeBreak.startTime)}` : 'Remind me to take a coffee break'}
        </span>
        <span className="cc-break-state">{coffeeBreak ? 'On' : 'Add'}</span>
      </button>
    </section>
  );
}
