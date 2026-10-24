// The user's own Expenses categories, and the coffee-break days.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateMoneyCategoryInput, validatePayload, validateTransactionInput } from '../src/core/schema';
import { VaultService } from '../src/main/vault/vaultService';
import { coffeeBreakEvent, describeDays } from '../src/shared/coffee';
import { allMoneyCategories, moneyCategory, parseQuick, type MoneyCategory } from '../src/shared/money';

const PW = 'Money-Cat-Test-Master-Pass-2026!';
const games: MoneyCategory = { id: 'mc-games', name: 'Games', kind: 'expense', icon: 'gamepad', words: ['ml', 'mobile legends', 'steam'] };

describe('custom categories (shared)', () => {
  it('quick entry uses their words first', () => {
    expect(parseQuick('ml 200', new Date(2026, 9, 24), [], [games])?.category).toBe('mc-games');
    expect(parseQuick('steam 499', new Date(2026, 9, 24), [], [games])?.category).toBe('mc-games');
    expect(parseQuick('lunch 150', new Date(2026, 9, 24), [], [games])?.category).toBe('food');
  });
  it('they list before Other, and look up by id', () => {
    const list = allMoneyCategories([games]).filter((c) => c.kind === 'expense').map((c) => c.id);
    expect(list.slice(-2)).toEqual(['mc-games', 'other']);
    expect(moneyCategory('mc-games', [games]).name).toBe('Games');
    expect(moneyCategory('mc-gone', [games]).id).toBe('other');
  });
  it('validation', () => {
    expect(validateMoneyCategoryInput({ name: '  GCash   cash out ', kind: 'expense', icon: 'cashout', words: ['Cashout', 'cash out', 'x', '50 off', 'cashout'] })).toEqual({ name: 'GCash cash out', kind: 'expense', icon: 'cashout', words: ['cashout', 'cash out'] });
    expect(validateMoneyCategoryInput({ name: 'X', icon: 'nope' }).icon).toBe('tag');
    expect(() => validateMoneyCategoryInput({ name: '' })).toThrow();
    expect(validateMoneyCategoryInput({ id: 'salary', name: 'Sweldo', kind: 'expense' })).toMatchObject({ id: 'salary', kind: 'income', icon: 'wallet' });
    expect(() => validateMoneyCategoryInput({ id: 'not-a-category', name: 'X' })).toThrow();
    expect(validateTransactionInput({ kind: 'expense', amount: 100, category: 'mc-games', note: '', date: '2026-10-24' }, [games]).category).toBe('mc-games');
    expect(validateTransactionInput({ kind: 'income', amount: 100, category: 'mc-games', note: '', date: '2026-10-24' }, [games]).category).toBe('other-income');
    expect(validateTransactionInput({ kind: 'expense', amount: 100, category: 'mc-games', note: '', date: '2026-10-24' }).category).toBe('other');
  });
});

describe('custom categories (vault)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-mcat-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('add, use, rename, survive lock, delete (records move to Other)', async () => {
    const file = path.join(dir, 'vault', 'vault.vault');
    const v = new VaultService(file);
    await v.create(PW, null);
    const c = await v.saveMoneyCategory({ name: 'Secret Games', kind: 'expense', icon: 'gamepad', words: ['ml'] });
    expect(c.id).toMatch(/^mc-/);
    await expect(v.saveMoneyCategory({ name: 'secret games', kind: 'expense', icon: 'tag', words: [] })).rejects.toMatchObject({ code: 'DUPLICATE' });
    await expect(v.saveMoneyCategory({ name: 'Food & Drinks', kind: 'expense', icon: 'tag', words: [] })).rejects.toMatchObject({ code: 'DUPLICATE' });
    const t = await v.saveTransaction({ kind: 'expense', amount: 20000, category: c.id, note: 'Diamonds', date: '2026-10-24' });
    expect(t.category).toBe(c.id);
    expect(await v.quickAdd('ml 50', '2026-10-24')).toEqual({ queued: false });
    expect(v.snapshot().transactions.filter((x) => x.category === c.id)).toHaveLength(2);
    await v.saveMoneyCategory({ id: c.id, name: 'Games', kind: 'income', icon: 'gamepad', words: ['ml', 'steam'] });
    expect(v.snapshot().moneyCategories[0]).toMatchObject({ name: 'Games', kind: 'expense', words: ['ml', 'steam'] });
    expect(await fs.readFile(file, 'utf8')).not.toContain('Secret Games');

    v.lock();
    await v.unlock(PW);
    expect(v.snapshot().moneyCategories.map((x) => x.name)).toEqual(['Games']);
    expect(v.snapshot().transactions.every((x) => x.category === c.id)).toBe(true);

    expect(await v.deleteMoneyCategory(c.id)).toBe(2);
    expect(v.snapshot().moneyCategories).toEqual([]);
    expect(v.snapshot().transactions.every((x) => x.category === 'other')).toBe(true);
  });

  it('older vaults have none; damaged ones are skipped', () => {
    const base = { schema: 1, entries: [], settings: {}, transactions: [], accounts: [] };
    expect(validatePayload(base).moneyCategories).toEqual([]);
    expect(validatePayload({ ...base, moneyCategories: [{ id: 'mc-a', name: 'A', kind: 'expense', icon: 'tag', words: [] }, { id: 'bad id', name: 'B' }, null] }).moneyCategories.map((c) => c.id)).toEqual(['mc-a']);
  });
});

describe('coffee break days', () => {
  it('any days and time; starts on a chosen day', () => {
    const e = coffeeBreakEvent(new Date(2026, 9, 24, 10), '09:30', [6, 0]); // Saturday
    expect(e).toMatchObject({ start: '2026-10-24', startTime: '09:30', endTime: '09:45', repeat: { weekdays: [0, 6] } });
    expect(coffeeBreakEvent(new Date(2026, 9, 24, 10), '15:00', [3]).start).toBe('2026-10-28');
    expect(coffeeBreakEvent(new Date(2026, 9, 24, 10), '15:00', []).repeat?.weekdays).toEqual([1, 2, 3, 4, 5]);
  });
  it('describes the days', () => {
    expect(describeDays([1, 2, 3, 4, 5])).toBe('weekdays');
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe('every day');
    expect(describeDays([6, 0])).toBe('weekends');
    expect(describeDays([1, 3, 5])).toBe('Mon, Wed, Fri');
  });
});

describe('editing and deleting built-in categories', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-mcat-b-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('rename keeps the id and records; delete hides it and moves records; restore brings it back', async () => {
    const v = new VaultService(path.join(dir, 'vault', 'vault.vault'));
    await v.create(PW, null);
    await v.saveTransaction({ kind: 'expense', amount: 15000, category: 'food', note: 'Lunch', date: '2026-10-24' });
    const c = await v.saveMoneyCategory({ id: 'food', name: 'Pagkain', kind: 'income', icon: 'tag', words: ['ulam', 'kain'] });
    expect(c).toMatchObject({ id: 'food', name: 'Pagkain', kind: 'expense', icon: 'tag' });
    expect(v.snapshot().transactions[0]!.category).toBe('food');
    expect(moneyCategory('food', [], v.snapshot().moneyCategoryEdits).name).toBe('Pagkain');
    expect(parseQuick('ulam 80', new Date(2026, 9, 24), [], [], v.snapshot().moneyCategoryEdits)?.category).toBe('food');

    expect(await v.deleteMoneyCategory('food')).toBe(1);
    const edits = v.snapshot().moneyCategoryEdits;
    expect(v.snapshot().transactions[0]!.category).toBe('other');
    expect(allMoneyCategories([], edits).some((x) => x.id === 'food')).toBe(false);
    expect(parseQuick('lunch 150', new Date(2026, 9, 24), [], [], edits)?.category).toBe('other');
    expect(validateTransactionInput({ kind: 'expense', amount: 100, category: 'food', note: '', date: '2026-10-24' }, [], edits).category).toBe('other');
    await expect(v.deleteMoneyCategory('other')).rejects.toMatchObject({ code: 'INVALID' });

    v.lock();
    await v.unlock(PW);
    expect(v.snapshot().moneyCategoryEdits.food).toMatchObject({ name: 'Pagkain', hidden: true });

    await v.restoreMoneyCategory('food');
    expect(v.snapshot().moneyCategoryEdits).toEqual({});
    expect(allMoneyCategories([], {}).find((x) => x.id === 'food')?.name).toBe('Food & Drinks');
  });

  it('a renamed built-in clashes like any other name; damaged edits are dropped', async () => {
    const v = new VaultService(path.join(dir, 'vault', 'vault.vault'));
    await v.create(PW, null);
    await expect(v.saveMoneyCategory({ id: 'food', name: 'Groceries', kind: 'expense', icon: 'food', words: [] })).rejects.toMatchObject({ code: 'DUPLICATE' });
    const base = { schema: 1, entries: [], settings: {}, transactions: [], accounts: [] };
    expect(validatePayload({ ...base, moneyCategoryEdits: { food: { name: 'X', hidden: true }, nope: { name: 'Y' }, other: { hidden: true } } }).moneyCategoryEdits).toEqual({ food: { name: 'X', hidden: true } });
  });
});

describe('saving a built-in unchanged', () => {
  it('leaves no edit behind', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-mcat-c-'));
    try {
      const v = new VaultService(path.join(dir, 'vault', 'vault.vault'));
      await v.create(PW, null);
      const housing = allMoneyCategories([], {}).find((c) => c.id === 'housing')!;
      await v.saveMoneyCategory({ id: 'housing', name: housing.name, kind: 'expense', icon: housing.icon, words: housing.words });
      expect(v.snapshot().moneyCategoryEdits).toEqual({});
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
