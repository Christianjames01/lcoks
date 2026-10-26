// Spending heatmap: colour levels, the spending pattern and the year view.

import { describe, expect, it } from 'vitest';
import { heatLevel, heatStats, prevMonth, yearHeat } from '../src/shared/heat';
import type { Transaction } from '../src/shared/money';

const tx = (date: string, amount: number, kind: 'expense' | 'income' = 'expense'): Transaction => ({ id: `${date}-${amount}`, kind, amount, category: 'food', note: '', date, createdAt: '', updatedAt: '' });

describe('heatLevel', () => {
  it('nothing spent is 0; even steps up to the busiest day', () => {
    expect(heatLevel(0, 100000)).toBe(0);
    expect(heatLevel(100000, 100000)).toBe(4);
    expect(heatLevel(1000, 100000)).toBe(1);
    expect(heatLevel(30000, 100000)).toBe(2);
    expect(heatLevel(76000, 100000)).toBe(4);
    expect(heatLevel(500, 0)).toBe(0);
  });
});

describe('heatStats', () => {
  const txs = [
    tx('2026-10-02', 50000), // Fri
    tx('2026-10-09', 30000), // Fri
    tx('2026-10-05', 10000), // Mon
    tx('2026-10-05', 5000, 'income'),
    tx('2026-10-20', 124000), // Tue
    tx('2026-09-30', 99999) // other month
  ];
  it('costliest weekday by average, priciest days, no-spend days up to today', () => {
    const s = heatStats(txs, '2026-10', '2026-10-26');
    expect(s.days).toBe(26);
    expect(s.noSpend).toBe(22);
    // Tuesdays up to the 26th: 6, 13, 20 → ₱1,240 / 3, rounded to the peso.
    expect(s.weekdays[2]).toMatchObject({ avg: 41300, days: 3 });
    expect(s.weekdays[5]).toMatchObject({ avg: 20000, days: 4 });
    expect(s.topWeekday).toBe(2);
    expect(s.topDays.map((d) => d.day)).toEqual(['2026-10-20', '2026-10-02', '2026-10-09']);
  });
  it('a past month counts every day; a future one none', () => {
    expect(heatStats(txs, '2026-09', '2026-10-26')).toMatchObject({ days: 30, noSpend: 29, topWeekday: 3 });
    expect(heatStats(txs, '2026-11', '2026-10-26')).toMatchObject({ days: 0, topWeekday: -1, topDays: [] });
  });
});

describe('yearHeat', () => {
  it('per month totals and the busiest day of the year', () => {
    const y = yearHeat([tx('2026-01-03', 100), tx('2026-01-03', 200), tx('2026-12-31', 50), tx('2025-12-31', 999), tx('2026-05-01', 7000, 'income')], 2026);
    expect(y.months[0]).toBe(300);
    expect(y.months[11]).toBe(50);
    expect(y.max).toBe(300);
    expect(y.total).toBe(350);
  });
});

describe('heat extras', () => {
  const t = (date: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({ ...tx(date, amount), ...extra });
  const txs = [
    t('2026-10-03', 40000, { category: 'coffee', accountId: 'gcash' }), // Sat
    t('2026-10-04', 20000, { category: 'food' }), // Sun
    t('2026-10-05', 10000, { category: 'food' }), // Mon
    t('2026-10-15', 60000, { category: 'shopping', accountId: 'gcash' }),
    t('2026-10-16', 30000, { category: 'food' }),
    t('2026-10-24', 40000, { category: 'coffee' }), // Sat
    t('2026-10-15', 3000000, { kind: 'income', category: 'salary' }),
    t('2026-10-01', 500000, { kind: 'income', category: 'topup' }),
    t('2026-09-05', 20000, { category: 'coffee' }) // Sat in September
  ];
  it('filters by category or account', () => {
    expect(heatStats(txs, '2026-10', '2026-10-26', { category: 'coffee' }).total).toBe(80000);
    expect(heatStats(txs, '2026-10', '2026-10-26', { accountId: 'gcash' }).total).toBe(100000);
    expect(heatStats(txs, '2026-10', '2026-10-26', { category: 'coffee', accountId: 'gcash' }).total).toBe(40000);
  });
  it('weekend vs weekday, thirds, payday share, streaks, top category', () => {
    const s = heatStats(txs, '2026-10', '2026-10-26');
    // Weekend days up to the 26th: 3,4,10,11,17,18,24,25 = 8 → ₱1,000 / 8.
    expect(s.weekend).toBe(12500);
    expect(s.thirds).toEqual([70000, 90000, 40000]);
    // Biggest cash-in on the 15th; days 15–24 → 60000 + 30000 + 40000.
    expect(s.afterPayday).toMatchObject({ day: '2026-10-15', amount: 130000 });
    expect(s.afterPayday!.share).toBeCloseTo(0.65);
    expect(s.bestStreak).toBe(9); // 6–14
    expect(s.streakNow).toBe(2); // 25, 26
    expect(s.topWeekday).toBe(6);
    expect(s.topWeekdayCategory).toBe('coffee');
    expect(prevMonth('2026-01')).toBe('2025-12');
  });
  it('year: costliest and quietest month (months with spending, up to today)', () => {
    const y = yearHeat(txs, 2026, {}, '2026-10-26');
    expect(y.most).toEqual({ month: 9, total: 200000 });
    expect(y.least).toEqual({ month: 8, total: 20000 });
    expect(yearHeat(txs, 2026, { category: 'shopping' }, '2026-10-26')).toMatchObject({ total: 60000, least: null });
  });
});
