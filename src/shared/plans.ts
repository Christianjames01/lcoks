// Money plans: budgets per category, utang (who owes who), repeating bills and
// savings goals. Pure functions; the records live in the encrypted vault payload.

import { hashId } from './calendar';
import { addMonths, dayKey, formatMoney, monthOf, parseDay, type Transaction } from './money';

const DAY = 86_400_000;

// --------------------------------------------------------------- budgets --

/** Budget for a category: Coffee uses the coffee budget, others the per-category map. */
export function budgetFor(category: string, s: { coffeeBudget: number; categoryBudgets: Readonly<Record<string, number>> }): number {
  if (category === 'coffee') return s.coffeeBudget || s.categoryBudgets.coffee || 0;
  return s.categoryBudgets[category] ?? 0;
}

export interface BudgetRow {
  category: string;
  budget: number;
  spent: number;
  /** 0–1+ */
  used: number;
  state: 'ok' | 'near' | 'over';
}

export function budgetRows(list: readonly Transaction[], month: string, s: { coffeeBudget: number; categoryBudgets: Readonly<Record<string, number>> }): BudgetRow[] {
  const cats = new Set(Object.keys(s.categoryBudgets).filter((c) => (s.categoryBudgets[c] ?? 0) > 0));
  if (s.coffeeBudget > 0) cats.add('coffee');
  const rows: BudgetRow[] = [];
  for (const category of cats) {
    const budget = budgetFor(category, s);
    if (budget <= 0) continue;
    const spent = list.filter((t) => t.kind === 'expense' && t.category === category && monthOf(t.date) === month).reduce((a, t) => a + t.amount, 0);
    const used = spent / budget;
    rows.push({ category, budget, spent, used, state: used > 1 ? 'over' : used >= 0.8 ? 'near' : 'ok' });
  }
  return rows.sort((a, b) => b.used - a.used);
}

/** Heads-up after adding `added` to a category that had `before` spent this month: crossing 80 % or 100 %. */
export function budgetNudge(before: number, added: number, budget: number): 'near' | 'over' | null {
  if (budget <= 0 || added <= 0) return null;
  const after = before + added;
  if (after > budget && before <= budget) return 'over';
  if (after >= budget * 0.8 && before < budget * 0.8) return 'near';
  return null;
}

// ----------------------------------------------------------------- utang --

export type DebtDirection = 'owedToMe' | 'iOwe';

export interface DebtPayment {
  date: string;
  amount: number;
  accountId?: string;
}

export interface Debt {
  id: string;
  person: string;
  direction: DebtDirection;
  /** Minor units. */
  amount: number;
  note: string;
  /** Day it was lent / borrowed. */
  date: string;
  /** Day to collect / pay back ('' = none); a reminder rings at 09:00. */
  due: string;
  payments: DebtPayment[];
  createdAt: string;
  updatedAt: string;
}

export type DebtInput = Omit<Debt, 'id' | 'createdAt' | 'updatedAt' | 'payments'> & { id?: string };

export const debtPaid = (d: Pick<Debt, 'payments'>) => d.payments.reduce((a, p) => a + p.amount, 0);
export const debtLeft = (d: Pick<Debt, 'amount' | 'payments'>) => Math.max(0, d.amount - debtPaid(d));
export const debtSettled = (d: Pick<Debt, 'amount' | 'payments'>) => debtLeft(d) === 0;

export function debtTotals(list: readonly Debt[]): { owedToMe: number; iOwe: number; peopleOwing: number; peopleOwed: number } {
  const open = list.filter((d) => !debtSettled(d));
  const sum = (dir: DebtDirection) => open.filter((d) => d.direction === dir).reduce((a, d) => a + debtLeft(d), 0);
  const people = (dir: DebtDirection) => new Set(open.filter((d) => d.direction === dir).map((d) => d.person.trim().toLowerCase())).size;
  return { owedToMe: sum('owedToMe'), iOwe: sum('iOwe'), peopleOwing: people('owedToMe'), peopleOwed: people('iOwe') };
}

/** The record a repayment makes in Expenses: money in when they pay you, out when you pay. */
export function debtTransaction(d: Debt, amount: number, date: string, accountId?: string): Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> {
  const what = d.note ? ` · ${d.note}` : '';
  return d.direction === 'owedToMe'
    ? { kind: 'income', amount, category: 'other-income', note: `${d.person} paid back${what}`, date, ...(accountId ? { accountId } : {}) }
    : { kind: 'expense', amount, category: 'other', note: `Paid back ${d.person}${what}`, date, ...(accountId ? { accountId } : {}) };
}

// ----------------------------------------------------------------- bills --

export type BillFreq = 'monthly' | 'yearly';

export interface BillPaid {
  /** 'YYYY-MM' (monthly) or 'YYYY' (yearly). */
  period: string;
  amount: number;
  date: string;
  txId?: string;
}

export interface Bill {
  id: string;
  name: string;
  /** Usual amount (minor units), 0 = it varies. */
  amount: number;
  category: string;
  accountId?: string;
  freq: BillFreq;
  /** Day of the month it is due (1–31; short months use their last day). */
  day: number;
  /** Yearly bills: the month (1–12). */
  month?: number;
  /** Reminder at 09:00 on the due day (and the day before). */
  remind: boolean;
  paid: BillPaid[];
  createdAt: string;
  updatedAt: string;
}

export type BillInput = Omit<Bill, 'id' | 'createdAt' | 'updatedAt' | 'paid'> & { id?: string };

const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
const pad = (n: number) => String(n).padStart(2, '0');

export const billPeriod = (b: Pick<Bill, 'freq'>, day: string) => (b.freq === 'yearly' ? day.slice(0, 4) : day.slice(0, 7));

/** Due day of a period. */
export function billDue(b: Pick<Bill, 'freq' | 'day' | 'month'>, period: string): string {
  const y = Number(period.slice(0, 4));
  const m = b.freq === 'yearly' ? (b.month ?? 1) : Number(period.slice(5, 7));
  return `${y}-${pad(m)}-${pad(Math.min(b.day, lastDay(y, m)))}`;
}

export const nextPeriod = (b: Pick<Bill, 'freq'>, period: string) => (b.freq === 'yearly' ? String(Number(period) + 1) : addMonths(period, 1));

export const billIsPaid = (b: Pick<Bill, 'paid'>, period: string) => b.paid.some((p) => p.period === period);

export interface BillStatus {
  bill: Bill;
  period: string;
  due: string;
  state: 'paid' | 'overdue' | 'today' | 'soon' | 'later';
  /** Whole days until due (negative = overdue). */
  days: number;
  paid?: BillPaid;
}

/** Each bill's current period: the earliest unpaid one up to this period, else this period. */
export function billStatus(b: Bill, today: string): BillStatus {
  const nowPeriod = billPeriod(b, today);
  // Overdue: last period unpaid (only one back, so old bills don't pile up).
  const prev = b.freq === 'yearly' ? String(Number(nowPeriod) - 1) : addMonths(nowPeriod, -1);
  const made = b.createdAt.slice(0, 10);
  const prevDue = billDue(b, prev);
  let period = !billIsPaid(b, prev) && prevDue >= made && prevDue < today ? prev : nowPeriod;
  // Added after this period's due day: it starts with the next one.
  if (period === nowPeriod && !billIsPaid(b, period) && billDue(b, period) < made) period = nextPeriod(b, period);
  const due = billDue(b, period);
  const days = Math.round((parseDay(due).getTime() - parseDay(today).getTime()) / DAY);
  const paid = b.paid.find((p) => p.period === period);
  const state = paid ? 'paid' : days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 3 ? 'soon' : 'later';
  return { bill: b, period, due, state, days, ...(paid ? { paid } : {}) };
}

const ORDER = { overdue: 0, today: 1, soon: 2, later: 3, paid: 4 } as const;
export const billsInOrder = (bills: readonly Bill[], today: string) =>
  bills.map((b) => billStatus(b, today)).sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.due.localeCompare(b.due));

/** This month's bills: total (paid amount or usual amount) and still to pay. */
export function billsMonth(bills: readonly Bill[], today: string): { total: number; left: number } {
  let total = 0;
  let left = 0;
  const month = today.slice(0, 7);
  for (const b of bills) {
    if (b.freq === 'yearly' && billDue(b, today.slice(0, 4)).slice(0, 7) !== month) continue;
    const period = billPeriod(b, today);
    const paid = b.paid.find((p) => p.period === period);
    if (!paid && billDue(b, period) < b.createdAt.slice(0, 10)) continue; // starts next time
    total += paid ? paid.amount : b.amount;
    if (!paid) left += b.amount;
  }
  return { total, left };
}

/** Last amount paid for a bill (to suggest this time). */
export const billLastAmount = (b: Bill) => [...b.paid].sort((x, y) => y.date.localeCompare(x.date))[0]?.amount ?? b.amount;

// ----------------------------------------------------------------- goals --

export interface GoalMove {
  date: string;
  /** + into the goal, − taken out (minor units). */
  amount: number;
  accountId?: string;
  note: string;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  /** Target day ('' = no deadline). */
  by: string;
  moves: GoalMove[];
  createdAt: string;
  updatedAt: string;
}

export type GoalInput = Omit<Goal, 'id' | 'createdAt' | 'updatedAt' | 'moves'> & { id?: string };

export const goalSaved = (g: Pick<Goal, 'moves'>) => Math.max(0, g.moves.reduce((a, m) => a + m.amount, 0));

export interface GoalPlan {
  saved: number;
  left: number;
  pct: number;
  weeksLeft: number | null;
  /** Needed per week to make the deadline (null = no deadline / done). */
  perWeek: number | null;
  state: 'done' | 'onTrack' | 'behind' | 'late' | 'open';
}

export function goalPlan(g: Goal, today: string): GoalPlan {
  const saved = goalSaved(g);
  const left = Math.max(0, g.target - saved);
  const pct = g.target > 0 ? Math.min(1, saved / g.target) : 0;
  if (left === 0) return { saved, left, pct, weeksLeft: null, perWeek: null, state: 'done' };
  if (!g.by) return { saved, left, pct, weeksLeft: null, perWeek: null, state: 'open' };
  const days = Math.round((parseDay(g.by).getTime() - parseDay(today).getTime()) / DAY);
  if (days < 0) return { saved, left, pct, weeksLeft: 0, perWeek: null, state: 'late' };
  const weeksLeft = Math.max(1, Math.ceil(days / 7));
  const perWeek = Math.ceil(left / weeksLeft / 100) * 100;
  // On track: saved at least what an even pace from the start would have by now.
  const start = parseDay(g.createdAt.slice(0, 10)).getTime();
  const total = Math.max(1, parseDay(g.by).getTime() - start);
  const expected = g.target * Math.min(1, Math.max(0, (parseDay(today).getTime() - start) / total));
  return { saved, left, pct, weeksLeft, perWeek, state: saved + 1 >= expected ? 'onTrack' : 'behind' };
}

/** Money moved into goals comes out of its account; taking it out puts it back. */
export const goalAccountMoves = (goals: readonly Goal[]) =>
  goals.flatMap((g) => g.moves.filter((m) => m.accountId).map((m) => ({ accountId: m.accountId!, amount: -m.amount })));

// ------------------------------------------------------------ reminders --

/** Phone / desktop notifications for bills and utang due days (09:00). */
export function planNotifications(
  bills: readonly Bill[],
  debts: readonly Debt[],
  now: number,
  opts: { preview: boolean; sound: boolean; currency: string }
): { id: number; at: number; title: string; body: string; kind: 'calendar'; silent: boolean }[] {
  const out: { id: number; at: number; title: string; body: string; kind: 'calendar'; silent: boolean }[] = [];
  const at9 = (day: string, back = 0) => parseDay(day).getTime() + 9 * 3600_000 - back * DAY;
  const money = (v: number) => formatMoney(v, opts.currency);
  const today = dayKey(new Date(now));
  for (const b of bills) {
    if (!b.remind) continue;
    for (const period of [billPeriod(b, today), b.freq === 'yearly' ? String(Number(today.slice(0, 4)) + 1) : addMonths(today.slice(0, 7), 1)]) {
      if (billIsPaid(b, period)) continue;
      const due = billDue(b, period);
      for (const back of [1, 0]) {
        const at = at9(due, back);
        if (at <= now || at > now + 45 * DAY) continue;
        out.push({
          id: hashId(`bill|${b.id}|${period}|${back}`),
          at,
          title: opts.preview ? `${b.name} ${back ? 'is due tomorrow' : 'is due today'}` : 'VaultLocks bill reminder',
          body: opts.preview ? (b.amount ? `About ${money(b.amount)}. Open VaultLocks to mark it paid.` : 'Open VaultLocks to mark it paid.') : 'A bill is due. Open VaultLocks to see it.',
          kind: 'calendar',
          silent: !opts.sound
        });
      }
    }
  }
  for (const d of debts) {
    if (!d.due || debtSettled(d)) continue;
    const at = at9(d.due);
    if (at <= now || at > now + 60 * DAY) continue;
    const left = money(debtLeft(d));
    out.push({
      id: hashId(`debt|${d.id}|${d.due}`),
      at,
      title: opts.preview ? (d.direction === 'owedToMe' ? `Collect ${left} from ${d.person}` : `Pay back ${d.person}: ${left}`) : 'VaultLocks utang reminder',
      body: opts.preview ? d.note || 'Open VaultLocks to mark it paid.' : 'Open VaultLocks to see it.',
      kind: 'calendar',
      silent: !opts.sound
    });
  }
  return out.sort((a, b) => a.at - b.at);
}
