// Spending heatmap extras: filter chips and the colour legend around the calendar,
// the "Spending pattern" card, and the year at a glance.

import { ArrowDownRight, ArrowUpRight, CalendarRange, ChevronLeft, ChevronRight, Flame, Leaf } from 'lucide-react';
import { useMemo, useState } from 'react';
import { heatLevel, heatStats, prevMonth, yearHeat, type HeatFilter } from '../../shared/heat';
import { dayKey, moneyCategory, monthOf, parseDay, type MoneyAccount, type Transaction } from '../../shared/money';
import { Dialog } from './Dialog';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const short = (d: string) => parseDay(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const monthName = (m: string, style: 'long' | 'short' = 'long') => parseDay(`${m}-01`).toLocaleDateString(undefined, { month: style });
const pct = (v: number) => `${Math.round(v * 100)}%`;

function Legend({ cashIn, overBudget }: { cashIn?: boolean; overBudget?: string }) {
  return (
    <span className="heat-legend">
      <span className="heat-scale" aria-label="Colour shows how much was spent: darker is more">
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} data-level={l} aria-hidden />
        ))}
        More
      </span>
      {cashIn && (
        <span className="heat-key">
          <i className="heat-pay" aria-hidden /> Cash in
        </span>
      )}
      {overBudget && (
        <span className="heat-key">
          <i className="heat-over" aria-hidden /> Over {overBudget}/day
        </span>
      )}
    </span>
  );
}

/** Show the heatmap for one category or one account. */
export function HeatFilterBar({ txs, month, accounts, filter, onChange }: { txs: readonly Transaction[]; month: string; accounts: readonly MoneyAccount[]; filter: HeatFilter; onChange: (f: HeatFilter) => void }) {
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txs) if (t.kind === 'expense' && monthOf(t.date) === month) m.set(t.category, (m.get(t.category) ?? 0) + t.amount);
    return [...m].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [txs, month]);
  // Keep a picked category visible even in a month without it.
  if (filter.category && !cats.includes(filter.category)) cats.unshift(filter.category);
  if (cats.length < 2 && accounts.length < 2) return null;
  return (
    <div className="heat-filter" role="group" aria-label="Show spending for">
      <button type="button" className="tchip" aria-pressed={!filter.category && !filter.accountId} onClick={() => onChange({})}>
        All
      </button>
      {cats.map((c) => (
        <button key={c} type="button" className="tchip" aria-pressed={filter.category === c} onClick={() => onChange({ ...filter, category: filter.category === c ? undefined : c })}>
          {moneyCategory(c).name}
        </button>
      ))}
      {accounts.length > 1 && <span className="heat-filter-sep" aria-hidden />}
      {accounts.length > 1 &&
        accounts.map((a) => (
          <button key={a.id} type="button" className="tchip" aria-pressed={filter.accountId === a.id} onClick={() => onChange({ ...filter, accountId: filter.accountId === a.id ? undefined : a.id })}>
            {a.name}
          </button>
        ))}
    </div>
  );
}

/** Less → More swatches, the cash-in and over-budget marks, and the button for the year view. */
export function HeatLegend({ onYear, cashIn, overBudget }: { onYear: () => void; cashIn: boolean; overBudget?: string }) {
  return (
    <div className="heat-foot">
      <Legend cashIn={cashIn} overBudget={overBudget} />
      <button type="button" className="btn sm" onClick={onYear}>
        <CalendarRange size={14} aria-hidden /> Year
      </button>
    </div>
  );
}

/** Which weekdays cost the most, how the month went, the priciest days and the days with nothing spent. */
export function HeatInsights({
  txs,
  month,
  today,
  filter,
  money,
  onDay
}: {
  txs: readonly Transaction[];
  month: string;
  today: string;
  filter: HeatFilter;
  money: (v: number) => string;
  onDay: (day: string) => void;
}) {
  const s = useMemo(() => heatStats(txs, month, today, filter), [txs, month, today, filter]);
  const prev = useMemo(() => heatStats(txs, prevMonth(month), today, filter), [txs, month, today, filter]);
  if (s.topWeekday < 0) return null;
  const peak = Math.max(1, ...s.weekdays.map((w) => w.avg));
  const top = s.weekdays[s.topWeekday]!;
  const before = prev.days ? prev.weekdays[s.topWeekday]!.avg : 0;
  const diff = top.avg - before;
  const thirdsMax = Math.max(1, s.total);
  const lastDay = s.days > 20 ? s.days : 31;
  return (
    <section className="card heat-card" aria-label="Spending pattern">
      <div className="heat-card-head">
        <span className="label">Spending pattern{filter.category ? ` · ${moneyCategory(filter.category).name}` : ''}</span>
        <span className="heat-headline">
          You spend most on <b>{WD_LONG[s.topWeekday]}</b> · avg {money(top.avg)}
        </span>
        <span className="dim small heat-sub">
          {before > 0 && diff !== 0 && (
            <span className={`heat-delta ${diff > 0 ? 'up' : 'down'}`}>
              {diff > 0 ? <ArrowUpRight size={13} aria-hidden /> : <ArrowDownRight size={13} aria-hidden />}
              {money(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} than {monthName(prevMonth(month))}
            </span>
          )}
          {before > 0 && diff === 0 && <span>Same as {monthName(prevMonth(month))}</span>}
          {!filter.category && s.topWeekdayCategory && <span>Mostly {moneyCategory(s.topWeekdayCategory).name}</span>}
        </span>
      </div>
      <div className="heat-bars" role="list">
        {s.weekdays.map((w, i) => (
          <div key={i} className="heat-bar" role="listitem" aria-label={`${WD_LONG[i]}: average ${money(w.avg)}`} data-top={i === s.topWeekday || undefined} title={`${WD_LONG[i]}: avg ${money(w.avg)}`}>
            <span className="heat-bar-track">
              <span style={{ height: `${Math.max(w.avg ? 6 : 0, (w.avg / peak) * 100)}%` }} />
            </span>
            <span className="heat-bar-wd">{WD[i]!.charAt(0)}</span>
          </div>
        ))}
      </div>

      <div className="heat-split">
        <div className={`heat-tile${s.weekend > s.weekday ? ' hot' : ''}`}>
          <span className="dim small">Weekends</span>
          <b>{money(s.weekend)}</b>
          <span className="dim small">a day</span>
        </div>
        <div className={`heat-tile${s.weekday > s.weekend ? ' hot' : ''}`}>
          <span className="dim small">Weekdays</span>
          <b>{money(s.weekday)}</b>
          <span className="dim small">a day</span>
        </div>
      </div>

      <div className="heat-month">
        <div className="dim small">Time of month</div>
        <div className="heat-thirds" aria-hidden>
          {s.thirds.map((v, i) => (
            <span key={i} style={{ flexGrow: Math.max(0.02, v / thirdsMax) }} data-top={v === Math.max(...s.thirds) && v > 0 ? '' : undefined} />
          ))}
        </div>
        <div className="heat-thirds-labels">
          {s.thirds.map((v, i) => (
            <span key={i}>
              <b>{pct(v / thirdsMax)}</b> {['1–10', '11–20', `21–${lastDay}`][i]}
            </span>
          ))}
        </div>
        {s.afterPayday && s.afterPayday.amount > 0 && (
          <p className="small heat-payday">
            <i className="heat-pay" aria-hidden />
            <span>
              In the 10 days after cash-in on {short(s.afterPayday.day)} you spent <b>{money(s.afterPayday.amount)}</b>, {pct(s.afterPayday.share)} of the month.
            </span>
          </p>
        )}
      </div>

      <div className="heat-facts">
        <div className="heat-fact">
          <Flame size={16} aria-hidden />
          <div>
            <div className="dim small">Priciest days</div>
            <div className="heat-days">
              {s.topDays.map((d) => (
                <button key={d.day} type="button" className="tchip" onClick={() => onDay(d.day)}>
                  {short(d.day)} · <b>{money(d.amount)}</b>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="heat-fact">
          <Leaf size={16} aria-hidden />
          <div>
            <div className="dim small">No-spend days</div>
            <b>
              {s.noSpend} of {s.days}
            </b>
            <div className="dim small">
              Best streak {s.bestStreak} {s.bestStreak === 1 ? 'day' : 'days'}
              {monthOf(today) === month && s.streakNow > 0 ? ` · now ${s.streakNow}` : ''}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Twelve small months coloured by spending: tap a day to open it, or a month's name for the month. */
export function YearHeat({
  txs,
  start,
  filter,
  money,
  onMonth,
  onDay,
  onClose
}: {
  txs: readonly Transaction[];
  start: number;
  filter: HeatFilter;
  money: (v: number) => string;
  onMonth: (month: string) => void;
  onDay: (day: string) => void;
  onClose: () => void;
}) {
  const [year, setYear] = useState(start);
  const y = useMemo(() => yearHeat(txs, year, filter), [txs, year, filter]);
  const peak = Math.max(1, ...y.months);
  const label = (i: number) => new Date(year, i, 1).toLocaleDateString(undefined, { month: 'long' });
  return (
    <Dialog title="Year of spending" subtitle={`${year} · ${money(y.total)} spent${filter.category ? ` · ${moneyCategory(filter.category).name}` : ''}`} onClose={onClose} size="wide">
      <div className="year-nav">
        <button type="button" className="icon-btn" onClick={() => setYear(year - 1)} aria-label="Previous year">
          <ChevronLeft size={18} />
        </button>
        <b>{year}</b>
        <button type="button" className="icon-btn" onClick={() => setYear(year + 1)} aria-label="Next year" disabled={year >= Number(dayKey(new Date()).slice(0, 4))}>
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="year-bars" role="list" aria-label="Spent each month">
        {y.months.map((v, i) => (
          <button
            key={i}
            type="button"
            role="listitem"
            className="year-bar"
            data-top={y.most?.month === i || undefined}
            onClick={() => onMonth(`${year}-${String(i + 1).padStart(2, '0')}`)}
            aria-label={`${label(i)}: ${money(v)}`}
            title={`${label(i)}: ${money(v)}`}
          >
            <span className="year-bar-track">
              <span style={{ height: `${v ? Math.max(4, (v / peak) * 100) : 0}%` }} />
            </span>
            <span className="year-bar-m">{label(i).charAt(0)}</span>
          </button>
        ))}
      </div>
      {y.most && (
        <p className="year-summary small">
          Most: <b>{label(y.most.month)}</b> {money(y.most.total)}
          {y.least && (
            <>
              {' · '}Least: <b>{label(y.least.month)}</b> {money(y.least.total)}
            </>
          )}
        </p>
      )}

      <div className="year-grid">
        {y.months.map((total, m) => {
          const month = `${year}-${String(m + 1).padStart(2, '0')}`;
          const first = new Date(year, m, 1);
          const days = new Date(year, m + 1, 0).getDate();
          return (
            <div key={month} className="year-month">
              <button type="button" className="year-month-head" onClick={() => onMonth(month)} aria-label={`${label(m)}: ${money(total)}. Open month`}>
                <b>{first.toLocaleDateString(undefined, { month: 'short' })}</b>
                <span className="dim">{total ? money(total) : '—'}</span>
              </button>
              <span className="year-cells">
                {Array.from({ length: first.getDay() }, (_, i) => (
                  <i key={`p${i}`} className="pad" />
                ))}
                {Array.from({ length: days }, (_, d) => {
                  const day = `${month}-${String(d + 1).padStart(2, '0')}`;
                  const v = y.byDay.get(day) ?? 0;
                  return v ? (
                    <button key={day} type="button" data-level={heatLevel(v, y.max)} onClick={() => onDay(day)} aria-label={`${short(day)}: ${money(v)}`} title={`${short(day)}: ${money(v)}`} />
                  ) : (
                    <i key={day} data-level={0} />
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
      <div className="heat-foot" style={{ justifyContent: 'center' }}>
        <Legend />
      </div>
    </Dialog>
  );
}
