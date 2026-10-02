import { describe, expect, it } from 'vitest';
import { describeUpcoming, parseDateField, upcomingDates } from '../src/shared/expiry';
import type { EntryView } from '../src/shared/types';

const mk = (categoryId: string, fields: Record<string, string>): EntryView => ({
  id: Math.random().toString(36).slice(2),
  categoryId,
  title: categoryId,
  fields,
  secrets: {},
  tags: [],
  favorite: false,
  favoriteOrder: 0,
  createdAt: '',
  updatedAt: ''
});

describe('expiry reminders', () => {
  const now = new Date(2026, 9, 2); // 2 Oct 2026
  it('parses ISO dates and MM/YY card expiry (end of month)', () => {
    expect(parseDateField('2026-10-12')!.getDate()).toBe(12);
    const card = parseDateField('02/28')!;
    expect([card.getFullYear(), card.getMonth(), card.getDate()]).toEqual([2028, 1, 29]);
    expect(parseDateField('soon')).toBeNull();
  });
  it('lists items expiring or renewing within 30 days, soonest first', () => {
    const list = upcomingDates(
      [
        mk('ids', { expiryDate: '2026-10-20' }),
        mk('subscriptions', { renewalDate: '2026-10-05' }),
        mk('insurance', { expiryDate: '2027-05-01' }),
        mk('ids', { expiryDate: '2026-09-28' }),
        mk('personal', { expiryDate: '2026-10-03' }),
        mk('cards', { expiry: '10/26' })
      ],
      now
    );
    expect(list.map((u) => [u.entry.categoryId, u.days])).toEqual([
      ['ids', -4],
      ['subscriptions', 3],
      ['ids', 18],
      ['cards', 29]
    ]);
    expect(describeUpcoming(list[0]!)).toBe('Expired 4 days ago');
    expect(describeUpcoming(list[1]!)).toBe('Renews in 3 days');
  });
});
