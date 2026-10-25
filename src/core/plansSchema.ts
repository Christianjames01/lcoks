// Validation for money plans (utang, bills, savings goals) — input from the
// renderer and records read back from the decrypted payload.

import { MAX_AMOUNT, isDayKey } from '../shared/money';
import type { Bill, BillInput, BillPaid, Debt, DebtInput, DebtPayment, Goal, GoalInput, GoalMove } from '../shared/plans';
import { ValidationError } from './schema';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isAmount = (v: unknown, allowZero = false): v is number => Number.isInteger(v) && (v as number) >= (allowZero ? 0 : 1) && (v as number) <= MAX_AMOUNT;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const optId = (v: unknown) => (typeof v === 'string' && ID_RE.test(v) ? v : undefined);
const iso = (v: unknown, fallback: string) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback);

export const LIMITS_PLANS = { debts: 2000, bills: 200, goals: 100, payments: 500 } as const;

function idOf(i: Record<string, unknown>): string | undefined {
  if (i.id === undefined || i.id === null) return undefined;
  if (typeof i.id !== 'string' || !ID_RE.test(i.id)) throw new ValidationError('id', 'Invalid record.');
  return i.id;
}

export function validateDebtInput(input: unknown): DebtInput {
  if (!input || typeof input !== 'object') throw new ValidationError('form', 'Invalid utang.');
  const i = input as Record<string, unknown>;
  const person = text(i.person, 60);
  if (!person) throw new ValidationError('person', 'Who is it with?');
  if (!isAmount(i.amount)) throw new ValidationError('amount', 'Enter an amount.');
  return {
    ...(idOf(i) ? { id: idOf(i) } : {}),
    person,
    direction: i.direction === 'iOwe' ? 'iOwe' : 'owedToMe',
    amount: i.amount,
    note: text(i.note, 120),
    date: isDayKey(i.date) ? i.date : new Date().toISOString().slice(0, 10),
    due: isDayKey(i.due) ? i.due : ''
  };
}

const payment = (p: unknown): DebtPayment | null => {
  if (!p || typeof p !== 'object') return null;
  const r = p as Record<string, unknown>;
  if (!isAmount(r.amount) || !isDayKey(r.date)) return null;
  const accountId = optId(r.accountId);
  return { date: r.date, amount: r.amount, ...(accountId ? { accountId } : {}) };
};

export function validateDebt(raw: unknown, now: string): Debt | null {
  try {
    const v = validateDebtInput(raw);
    const r = raw as Record<string, unknown>;
    if (!v.id) return null;
    const payments = (Array.isArray(r.payments) ? r.payments : []).map(payment).filter((p): p is DebtPayment => !!p).slice(0, LIMITS_PLANS.payments);
    return { ...v, id: v.id, payments, createdAt: iso(r.createdAt, now), updatedAt: iso(r.updatedAt, now) };
  } catch {
    return null;
  }
}

export function validateBillInput(input: unknown): BillInput {
  if (!input || typeof input !== 'object') throw new ValidationError('form', 'Invalid bill.');
  const i = input as Record<string, unknown>;
  const name = text(i.name, 60);
  if (!name) throw new ValidationError('name', 'Give the bill a name, e.g. Meralco.');
  if (!isAmount(i.amount, true)) throw new ValidationError('amount', 'Enter the usual amount, or 0 if it changes.');
  const day = Number(i.day);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new ValidationError('day', 'Pick the day it is due (1–31).');
  const freq = i.freq === 'yearly' ? 'yearly' : 'monthly';
  const month = Number(i.month);
  const accountId = optId(i.accountId);
  return {
    ...(idOf(i) ? { id: idOf(i) } : {}),
    name,
    amount: i.amount,
    category: typeof i.category === 'string' && ID_RE.test(i.category) ? i.category : 'bills',
    ...(accountId ? { accountId } : {}),
    freq,
    day,
    ...(freq === 'yearly' ? { month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1 } : {}),
    remind: i.remind !== false
  };
}

export function validateBill(raw: unknown, now: string): Bill | null {
  try {
    const v = validateBillInput(raw);
    const r = raw as Record<string, unknown>;
    if (!v.id) return null;
    const paid: BillPaid[] = [];
    for (const p of Array.isArray(r.paid) ? r.paid.slice(0, LIMITS_PLANS.payments) : []) {
      if (!p || typeof p !== 'object') continue;
      const q = p as Record<string, unknown>;
      if (typeof q.period !== 'string' || !/^\d{4}(-\d{2})?$/.test(q.period) || !isAmount(q.amount, true) || !isDayKey(q.date)) continue;
      const txId = optId(q.txId);
      paid.push({ period: q.period, amount: q.amount, date: q.date, ...(txId ? { txId } : {}) });
    }
    return { ...v, id: v.id, paid, createdAt: iso(r.createdAt, now), updatedAt: iso(r.updatedAt, now) };
  } catch {
    return null;
  }
}

export function validateGoalInput(input: unknown): GoalInput {
  if (!input || typeof input !== 'object') throw new ValidationError('form', 'Invalid goal.');
  const i = input as Record<string, unknown>;
  const name = text(i.name, 60);
  if (!name) throw new ValidationError('name', 'What are you saving for?');
  if (!isAmount(i.target)) throw new ValidationError('target', 'Enter how much you want to save.');
  return { ...(idOf(i) ? { id: idOf(i) } : {}), name, target: i.target, by: isDayKey(i.by) ? i.by : '' };
}

export function validateGoal(raw: unknown, now: string): Goal | null {
  try {
    const v = validateGoalInput(raw);
    const r = raw as Record<string, unknown>;
    if (!v.id) return null;
    const moves: GoalMove[] = [];
    for (const m of Array.isArray(r.moves) ? r.moves.slice(0, LIMITS_PLANS.payments) : []) {
      if (!m || typeof m !== 'object') continue;
      const q = m as Record<string, unknown>;
      if (!Number.isInteger(q.amount) || q.amount === 0 || Math.abs(q.amount as number) > MAX_AMOUNT || !isDayKey(q.date)) continue;
      const accountId = optId(q.accountId);
      moves.push({ date: q.date, amount: q.amount as number, note: text(q.note, 80), ...(accountId ? { accountId } : {}) });
    }
    return { ...v, id: v.id, moves, createdAt: iso(r.createdAt, now), updatedAt: iso(r.updatedAt, now) };
  } catch {
    return null;
  }
}

/** Settings: per-category budgets. */
export function validateCategoryBudgets(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>).slice(0, 80)) if (ID_RE.test(k) && isAmount(n)) out[k] = n;
  return out;
}
