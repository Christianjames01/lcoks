import { describe, expect, it } from 'vitest';
import { buildReminders, describeUpcoming, parseDateField, upcomingDates } from '../src/shared/expiry';
import { BUILTIN_CATEGORIES } from '../src/shared/categories';
import type { CategoryDef, EntryView } from '../src/shared/types';

const mk = (categoryId: string, fields: Record<string, string>): EntryView => ({
  id: Math.random().toString(36).slice(2),
  categoryId,
  attachmentCount: 0,
  cardPhotos: { front: false, back: false },
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

describe('phone reminders', () => {
  const now = new Date(2026, 9, 3, 12, 0); // Oct 3 2026, noon
  const cats = [...BUILTIN_CATEGORIES];

  it('reminds the day before at 9:00 and on the day', () => {
    const e = mk('subscriptions', { renewalDate: '2026-10-10', price: '₱549', billingCycle: 'One-time' });
    e.title = 'Netflix';
    const r = buildReminders([e], cats, { daysBefore: 1 }, now);
    expect(r.map((x) => x.at)).toEqual([new Date(2026, 9, 9, 9), new Date(2026, 9, 10, 9)]);
    expect(r[0]!.title).toBe('Netflix: renews tomorrow');
    expect(r[1]!.title).toBe('Netflix: renews today');
    expect(r[0]!.body).toContain('₱549');
    expect(new Set(r.map((x) => x.id)).size).toBe(2);
  });

  it('rolls monthly renewals forward and skips past times', () => {
    const e = mk('subscriptions', { renewalDate: '2026-01-31', billingCycle: 'Monthly' });
    const [first] = buildReminders([e], cats, { daysBefore: 1 }, now);
    expect(first!.at).toEqual(new Date(2026, 9, 30, 9)); // renews Oct 31
  });

  it('covers documents and custom categories with due / expiry date fields', () => {
    const custom = { id: 'c-1', name: 'Bills', icon: 'folder', builtin: false, fields: [{ key: 'f1', label: 'Due date', type: 'date' }, { key: 'f2', label: 'Issued', type: 'date' }] } as CategoryDef;
    const doc = mk('documents', { expiryDate: '2026-10-20' });
    const bill = mk('c-1', { f1: '2026-10-15', f2: '2026-10-16' });
    const r = buildReminders([doc, bill], [...cats, custom], { daysBefore: 3 }, now);
    expect(r.map((x) => x.title.split(': ')[1])).toEqual(['due in 3 days', 'due today', 'expires in 3 days', 'expires today']);
  });
});
