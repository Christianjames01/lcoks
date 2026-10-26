import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addMonths, formatMoney, moneyCategory, monthOf, parseDay, type MoneyAccount, type Transaction } from '../../shared/money';
import { MoneyIconFor } from '../views/Money';
import { Dialog } from './Dialog';
import type { ActionItem } from './HoldActions';

import { tr } from '../../shared/i18n';
const monthShort = (m: string) => parseDay(`${m}-01`).toLocaleDateString(undefined, { month: 'short' });
const monthLong = (m: string) => parseDay(`${m}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const dayLabel = (d: string) => parseDay(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const PAGE = 30;

/** Clean axis maximum (1, 2, 2.5, 5 × 10ⁿ) at or above v. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

interface Bar {
  key: string;
  label: string;
  value: number;
  /** Tooltip heading. */
  title: string;
  current?: boolean;
}

/**
 * Single-series column chart: thin columns from one baseline, 4px rounded tops,
 * hairline grid, the current period in full ink and the rest muted. Tap or hover a
 * column for its value (the tooltip is the only place most values are shown).
 */
function Columns({ bars, money, height = 150, labelEvery = 1, ariaLabel }: { bars: Bar[]; money: (v: number, compact?: boolean) => string; height?: number; labelEvery?: number; ariaLabel: string }) {
  const [hot, setHot] = useState<number | null>(null);
  const W = 320;
  const left = 34;
  const top = 14;
  const bottom = 22;
  const plotW = W - left - 4;
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(...bars.map((b) => b.value)));
  const slot = plotW / bars.length;
  const bw = Math.max(3, Math.min(24, slot - 2));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const shown = hot ?? bars.findIndex((b) => b.current);
  const tip = hot !== null ? bars[hot] : null;
  return (
    <div className="cd-chart" onPointerLeave={() => setHot(null)}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel} className="cd-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - 4} y1={y(t)} y2={y(t)} className="cd-grid" />
            <text x={left - 6} y={y(t) + 3.5} className="cd-tick" textAnchor="end">
              {money(t, true)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = left + i * slot + (slot - bw) / 2;
          const h = Math.max(b.value > 0 ? 2 : 0, top + plotH - y(b.value));
          const r = Math.min(4, bw / 2, h);
          const yTop = top + plotH - h;
          // Rounded data end, square at the baseline.
          const d = h > 0 ? `M${x},${top + plotH}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + bw - r}Q${x + bw},${yTop} ${x + bw},${yTop + r}V${top + plotH}Z` : '';
          return (
            <g key={b.key}>
              {d && <path d={d} className={`cd-bar ${b.current ? 'current' : ''} ${hot === i ? 'hot' : ''}`} />}
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={height - 6} className="cd-tick" textAnchor="middle">
                  {b.label}
                </text>
              )}
              {/* Hit target: the whole slot, taller than the mark. */}
              <rect
                x={left + i * slot}
                y={top}
                width={slot}
                height={plotH}
                fill="transparent"
                onPointerEnter={() => setHot(i)}
                onPointerDown={() => setHot(i)}
                aria-label={`${b.title}: ${money(b.value)}`}
              />
            </g>
          );
        })}
        {shown >= 0 && bars[shown]!.value > 0 && (
          <text x={left + shown * slot + slot / 2} y={y(bars[shown]!.value) - 5} className="cd-cap" textAnchor="middle">
            {money(bars[shown]!.value, true)}
          </text>
        )}
      </svg>
      {tip && (
        <div className="cd-tip" style={{ left: `${((left + (hot! + 0.5) * slot) / W) * 100}%` }} role="status">
          <span className="cd-tip-title">{tip.title}</span>
          <strong>{money(tip.value)}</strong>
        </div>
      )}
    </div>
  );
}

/** A category's page from "Spending by category": totals, trend, days, accounts and every record. */
export function CategoryDetail({
  category,
  month,
  transactions,
  accounts,
  currency,
  onClose,
  onOpenTx,
  actions = []
}: {
  category: string;
  month: string;
  transactions: readonly Transaction[];
  accounts: readonly MoneyAccount[];
  currency: string;
  onClose: () => void;
  onOpenTx: (t: Transaction) => void;
  /** Edit / Delete this category. */
  actions?: ActionItem[];
}) {
  const cat = moneyCategory(category);
  const money = (v: number, compact = false) => formatMoney(v, currency, { compact });
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(
    () => transactions.filter((t) => t.category === category && t.kind === cat.kind).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)),
    [transactions, category, cat.kind]
  );
  const sum = (m: string) => list.filter((t) => monthOf(t.date) === m).reduce((s, t) => s + t.amount, 0);
  const inMonth = list.filter((t) => monthOf(t.date) === month);
  const total = sum(month);
  const prev = sum(addMonths(month, -1));
  const diff = total - prev;
  const biggest = inMonth.reduce((m, t) => Math.max(m, t.amount), 0);

  const months: Bar[] = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(month, i - 5);
    return { key: m, label: monthShort(m), value: sum(m), title: monthLong(m), current: m === month };
  });
  const daysInMonth = new Date(parseDay(`${month}-01`).getFullYear(), parseDay(`${month}-01`).getMonth() + 1, 0).getDate();
  const days: Bar[] = Array.from({ length: daysInMonth }, (_, i) => {
    const d = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { key: d, label: String(i + 1), value: inMonth.filter((t) => t.date === d).reduce((s, t) => s + t.amount, 0), title: dayLabel(d) };
  });
  const byAccount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of inMonth) m.set(t.accountId ?? '', (m.get(t.accountId ?? '') ?? 0) + t.amount);
    return [...m].map(([id, v]) => ({ name: accounts.find((a) => a.id === id)?.name ?? 'No account', value: v })).sort((a, b) => b.value - a.value);
  }, [inMonth, accounts]);

  // Records grouped by month (newest first), loaded in pages.
  const groups: [string, Transaction[]][] = [];
  for (const t of list.slice(0, shown)) {
    const m = monthOf(t.date);
    const g = groups[groups.length - 1];
    if (g && g[0] === m) g[1].push(t);
    else groups.push([m, [t]]);
  }
  const income = cat.kind === 'income';

  return (
    <Dialog placement="center" size="wide" title={cat.name} subtitle={monthLong(month)} onClose={onClose}>
      <div className="cd">
        <div className="cd-hero">
          <span className="cd-hero-icon" aria-hidden>
            <MoneyIconFor category={category} size={22} />
          </span>
          <div className="grow">
            <div className="label">{income ? tr("Received") : tr("Spent")} {tr("in")} {monthShort(month)}</div>
            <div className="cd-hero-value">{money(total)}</div>
            {(prev > 0 || total > 0) && (
              <div className="cd-delta">
                {diff === 0 ? (
                  tr("Same as {0}", [monthShort(addMonths(month, -1))])
                ) : (
                  <>
                    {diff > 0 ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}
                    {money(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} {tr("than")} {monthShort(addMonths(month, -1))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="cd-stats">
          <div>
            <span className="cd-stat-n">{inMonth.length}</span>
            <span className="cd-stat-l">{inMonth.length === 1 ? 'record' : 'records'}</span>
          </div>
          <div>
            <span className="cd-stat-n">{inMonth.length ? money(Math.round(total / inMonth.length / 100) * 100) : '—'}</span>
            <span className="cd-stat-l">{tr("average")}</span>
          </div>
          <div>
            <span className="cd-stat-n">{biggest ? money(biggest) : '—'}</span>
            <span className="cd-stat-l">{tr("biggest")}</span>
          </div>
        </div>

        <section className="cd-card" aria-label={tr("Last 6 months")}>
          <h3 className="cd-h">{tr("Last 6 months")}</h3>
          <Columns bars={months} money={money} ariaLabel={`${cat.name}, last 6 months`} />
        </section>

        <section className="cd-card" aria-label={tr("Each day in {0}", [monthLong(month)])}>
          <h3 className="cd-h">{tr("Each day in")} {monthShort(month)}</h3>
          <Columns bars={days} money={money} height={130} labelEvery={5} ariaLabel={`${cat.name} by day, ${monthLong(month)}`} />
        </section>

        {byAccount.length > 0 && (
          <section className="cd-card" aria-label={income ? tr("Added to") : tr("Paid with")}>
            <h3 className="cd-h">{income ? tr("Added to") : tr("Paid with")}</h3>
            <ul className="cd-accounts">
              {byAccount.map((a) => (
                <li key={a.name}>
                  <span className="cd-acc-top">
                    <span>{a.name}</span>
                    <span className="cd-acc-v">
                      {money(a.value)} <span className="dim">· {Math.round((a.value / Math.max(1, total)) * 100)}%</span>
                    </span>
                  </span>
                  <span className="cd-acc-bar" aria-hidden>
                    <span style={{ width: `${(a.value / Math.max(1, byAccount[0]!.value)) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {actions.length > 0 && (
          <div className="cd-actions">
            {actions.map((a) => (
              <button key={a.key} type="button" className={`btn sm ${a.danger ? 'danger' : ''}`} onClick={a.run}>
                {a.icon}
                {a.label}
              </button>
            ))}
          </div>
        )}

        <section aria-label={tr("All records")}>
          <h3 className="cd-h">{tr("All")} {cat.name} {tr("records")}</h3>
          {list.length === 0 ? (
            <p className="dim small">{tr("Nothing recorded in")} {cat.name} {tr("yet.")}</p>
          ) : (
            <>
              {groups.map(([m, items]) => (
                <div key={m} className="cd-group">
                  <div className="cd-group-head">
                    <span>{monthLong(m)}</span>
                    <span>{money(sum(m))}</span>
                  </div>
                  <ul className="cd-list">
                    {items.map((t) => (
                      <li key={t.id}>
                        <button type="button" className="cd-row" onClick={() => onOpenTx(t)}>
                          <span className="grow">
                            <span className="cd-row-note">{t.note || cat.name}</span>
                            <span className="dim small">
                              {dayLabel(t.date)}
                              {t.accountId ? ` · ${accounts.find((a) => a.id === t.accountId)?.name ?? ''}` : ''}
                            </span>
                          </span>
                          <strong className="cd-row-amt">
                            {income ? '+' : '−'}
                            {money(t.amount)}
                          </strong>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {list.length > shown && (
                <button type="button" className="btn block" onClick={() => setShown((v) => v + PAGE)}>
                  {tr("Show older (")}{list.length - shown} {tr("more)")}
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
}
