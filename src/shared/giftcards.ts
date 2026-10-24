// Gift cards & vouchers: the balance is kept as plain text in the item (so the
// user can also edit it), read and written here in minor units.

import { MONEY_CATEGORIES, MAX_AMOUNT, dayKey, parseDay } from './money';

export const GIFT_CATEGORY = 'giftcards';
/** Lines kept in an item's use history (newest first). */
export const GIFT_HISTORY_LINES = 40;

/** "₱1,000.50", "1000", "P 820" → minor units; null when there is no amount. */
export function parseAmountText(text: string | undefined): number | null {
  const t = (text ?? '').replace(/[^\d.,]/g, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [i, f = ''] = t.split('.');
  const v = Number(i) * 100 + Number(f.padEnd(2, '0') || 0);
  return v >= 0 && v <= MAX_AMOUNT ? v : null;
}

/** Minor units → the plain text stored in the item ("820", "640.50"). */
export const amountText = (minor: number) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

export interface GiftUse {
  date: string;
  amount: number;
  note: string;
}

/** History line written by "Use balance": "2026-10-22 · -180 · Caramel macchiato". */
export const historyLine = (u: GiftUse) => `${u.date} · -${amountText(u.amount)}${u.note ? ` · ${u.note.replace(/\s+/g, ' ').trim()}` : ''}`;

/** Read history lines back (lines the user typed themselves are kept as notes). */
export function parseHistory(text: string | undefined): (GiftUse | { date: ''; amount: 0; note: string })[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(\d{4}-\d{2}-\d{2}) · -([\d.]+)(?: · (.*))?$/.exec(l);
      const amount = m ? parseAmountText(m[2]) : null;
      return m && amount !== null ? { date: m[1]!, amount, note: m[3] ?? '' } : { date: '' as const, amount: 0 as const, note: l };
    });
}

export const addHistory = (text: string | undefined, u: GiftUse) =>
  [historyLine(u), ...(text ?? '').split('\n').filter((l) => l.trim())].slice(0, GIFT_HISTORY_LINES).join('\n');

/** Expense category for a purchase with this card: Coffee for coffee brands, else Shopping. */
export function giftExpenseCategory(brand: string, title: string): string {
  const hay = ` ${`${brand} ${title}`.toLowerCase()} `;
  const coffee = MONEY_CATEGORIES.find((c) => c.id === 'coffee')!;
  if (coffee.words.some((w) => hay.includes(w))) return 'coffee';
  const food = MONEY_CATEGORIES.find((c) => c.id === 'food')!;
  if (food.words.some((w) => new RegExp(`[^a-z]${w}[^a-z]`).test(hay))) return 'food';
  return 'shopping';
}

/** Whole days until the card's expiry date (negative = expired), null without one. */
export function daysToExpiry(expiry: string | undefined, today: Date = new Date()): number | null {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  return Math.round((parseDay(expiry).getTime() - parseDay(dayKey(today)).getTime()) / 86_400_000);
}
