// Spending heatmap: how strongly to colour each day, and what the colours say
// (which weekdays cost the most, the priciest days, the no-spend days, how the
// month and the year went).

import { dayKey, monthOf, parseDay, type Transaction } from './money';

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** Narrow the heatmap to one category and/or one account; empty = everything. */
export interface HeatFilter {
  category?: string;
  accountId?: string;
}

const matches = (t: Transaction, f: HeatFilter) => (!f.category || t.category === f.category) && (!f.accountId || t.accountId === f.accountId);

/** 0 = nothing spent; 1–4 in even steps up to the busiest day. */
export function heatLevel(amount: number, max: number): HeatLevel {
  if (amount <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((amount / max) * 4))) as HeatLevel;
}

/** Expenses per day (transfers and income left out). */
export function spentByDay(txs: readonly Transaction[], keep: (day: string) => boolean = () => true, f: HeatFilter = {}): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of txs) if (t.kind === 'expense' && keep(t.date) && matches(t, f)) m.set(t.date, (m.get(t.date) ?? 0) + t.amount);
  return m;
}

/** The month before, as YYYY-MM. */
export function prevMonth(month: string): string {
  const d = parseDay(`${month}-01`);
  return monthOf(dayKey(new Date(d.getFullYear(), d.getMonth() - 1, 1)));
}

const avgPeso = (total: number, days: number) => (days ? Math.round(total / days / 100) * 100 : 0);

export interface HeatStats {
  /** Sunday first: average spent on that weekday (days with nothing count as ₱0). */
  weekdays: { avg: number; total: number; days: number }[];
  /** Index into weekdays of the costliest one; -1 when nothing was spent. */
  topWeekday: number;
  /** Category spent on most on that weekday. */
  topWeekdayCategory: string | null;
  /** Up to three priciest days, most first. */
  topDays: { day: string; amount: number }[];
  noSpend: number;
  /** Longest run of no-spend days, and the run ending on the last day counted. */
  bestStreak: number;
  streakNow: number;
  /** Average per day: Saturday + Sunday vs Monday–Friday. */
  weekend: number;
  weekday: number;
  /** Days 1–10, 11–20, 21–end. */
  thirds: [number, number, number];
  /** Spent in the 10 days from the biggest cash-in, and its share of the month. */
  afterPayday: { day: string; amount: number; share: number } | null;
  total: number;
  /** Days counted: the whole month, or up to today for the current one. */
  days: number;
}

export function heatStats(txs: readonly Transaction[], month: string, today: string, f: HeatFilter = {}): HeatStats {
  const byDay = spentByDay(txs, (d) => monthOf(d) === month, f);
  const first = parseDay(`${month}-01`);
  const inMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const last = monthOf(today) === month ? Number(today.slice(8)) : month > monthOf(today) ? 0 : inMonth;
  const sums = Array.from({ length: 7 }, () => ({ total: 0, days: 0 }));
  const thirds: [number, number, number] = [0, 0, 0];
  let noSpend = 0;
  let run = 0;
  let bestStreak = 0;
  for (let d = 1; d <= last; d++) {
    const day = dayKey(new Date(first.getFullYear(), first.getMonth(), d));
    const w = sums[parseDay(day).getDay()]!;
    const spent = byDay.get(day) ?? 0;
    w.total += spent;
    w.days++;
    thirds[d <= 10 ? 0 : d <= 20 ? 1 : 2] += spent;
    if (spent) run = 0;
    else {
      noSpend++;
      run++;
      bestStreak = Math.max(bestStreak, run);
    }
  }
  const weekdays = sums.map((s) => ({ avg: avgPeso(s.total, s.days), total: s.total, days: s.days }));
  const best = Math.max(...weekdays.map((w) => w.avg));
  const topWeekday = best > 0 ? weekdays.findIndex((w) => w.avg === best) : -1;
  const total = thirds[0] + thirds[1] + thirds[2];

  // What the costliest weekday goes on.
  let topWeekdayCategory: string | null = null;
  if (topWeekday >= 0) {
    const cats = new Map<string, number>();
    for (const t of txs)
      if (t.kind === 'expense' && monthOf(t.date) === month && Number(t.date.slice(8)) <= last && parseDay(t.date).getDay() === topWeekday && matches(t, f))
        cats.set(t.category, (cats.get(t.category) ?? 0) + t.amount);
    topWeekdayCategory = [...cats].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  // Payday: the biggest cash-in this month (any category), then the 10 days from it.
  let afterPayday: HeatStats['afterPayday'] = null;
  const pay = txs.filter((t) => t.kind === 'income' && monthOf(t.date) === month && Number(t.date.slice(8)) <= last).sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date))[0];
  if (pay && total > 0) {
    const from = Number(pay.date.slice(8));
    let amount = 0;
    for (const [day, v] of byDay) if (Number(day.slice(8)) >= from && Number(day.slice(8)) < from + 10) amount += v;
    afterPayday = { day: pay.date, amount, share: amount / total };
  }

  const end = (a: number[]) => a.reduce((x, i) => x + (sums[i]?.total ?? 0), 0);
  const cnt = (a: number[]) => a.reduce((x, i) => x + (sums[i]?.days ?? 0), 0);
  return {
    weekdays,
    topWeekday,
    topWeekdayCategory,
    topDays: [...byDay].filter(([d]) => Number(d.slice(8)) <= last).map(([day, amount]) => ({ day, amount })).sort((a, b) => b.amount - a.amount || a.day.localeCompare(b.day)).slice(0, 3),
    noSpend,
    bestStreak,
    streakNow: run,
    weekend: avgPeso(end([0, 6]), cnt([0, 6])),
    weekday: avgPeso(end([1, 2, 3, 4, 5]), cnt([1, 2, 3, 4, 5])),
    thirds,
    afterPayday,
    total,
    days: last
  };
}

/** A year at a glance: spent per day, per month, the busiest day, and the costliest and quietest months. */
export function yearHeat(txs: readonly Transaction[], year: number, f: HeatFilter = {}, today = dayKey(new Date())) {
  const byDay = spentByDay(txs, (d) => d.startsWith(`${year}-`), f);
  const months = Array.from({ length: 12 }, () => 0);
  for (const [day, v] of byDay) {
    const i = Number(day.slice(5, 7)) - 1;
    months[i] = (months[i] ?? 0) + v;
  }
  // Months that have started; the quietest one must have some spending (an empty month is just unused).
  const started = months.map((v, i) => ({ month: i, total: v })).filter((m) => `${year}-${String(m.month + 1).padStart(2, '0')}` <= monthOf(today));
  const spent = started.filter((m) => m.total > 0);
  const most = spent.length ? spent.reduce((a, b) => (b.total > a.total ? b : a)) : null;
  const least = spent.length > 1 ? spent.reduce((a, b) => (b.total < a.total ? b : a)) : null;
  return { byDay, months, max: Math.max(0, ...byDay.values()), total: months.reduce((a, v) => a + v, 0), most, least };
}
