// Coffee corner for the Expenses page: this month's cups, the "usual coffee"
// one-tap entry, the coffee budget nudge and the daily coffee-break event.
// Pure functions over the vault's transactions / events.

import { newEventInput, type CalendarEvent, type CalendarEventInput } from './calendar';
import { dayKey, monthOf, type Transaction } from './money';

export const COFFEE = 'coffee';
/** Used for the one-tap chip until the user has logged a coffee. */
export const DEFAULT_USUAL_COFFEE = 12000;
export const COFFEE_BREAK_TITLE = '☕ Coffee break';

const isCoffee = (t: Transaction) => t.kind === 'expense' && t.category === COFFEE;

export interface CoffeeMonth {
  cups: number;
  total: number;
  /** Average price per cup, rounded to a whole unit (minor units), 0 with no cups. */
  perCup: number;
}

export function coffeeMonth(list: readonly Transaction[], month: string): CoffeeMonth {
  let cups = 0;
  let total = 0;
  for (const t of list) {
    if (!isCoffee(t) || monthOf(t.date) !== month) continue;
    cups += 1;
    total += t.amount;
  }
  return { cups, total, perCup: cups ? Math.round(total / cups / 100) * 100 : 0 };
}

export interface UsualCoffee {
  amount: number;
  accountId?: string;
  note: string;
  /** False when no coffee was logged yet (the amount is the default). */
  learned: boolean;
}

/**
 * The amount paid most often for coffee lately (ties: the most recent), with the
 * account and note of the latest such cup. "Lately" is the last 30 days when
 * there are at least 3 cups in them (habits change), otherwise the last 90.
 */
export function usualCoffee(list: readonly Transaction[], today: Date = new Date()): UsualCoffee {
  const since = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return dayKey(d);
  };
  const coffee = list.filter(isCoffee).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const month = coffee.filter((t) => t.date >= since(30));
  const recent = month.length >= 3 ? month : coffee.filter((t) => t.date >= since(90));
  if (!recent.length) return { amount: DEFAULT_USUAL_COFFEE, note: 'Coffee', learned: false };
  const counts = new Map<number, number>();
  for (const t of recent) counts.set(t.amount, (counts.get(t.amount) ?? 0) + 1);
  let amount = recent[0]!.amount;
  for (const t of recent) if (counts.get(t.amount)! > counts.get(amount)!) amount = t.amount;
  const last = recent.find((t) => t.amount === amount)!;
  return { amount, note: last.note || 'Coffee', learned: true, ...(last.accountId ? { accountId: last.accountId } : {}) };
}

/** Coffee budget nudge after adding `added` to the month: crossing 80 % or 100 %. */
export function coffeeBudgetNudge(spentBefore: number, added: number, budget: number): 'near' | 'over' | null {
  if (budget <= 0 || added <= 0) return null;
  const after = spentBefore + added;
  if (after > budget && spentBefore <= budget) return 'over';
  if (after >= budget * 0.8 && spentBefore < budget * 0.8) return 'near';
  return null;
}

/** The coffee-break event VaultLocks made, if it is still there. */
export const findCoffeeBreak = (events: readonly CalendarEvent[]) => events.find((e) => e.title === COFFEE_BREAK_TITLE && e.repeat);

/** A 15-minute coffee break on weekdays at `time` (HH:MM), with a reminder at the time. */
export function coffeeBreakEvent(today: Date = new Date(), time = '15:00'): CalendarEventInput {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const endMin = Math.min(23 * 60 + 59, h * 60 + m + 15);
  // Start on a weekday so the first occurrence is a real one.
  const start = new Date(today);
  while (start.getDay() === 0 || start.getDay() === 6) start.setDate(start.getDate() + 1);
  const day = dayKey(start);
  return {
    ...newEventInput(day, { reminders: [0] }),
    title: COFFEE_BREAK_TITLE,
    notes: 'Added from Expenses · Coffee',
    startTime: time,
    endTime: `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`,
    repeat: { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }
  };
}
