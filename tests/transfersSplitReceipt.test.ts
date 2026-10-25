// Receipt scan, transfers between accounts and split bills.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validatePayload } from '../src/core/schema';
import { VaultService } from '../src/main/vault/vaultService';
import { balances } from '../src/shared/money';
import { accountMoves, debtLeft, equalShares } from '../src/shared/plans';
import { parseReceipt } from '../src/shared/scan';

const PW = 'Transfer-Split-Test-Pass-2026!';
const NOW = new Date('2026-10-25T12:00:00Z');
const accounts = [
  { id: 'cash', name: 'Cash' },
  { id: 'gcash', name: 'GCash' },
  { id: 'maya', name: 'Maya' }
];

describe('receipts', () => {
  it('fast food receipt: total line, brand, date, paid with GCash', () => {
    const r = parseReceipt(['JOLLIBEE', 'SM City Davao', 'VAT REG TIN 000-123-456-000', '10/25/2026 12:41 PM', '1 Chickenjoy C1 129.00', '1 Jolly Spaghetti 70.00', 'SUBTOTAL 199.00', 'VATable Sales 177.68', 'TOTAL 254.00', 'GCASH 254.00', 'CHANGE 0.00'], accounts, NOW);
    expect(r).toMatchObject({ amount: 25400, store: 'Jollibee', date: '2026-10-25', accountId: 'gcash' });
  });
  it('amount on the next line, commas, "AMOUNT DUE"', () => {
    const r = parseReceipt(['PUREGOLD PRICE CLUB', 'OFFICIAL RECEIPT', 'Oct 18, 2026', 'Sub-Total', '1,190.50', 'AMOUNT DUE', '₱1,200.00', 'CASH 1,500.00', 'CHANGE 300.00'], accounts, NOW);
    expect(r).toMatchObject({ amount: 120000, store: 'Puregold Price Club', date: '2026-10-18', accountId: 'cash' });
  });
  it('no total label: the largest amount (not change); future "valid until" dates ignored', () => {
    const r = parseReceipt(['Kape Tayo', 'Iced latte 120.00', 'Ensaymada 65.00', '185.00', 'Valid until 10/25/2031', '10/24/2026'], accounts, NOW);
    expect(r).toMatchObject({ amount: 18500, store: 'Kape Tayo', date: '2026-10-24' });
    expect(r.accountId).toBeUndefined();
  });
  it('nothing readable', () => {
    expect(parseReceipt(['', '###'], accounts, NOW)).toMatchObject({ amount: null, store: '', date: '' });
  });
});

describe('shares', () => {
  it('splits equally, leftover centavos to the first shares', () => {
    expect(equalShares(180000, 4)).toEqual([45000, 45000, 45000, 45000]);
    expect(equalShares(100, 3)).toEqual([34, 33, 33]);
    expect(equalShares(100, 0)).toEqual([]);
  });
});

describe('vault: transfers and split bills', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-transfer-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('a transfer moves balances without spending; its fee is an expense; delete undoes both', async () => {
    const file = path.join(dir, 'vault', 'vault.vault');
    const v = new VaultService(file);
    await v.create(PW, null);
    await v.saveTransaction({ kind: 'income', amount: 524000, category: 'topup', note: 'Cash in', date: '2026-10-01', accountId: 'gcash' });
    const t = await v.saveTransfer({ from: 'gcash', to: 'bank', amount: 200000, fee: 1500, note: 'Secret savings', date: '2026-10-25' });
    let s = v.snapshot();
    let b = balances(s.accounts, s.transactions, accountMoves(s));
    expect([b.get('gcash'), b.get('bank')]).toEqual([524000 - 200000 - 1500, 200000]);
    expect(s.transactions.filter((x) => x.kind === 'expense').map((x) => [x.amount, x.note])).toEqual([[1500, 'Transfer fee · GCash → Bank']]);
    await expect(v.saveTransfer({ from: 'gcash', to: 'gcash', amount: 1, fee: 0, note: '', date: '2026-10-25' })).rejects.toBeTruthy();
    expect(await fs.readFile(file, 'utf8')).not.toContain('Secret savings');

    // Edit: fee removed, amount changed.
    await v.saveTransfer({ id: t.id, from: 'gcash', to: 'bank', amount: 100000, fee: 0, note: '', date: '2026-10-25' });
    s = v.snapshot();
    expect(s.transactions.filter((x) => x.kind === 'expense')).toEqual([]);
    b = balances(s.accounts, s.transactions, accountMoves(s));
    expect([b.get('gcash'), b.get('bank')]).toEqual([424000, 100000]);

    v.lock();
    await v.unlock(PW);
    expect(v.snapshot().transfers).toHaveLength(1);
    await v.deleteTransfer(t.id);
    s = v.snapshot();
    b = balances(s.accounts, s.transactions, accountMoves(s));
    expect([b.get('gcash'), b.get('bank'), s.transfers.length]).toEqual([524000, 0, 0]);
  });

  it('split bill: my share is an expense, others are utang lent from the account; paying back refills it', async () => {
    const v = new VaultService(path.join(dir, 'vault', 'vault.vault'));
    await v.create(PW, null);
    await v.saveTransaction({ kind: 'income', amount: 500000, category: 'topup', note: 'Cash in', date: '2026-10-01', accountId: 'gcash' });
    const r = await v.splitBill({ total: 180000, note: 'Dinner', date: '2026-10-25', category: 'food', accountId: 'gcash', mine: 45000, people: [{ person: 'Ana', amount: 45000 }, { person: 'Jun', amount: 45000 }, { person: 'Mika', amount: 45000 }], due: '2026-10-30' });
    expect(r.transaction).toMatchObject({ kind: 'expense', amount: 45000, category: 'food', note: 'Dinner', accountId: 'gcash' });
    expect(r.debts.map((d) => [d.person, d.amount, d.accountId, d.due, d.note])).toEqual([
      ['Ana', 45000, 'gcash', '2026-10-30', 'Dinner (split)'],
      ['Jun', 45000, 'gcash', '2026-10-30', 'Dinner (split)'],
      ['Mika', 45000, 'gcash', '2026-10-30', 'Dinner (split)']
    ]);
    let s = v.snapshot();
    let b = balances(s.accounts, s.transactions, accountMoves(s));
    expect(b.get('gcash')).toBe(500000 - 180000);

    // Ana pays back into GCash: the balance goes back up, and it is not income.
    await v.payDebt(r.debts[0]!.id, { amount: 45000, date: '2026-10-26', accountId: 'gcash' });
    s = v.snapshot();
    b = balances(s.accounts, s.transactions, accountMoves(s));
    expect(b.get('gcash')).toBe(500000 - 135000);
    expect(s.transactions.filter((t) => t.kind === 'income')).toHaveLength(1);
    expect(debtLeft(s.debts[0]!)).toBe(0);

    await expect(v.splitBill({ total: 1000, note: '', date: '2026-10-25', category: 'food', mine: 100, people: [{ person: 'A', amount: 100 }], due: '' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(v.splitBill({ total: 1000, note: '', date: '2026-10-25', category: 'food', mine: 1000, people: [], due: '' })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('older vaults have no transfers; damaged ones are skipped', () => {
    const base = { schema: 1, entries: [], settings: {}, transactions: [], accounts: [] };
    expect(validatePayload(base).transfers).toEqual([]);
    expect(validatePayload({ ...base, transfers: [{ id: 'a', from: 'cash', to: 'gcash', amount: 100, date: '2026-10-01' }, { id: 'b', from: 'cash', to: 'cash', amount: 100 }] }).transfers.map((t) => t.id)).toEqual(['a']);
  });
});
