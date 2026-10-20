// Expense tracking: quick-entry parsing, validation and encrypted storage in the vault.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validatePayload, validateTransactionInput } from '../src/core/schema';
import { VaultService } from '../src/main/vault/vaultService';
import { addMonths, balances, dayKey, isDayKey, parseQuick, totals } from '../src/shared/money';

const PW = 'Money-Test-Master-Pass-2026!';
const TODAY = new Date(2026, 9, 20, 9);

describe('quick entry', () => {
  it('reads amount, category and note', () => {
    expect(parseQuick('lunch 150', TODAY)).toEqual({ kind: 'expense', amount: 15000, category: 'food', note: 'Lunch', date: '2026-10-20' });
    expect(parseQuick('Grab 85.50', TODAY)).toMatchObject({ amount: 8550, category: 'transport', note: 'Grab' });
    expect(parseQuick('₱1,250 meralco', TODAY)).toMatchObject({ amount: 125000, category: 'bills' });
  });

  it('understands income, k suffix, + sign and yesterday', () => {
    expect(parseQuick('salary 30k', TODAY)).toMatchObject({ kind: 'income', amount: 3_000_000, category: 'salary' });
    expect(parseQuick('+500 refund', TODAY)).toMatchObject({ kind: 'income', amount: 50000, category: 'other-income' });
    expect(parseQuick('coffee 120 yesterday', TODAY)).toMatchObject({ date: '2026-10-19', note: 'Coffee' });
  });

  it('falls back to Other and rejects text without an amount', () => {
    expect(parseQuick('stuff 99', TODAY)).toMatchObject({ category: 'other' });
    expect(parseQuick('lunch with friends', TODAY)).toBeNull();
    expect(parseQuick('lunch 0', TODAY)).toBeNull();
  });
});

describe('helpers', () => {
  it('dates and totals', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    const base = { id: 'x', category: 'food', note: '', date: '2026-10-01', createdAt: '', updatedAt: '' };
    expect(totals([{ ...base, kind: 'expense', amount: 300 }, { ...base, kind: 'income', amount: 1000 }])).toEqual({ expense: 300, income: 1000, net: 700 });
  });

  it('validation rejects bad amounts, dates and mismatched categories', () => {
    const ok = { kind: 'expense', amount: 100, category: 'food', note: 'x', date: '2026-10-20' };
    expect(validateTransactionInput(ok).category).toBe('food');
    expect(() => validateTransactionInput({ ...ok, amount: 1.5 })).toThrow();
    expect(() => validateTransactionInput({ ...ok, amount: -5 })).toThrow();
    expect(() => validateTransactionInput({ ...ok, date: '20-10-2026' })).toThrow();
    expect(validateTransactionInput({ ...ok, category: 'salary' }).category).toBe('other');
  });

  it('older vaults without transactions still load', () => {
    const p = validatePayload({ schema: 1, entries: [], settings: {}, meta: {} });
    expect(p.transactions).toEqual([]);
    expect(p.settings.currency).toBe('PHP');
  });
});

describe('vault storage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-money-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('saves, edits and deletes records inside the encrypted vault', async () => {
    const file = path.join(dir, 'vault', 'vault.vault');
    const v = new VaultService(file);
    await v.create(PW, null);
    const t = await v.saveTransaction({ kind: 'expense', amount: 15000, category: 'food', note: 'Secret lunch spot', date: '2026-10-20' });
    await v.saveTransaction({ ...t, amount: 18000 });
    expect(v.snapshot().transactions).toHaveLength(1);
    expect(v.snapshot().transactions[0]).toMatchObject({ amount: 18000, note: 'Secret lunch spot' });

    // Encrypted at rest; survives lock / unlock.
    expect(await fs.readFile(file, 'utf8')).not.toContain('Secret lunch spot');
    v.lock();
    expect(() => v.snapshot()).toThrow();
    await v.unlock(PW);
    expect(v.snapshot().transactions[0]!.amount).toBe(18000);

    await v.deleteTransaction(t.id);
    expect(v.snapshot().transactions).toHaveLength(0);
    await expect(v.deleteTransaction(t.id)).rejects.toThrow();
  });
});

describe('accounts', () => {
  const ACC = [
    { id: 'cash', name: 'Cash', kind: 'cash' as const, opening: 0 },
    { id: 'gcash', name: 'GCash', kind: 'ewallet' as const, opening: 100000 },
    { id: 'maya', name: 'Maya', kind: 'ewallet' as const, opening: 0 }
  ];

  it('quick entry picks the account and keeps it out of the note', () => {
    expect(parseQuick('grab 85 gcash', TODAY, ACC)).toMatchObject({ amount: 8500, category: 'transport', note: 'Grab', accountId: 'gcash' });
    expect(parseQuick('lunch 150 cash', TODAY, ACC)).toMatchObject({ accountId: 'cash', note: 'Lunch' });
    expect(parseQuick('cash in gcash 500', TODAY, ACC)).toMatchObject({ kind: 'income', category: 'topup', accountId: 'gcash', amount: 50000 });
    expect(parseQuick('top up maya 200', TODAY, ACC)).toMatchObject({ kind: 'income', category: 'topup', accountId: 'maya' });
    expect(parseQuick('lunch 150', TODAY, ACC)?.accountId).toBeUndefined();
  });

  it('balances = opening + money in − money out', () => {
    const t = (kind: 'expense' | 'income', amount: number, accountId?: string) => ({ id: String(amount), kind, amount, category: 'other', note: '', date: '2026-10-20', accountId, createdAt: '', updatedAt: '' });
    const b = balances(ACC, [t('expense', 15000, 'gcash'), t('income', 50000, 'gcash'), t('expense', 2000, 'cash'), t('expense', 999)]);
    expect(Object.fromEntries(b)).toEqual({ cash: -2000, gcash: 135000, maya: 0 });
  });

  it('older vaults get the default accounts', () => {
    const p = validatePayload({ schema: 1, entries: [], settings: {}, meta: {} });
    expect(p.accounts.map((a) => a.name)).toEqual(['Cash', 'GCash', 'Maya', 'Bank']);
  });
});
