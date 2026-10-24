// Coffee corner: the Coffee category, "usual coffee", the budget nudge, the coffee-break event and loyalty cards.

import { describe, expect, it } from 'vitest';
import { validateSettings } from '../src/core/schema';
import { BUILTIN_CATEGORIES } from '../src/shared/categories';
import { occurrenceStarts } from '../src/shared/calendar';
import { COFFEE_BREAK_TITLE, DEFAULT_USUAL_COFFEE, coffeeBreakEvent, coffeeBudgetNudge, coffeeMonth, findCoffeeBreak, usualCoffee } from '../src/shared/coffee';
import { parseQuick, type Transaction } from '../src/shared/money';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { cardTheme } from '../src/shared/cards';

const TODAY = new Date(2026, 9, 20, 9);
let n = 0;
const tx = (amount: number, date: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  kind: 'expense',
  amount,
  category: 'coffee',
  note: 'Latte',
  date,
  createdAt: `2026-10-20T0${n % 10}:00:00.000Z`,
  updatedAt: '',
  ...extra
});

describe('coffee category', () => {
  it('quick entry picks Coffee for coffee words, Food for meals', () => {
    for (const t of ['coffee 120', 'latte 180', 'starbucks 210 gcash', 'kape 25', 'iced americano 150', 'cold brew 190'])
      expect(parseQuick(t, TODAY)?.category, t).toBe('coffee');
    expect(parseQuick('lunch 150', TODAY)?.category).toBe('food');
    expect(parseQuick('milktea 120', TODAY)?.category).toBe('food');
  });
});

describe('coffeeMonth', () => {
  it('counts cups, total and price per cup for the month only', () => {
    const list = [tx(12000, '2026-10-01'), tx(18000, '2026-10-05'), tx(15000, '2026-09-30'), tx(50000, '2026-10-02', { category: 'food' }), tx(9000, '2026-10-03', { kind: 'income' })];
    expect(coffeeMonth(list, '2026-10')).toEqual({ cups: 2, total: 30000, perCup: 15000 });
    expect(coffeeMonth([tx(12000, '2026-10-01'), tx(12000, '2026-10-02'), tx(18500, '2026-10-03')], '2026-10').perCup).toBe(14200);
    expect(coffeeMonth([], '2026-10')).toEqual({ cups: 0, total: 0, perCup: 0 });
  });
});

describe('usualCoffee', () => {
  it('defaults until a coffee is logged', () => {
    expect(usualCoffee([], TODAY)).toEqual({ amount: DEFAULT_USUAL_COFFEE, note: 'Coffee', learned: false });
  });
  it('is the most frequent recent amount, with the latest account and note', () => {
    const list = [tx(12000, '2026-10-01', { accountId: 'cash' }), tx(12000, '2026-10-10', { accountId: 'gcash', note: 'Iced latte' }), tx(21000, '2026-10-18'), tx(9900, '2026-01-01'), tx(9900, '2026-01-02'), tx(9900, '2026-01-03')];
    expect(usualCoffee(list, TODAY)).toEqual({ amount: 12000, accountId: 'gcash', note: 'Iced latte', learned: true });
  });
  it('this month wins over an older habit', () => {
    const sept = Array.from({ length: 20 }, (_, i) => tx(13000, `2026-09-${String(i + 1).padStart(2, '0')}`, { accountId: 'cash' }));
    const oct = Array.from({ length: 5 }, (_, i) => tx(12000, `2026-10-${String(i + 10).padStart(2, '0')}`, { accountId: 'gcash' }));
    expect(usualCoffee([...sept, ...oct], TODAY)).toMatchObject({ amount: 12000, accountId: 'gcash' });
  });
  it('a tie goes to the most recent amount', () => {
    expect(usualCoffee([tx(12000, '2026-10-01'), tx(15000, '2026-10-19')], TODAY).amount).toBe(15000);
  });
});

describe('coffeeBudgetNudge', () => {
  it('nudges once at 80 % and once when passing the budget', () => {
    expect(coffeeBudgetNudge(0, 12000, 0)).toBeNull();
    expect(coffeeBudgetNudge(100000, 12000, 200000)).toBeNull();
    expect(coffeeBudgetNudge(150000, 12000, 200000)).toBe('near');
    expect(coffeeBudgetNudge(165000, 12000, 200000)).toBeNull();
    expect(coffeeBudgetNudge(190000, 12000, 200000)).toBe('over');
    expect(coffeeBudgetNudge(210000, 12000, 200000)).toBeNull();
    expect(coffeeBudgetNudge(150000, 60000, 200000)).toBe('over');
  });
  it('the setting is validated', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, coffeeBudget: 200000 }, DEFAULT_SETTINGS).coffeeBudget).toBe(200000);
    expect(validateSettings({ ...DEFAULT_SETTINGS, coffeeBudget: -5 }, DEFAULT_SETTINGS).coffeeBudget).toBe(0);
    expect(validateSettings({ ...DEFAULT_SETTINGS, coffeeBudget: 1.5 }, DEFAULT_SETTINGS).coffeeBudget).toBe(0);
    expect(DEFAULT_SETTINGS.coffeeBudget).toBe(0);
  });
});

describe('coffee break', () => {
  it('is a 15-minute weekday event at 3 PM with a reminder at the time', () => {
    const e = coffeeBreakEvent(new Date(2026, 9, 24, 10)); // a Saturday
    expect(e).toMatchObject({ title: COFFEE_BREAK_TITLE, start: '2026-10-26', startTime: '15:00', endTime: '15:15', repeat: { freq: 'weekly', weekdays: [1, 2, 3, 4, 5] } });
    expect(e.reminders).toEqual([{ id: 'r1', type: 'before', minutes: 0, enabled: true }]);
    const ev = { ...e, id: 'cb', createdAt: '', updatedAt: '' };
    const days = occurrenceStarts(ev, '2026-10-26', '2026-11-01');
    expect(days).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(findCoffeeBreak([ev])?.id).toBe('cb');
    expect(findCoffeeBreak([{ ...ev, repeat: null }])).toBeUndefined();
  });
});

describe('loyalty cards', () => {
  it('is a built-in vault category with a secret member number', () => {
    const c = BUILTIN_CATEGORIES.find((x) => x.id === 'loyalty')!;
    expect(c.name).toBe('Loyalty & Rewards');
    expect(c.fields.find((f) => f.key === 'cardNumber')?.type).toBe('secret');
    expect(c.fields.find((f) => f.key === 'pin')?.type).toBe('pin');
  });
  it('coffee brands get their own card look', () => {
    expect(cardTheme('Starbucks', 'Starbucks Rewards').label).toBe('Starbucks');
    expect(cardTheme('The Coffee Bean & Tea Leaf', '').label).toBe('Coffee Bean');
  });
});
