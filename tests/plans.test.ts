// Money plans: budgets per category, utang, repeating bills, savings goals and the monthly report.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validatePayload } from '../src/core/schema';
import { VaultService } from '../src/main/vault/vaultService';
import { balances, type Transaction } from '../src/shared/money';
import { billDue, billStatus, billsMonth, budgetNudge, budgetRows, debtLeft, debtTotals, goalAccountMoves, goalPlan, planNotifications, type Bill, type Debt, type Goal } from '../src/shared/plans';
import { monthReport, reportPdf } from '../src/shared/report';

const PW = 'Plans-Test-Master-Pass-2026!';
let n = 0;
const tx = (amount: number, category: string, date: string, kind: 'expense' | 'income' = 'expense'): Transaction => ({ id: `t${++n}`, kind, amount, category, note: category, date, createdAt: '', updatedAt: '' });

describe('budgets', () => {
  it('rows per category, coffee from the coffee budget, near / over states', () => {
    const list = [tx(256000, 'food', '2026-10-10'), tx(272000, 'coffee', '2026-10-12'), tx(64000, 'transport', '2026-10-01'), tx(99999, 'food', '2026-09-30')];
    const rows = budgetRows(list, '2026-10', { coffeeBudget: 250000, categoryBudgets: { food: 300000, transport: 150000 } });
    expect(rows.map((r) => [r.category, r.spent, r.state])).toEqual([
      ['coffee', 272000, 'over'],
      ['food', 256000, 'near'],
      ['transport', 64000, 'ok']
    ]);
  });
  it('heads-up once at 80 % and once over', () => {
    expect(budgetNudge(200000, 50000, 300000)).toBe('near');
    expect(budgetNudge(250000, 10000, 300000)).toBeNull();
    expect(budgetNudge(290000, 20000, 300000)).toBe('over');
    expect(budgetNudge(0, 100, 0)).toBeNull();
  });
});

describe('bills', () => {
  const bill = (o: Partial<Bill> = {}): Bill => ({ id: 'b', name: 'Meralco', amount: 145000, category: 'bills', freq: 'monthly', day: 15, remind: true, paid: [], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '', ...o });
  it('due days clamp to short months; yearly bills use their month', () => {
    expect(billDue(bill({ day: 31 }), '2026-02')).toBe('2026-02-28');
    expect(billDue(bill({ freq: 'yearly', month: 3, day: 10 }), '2027')).toBe('2027-03-10');
  });
  it('states: overdue from last month, today, soon, paid', () => {
    const oct = { createdAt: '2026-10-01T00:00:00.000Z' };
    expect(billStatus(bill(oct), '2026-10-25')).toMatchObject({ period: '2026-10', state: 'overdue', days: -10 });
    expect(billStatus(bill(oct), '2026-10-15').state).toBe('today');
    expect(billStatus(bill(oct), '2026-10-13')).toMatchObject({ state: 'soon', days: 2 });
    // Added in September and never paid: September shows (overdue) first.
    expect(billStatus(bill(), '2026-10-25')).toMatchObject({ period: '2026-09', state: 'overdue' });
    const paid = bill({ ...oct, paid: [{ period: '2026-10', amount: 151200, date: '2026-10-15' }] });
    expect(billStatus(paid, '2026-10-25').state).toBe('paid');
    // Last month unpaid shows first (one back only).
    expect(billStatus(bill({ day: 5 }), '2026-10-03')).toMatchObject({ period: '2026-09', state: 'overdue' });
    // Added after this month's due day: starts next month.
    expect(billStatus(bill({ day: 2, createdAt: '2026-10-25T00:00:00.000Z' }), '2026-10-25')).toMatchObject({ period: '2026-11', state: 'later', due: '2026-11-02' });
    expect(billsMonth([bill({ day: 2, createdAt: '2026-10-25T00:00:00.000Z' })], '2026-10-25')).toEqual({ total: 0, left: 0 });
    // Not before the bill was added.
    expect(billStatus(bill({ day: 5, createdAt: '2026-10-01T00:00:00.000Z' }), '2026-10-03')).toMatchObject({ period: '2026-10', state: 'soon' });
  });
  it('month totals and reminders', () => {
    const list = [bill(), bill({ id: 'r', name: 'Rent', amount: 500000, day: 5, paid: [{ period: '2026-10', amount: 500000, date: '2026-10-05' }] })];
    expect(billsMonth(list, '2026-10-10')).toEqual({ total: 645000, left: 145000 });
    const now = new Date(2026, 9, 13, 12).getTime();
    const rem = planNotifications(list, [], now, { preview: true, sound: true, currency: 'PHP' });
    expect(rem.map((r) => r.title)).toEqual(['Meralco is due tomorrow', 'Meralco is due today', 'Rent is due tomorrow', 'Rent is due today', 'Meralco is due tomorrow', 'Meralco is due today']);
    expect(planNotifications(list, [], now, { preview: false, sound: true, currency: 'PHP' })[0]!.title).toBe('VaultLocks bill reminder');
  });
});

describe('utang', () => {
  const debt = (o: Partial<Debt> = {}): Debt => ({ id: 'd', person: 'Ana', direction: 'owedToMe', amount: 50000, note: 'Lunch', date: '2026-10-20', due: '', payments: [], createdAt: '', updatedAt: '', ...o });
  it('left, totals by direction and people', () => {
    expect(debtLeft(debt({ payments: [{ date: '2026-10-21', amount: 20000 }] }))).toBe(30000);
    const t = debtTotals([debt(), debt({ id: 'e', person: 'ana', amount: 10000 }), debt({ id: 'f', person: 'Kuya', direction: 'iOwe', amount: 20000 }), debt({ id: 'g', payments: [{ date: '2026-10-21', amount: 50000 }] })]);
    expect(t).toEqual({ owedToMe: 60000, iOwe: 20000, peopleOwing: 1, peopleOwed: 1 });
  });
});

describe('goals', () => {
  const goal = (o: Partial<Goal> = {}): Goal => ({ id: 'g', name: 'New phone', target: 2500000, by: '2027-03-31', moves: [{ date: '2026-10-01', amount: 1550000, note: '' }], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '', ...o });
  it('weekly target and state', () => {
    const p = goalPlan(goal(), '2026-10-25');
    expect(p).toMatchObject({ saved: 1550000, left: 950000, weeksLeft: 23, state: 'onTrack' });
    expect(p.perWeek).toBe(41400);
    expect(goalPlan(goal({ moves: [] }), '2026-12-25').state).toBe('behind');
    expect(goalPlan(goal({ moves: [{ date: '2026-10-01', amount: 2500000, note: '' }] }), '2026-10-25').state).toBe('done');
    expect(goalPlan(goal({ by: '' }), '2026-10-25')).toMatchObject({ state: 'open', perWeek: null });
  });
  it('money moved into a goal leaves its account (not spending)', () => {
    const g = goal({ moves: [{ date: '2026-10-01', amount: 100000, note: '', accountId: 'gcash' }, { date: '2026-10-05', amount: -20000, note: '', accountId: 'gcash' }] });
    const b = balances([{ id: 'gcash', name: 'GCash', kind: 'ewallet', opening: 500000 }], [], goalAccountMoves([g]));
    expect(b.get('gcash')).toBe(420000);
  });
});

describe('monthly report', () => {
  it('numbers and a valid one-page PDF without secrets or ₱', () => {
    const list = [tx(500000, 'housing', '2026-10-05'), tx(145000, 'bills', '2026-10-15'), tx(2000000, 'salary', '2026-10-01', 'income'), tx(1260000, 'food', '2026-09-10')];
    const r = monthReport(list, '2026-10');
    expect(r).toMatchObject({ spent: 645000, income: 2000000, saved: 1355000, prevSpent: 1260000 });
    expect(r.byCategory.map((c) => c.category)).toEqual(['housing', 'bills']);
    expect(r.sixMonths.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    const pdf = Buffer.from(reportPdf(r, 'PHP')).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('PHP 6,450');
    expect(pdf).not.toContain('₱');
    // xref offsets point at the objects
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const first = Number(/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/.exec(pdf)![1]);
    expect(pdf.slice(first, first + 7)).toBe('1 0 obj');
  });
});

describe('vault storage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-plans-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('utang, bills and goals are encrypted, update Expenses, and survive locking', async () => {
    const file = path.join(dir, 'vault', 'vault.vault');
    const v = new VaultService(file);
    await v.create(PW, null);
    const d = await v.saveDebt({ person: 'Secret Ana', direction: 'owedToMe', amount: 50000, note: 'Lunch', date: '2026-10-20', due: '2026-10-30' });
    await v.payDebt(d.id, { amount: 20000, date: '2026-10-22', accountId: 'gcash' });
    await expect(v.payDebt(d.id, { amount: 90000, date: '2026-10-22' })).rejects.toMatchObject({ code: 'INVALID' });
    const b = await v.saveBill({ name: 'Meralco', amount: 145000, category: 'bills', freq: 'monthly', day: 15, remind: true, accountId: 'bank' });
    const paid = await v.payBill(b.id, { period: '2026-10', amount: 151200, date: '2026-10-15', accountId: 'bank' });
    expect(paid.transaction).toMatchObject({ kind: 'expense', amount: 151200, category: 'bills', note: 'Meralco', accountId: 'bank' });
    await expect(v.payBill(b.id, { period: '2026-10', amount: 1, date: '2026-10-15' })).rejects.toMatchObject({ code: 'INVALID' });
    const g = await v.saveGoal({ name: 'New phone', target: 2500000, by: '2027-03-31' });
    await v.moveGoal(g.id, { amount: 100000, date: '2026-10-24', accountId: 'gcash', note: '' });
    await expect(v.moveGoal(g.id, { amount: -900000, date: '2026-10-24', note: '' })).rejects.toMatchObject({ code: 'INVALID' });
    await v.updateSettings({ categoryBudgets: { food: 300000, nope: -1 } });

    let s = v.snapshot();
    expect(s.transactions.map((t) => [t.kind, t.amount, t.note])).toEqual([
      ['income', 20000, 'Secret Ana paid back · Lunch'],
      ['expense', 151200, 'Meralco']
    ]);
    expect(debtLeft(s.debts[0]!)).toBe(30000);
    expect(s.settings.categoryBudgets).toEqual({ food: 300000 });
    expect(await fs.readFile(file, 'utf8')).not.toContain('Secret Ana');

    v.lock();
    await v.unlock(PW);
    s = v.snapshot();
    expect([s.debts.length, s.bills.length, s.goals.length]).toEqual([1, 1, 1]);
    expect(s.goals[0]!.moves).toHaveLength(1);

    await v.unpayBill(b.id, '2026-10');
    expect(v.snapshot().transactions.map((t) => t.note)).toEqual(['Secret Ana paid back · Lunch']);
    await v.deleteDebt(d.id);
    await v.deleteBill(b.id);
    await v.deleteGoal(g.id);
    expect([v.snapshot().debts.length, v.snapshot().bills.length, v.snapshot().goals.length]).toEqual([0, 0, 0]);
  });

  it('older vaults have no plans; damaged records are skipped', () => {
    const base = { schema: 1, entries: [], settings: {}, transactions: [], accounts: [] };
    expect(validatePayload(base)).toMatchObject({ debts: [], bills: [], goals: [] });
    const p = validatePayload({ ...base, debts: [{ id: 'a', person: 'Ana', amount: 100, direction: 'owedToMe' }, { id: 'b', person: '', amount: 100 }], bills: [{ id: 'c', name: 'Water', amount: 0, day: 40 }], goals: [{ id: 'g', name: 'Trip', target: 1000, moves: [{ date: '2026-10-01', amount: 100 }, { date: 'x', amount: 5 }] }] });
    expect(p.debts.map((d) => d.id)).toEqual(['a']);
    expect(p.bills).toEqual([]);
    expect(p.goals[0]!.moves).toHaveLength(1);
  });
});
