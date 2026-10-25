// Kloud: understanding sentences and answering from the vault.

import { describe, expect, it } from 'vitest';
import { answer, parseWhen, speakable, understand, type KloudVault } from '../src/shared/kloud';
import { DEFAULT_ACCOUNTS, type Transaction } from '../src/shared/money';
import { newEventInput } from '../src/shared/calendar';
import { emptyTask } from '../src/shared/tasks';

const NOW = new Date(2026, 9, 25, 9, 30); // Sunday, Oct 25 2026, 9:30
const accounts = DEFAULT_ACCOUNTS.map((a) => ({ ...a }));
const ctx = { accounts, now: NOW };

describe('parseWhen', () => {
  it('days', () => {
    expect(parseWhen('pay rent tomorrow', NOW)).toMatchObject({ day: '2026-10-26', time: '', rest: 'pay rent' });
    expect(parseWhen('call mama bukas', NOW).day).toBe('2026-10-26');
    expect(parseWhen('meeting on friday', NOW).day).toBe('2026-10-30');
    expect(parseWhen('gym next sunday', NOW).day).toBe('2026-11-01');
    expect(parseWhen('dentist oct 30', NOW).day).toBe('2026-10-30');
    expect(parseWhen('enrollment 5 jan', NOW).day).toBe('2027-01-05');
    expect(parseWhen('the day after tomorrow submit report', NOW)).toMatchObject({ day: '2026-10-27', rest: 'submit report' });
  });
  it('times', () => {
    expect(parseWhen('pay rent tomorrow at 9', NOW)).toMatchObject({ day: '2026-10-26', time: '09:00', rest: 'pay rent' });
    expect(parseWhen('call at 3', NOW)).toMatchObject({ day: '2026-10-25', time: '15:00' });
    expect(parseWhen('call at 3:30 pm', NOW).time).toBe('15:30');
    expect(parseWhen('wake up 6 am', NOW)).toMatchObject({ time: '06:00', day: '2026-10-26' }); // passed today → tomorrow
    expect(parseWhen('lunch at noon', NOW).time).toBe('12:00');
    expect(parseWhen('movie tonight', NOW)).toMatchObject({ day: '2026-10-25', time: '20:00' });
    expect(parseWhen('check oven in 10 minutes', NOW)).toMatchObject({ day: '2026-10-25', time: '09:40', rest: 'check oven' });
    expect(parseWhen('stretch in an hour', NOW).time).toBe('10:30');
    expect(parseWhen('buy 2 eggs', NOW)).toMatchObject({ day: '', time: '', rest: 'buy 2 eggs' });
  });
});

describe('understand', () => {
  it('money, with or without the wake word', () => {
    const m = understand('Kloud, lunch 150 from gcash', ctx);
    expect(m).toMatchObject({ type: 'money', entry: { kind: 'expense', amount: 15000, category: 'food', accountId: 'gcash', note: 'Lunch' } });
    expect(understand('I spent 85 pesos on grab', ctx)).toMatchObject({ type: 'money', entry: { amount: 8500, category: 'transport', note: 'Grab' } });
    expect(understand('cash in 500 gcash', ctx)).toMatchObject({ type: 'money', entry: { kind: 'income', amount: 50000, accountId: 'gcash' } });
    expect(understand('hey cloud coffee 120', ctx)).toMatchObject({ type: 'money', entry: { category: 'coffee' } });
  });
  it('tasks and events', () => {
    expect(understand('remind me to pay rent tomorrow at 9', ctx)).toMatchObject({ type: 'task', title: 'Pay rent', when: { day: '2026-10-26', time: '09:00' } });
    expect(understand("don't forget to buy milk", ctx)).toMatchObject({ type: 'task', title: 'Buy milk', when: { day: '' } });
    expect(understand('schedule a meeting with Ana on friday at 2 pm', ctx)).toMatchObject({ type: 'event', title: 'Meeting with Ana', when: { day: '2026-10-30', time: '14:00' } });
  });
  it('questions', () => {
    expect(understand('how much did I spend on coffee this month?', ctx)).toMatchObject({ type: 'spending', category: 'coffee', period: 'month' });
    expect(understand('how much did I spend today', ctx)).toMatchObject({ type: 'spending', category: null, period: 'today' });
    expect(understand('what did I spend on food last week', ctx)).toMatchObject({ type: 'spending', category: 'food', period: 'lastWeek' });
    expect(understand("what's my gcash balance", ctx)).toMatchObject({ type: 'balance', account: 'gcash' });
    expect(understand("what's on my calendar today", ctx)).toMatchObject({ type: 'agenda', day: '2026-10-25' });
    expect(understand('do I have meetings tomorrow?', ctx)).toMatchObject({ type: 'agenda', day: '2026-10-26' });
    expect(understand('what tasks are due', ctx)).toMatchObject({ type: 'tasksDue' });
  });
  it('open, views, lock, help, nonsense', () => {
    expect(understand('open my Gmail password', ctx)).toMatchObject({ type: 'open', query: 'gmail' });
    expect(understand('open expenses', ctx)).toMatchObject({ type: 'view', view: 'money' });
    expect(understand('lock the vault', ctx)).toEqual({ type: 'lock' });
    expect(understand('what can you do', ctx)).toEqual({ type: 'help' });
    expect(understand('banana', ctx).type).toBe('unknown');
  });
});

describe('answer', () => {
  const tx = (amount: number, category: string, date: string, kind: 'expense' | 'income' = 'expense', accountId?: string): Transaction => ({ id: `${amount}${date}`, kind, amount, category, note: '', date, createdAt: '', updatedAt: '', ...(accountId ? { accountId } : {}) });
  const vault: KloudVault = {
    transactions: [tx(12000, 'coffee', '2026-10-20'), tx(18500, 'coffee', '2026-10-24'), tx(15000, 'food', '2026-10-25'), tx(500000, 'topup', '2026-10-01', 'income', 'gcash'), tx(30000, 'coffee', '2026-09-10')],
    accounts,
    events: [{ ...newEventInput('2026-10-25', { hour: 10 }), title: 'Team meeting', id: 'e1', createdAt: '', updatedAt: '' }],
    tasks: [{ ...emptyTask('2026-10-25'), title: 'Submit report', id: 't1', createdAt: '', updatedAt: '' }],
    entries: [{ id: 'g', title: 'Gmail', categoryId: 'email' }, { id: 'b', title: 'BPI Visa', categoryId: 'cards' }],
    currency: 'PHP'
  };
  const ask = (s: string) => answer(understand(s, { accounts, now: NOW }), vault, NOW);

  it('adds with a spoken confirmation', () => {
    const r = ask('lunch 150 from gcash');
    expect(r.say).toBe('Done. ₱150 for Lunch from GCash.');
    expect(r.action).toMatchObject({ type: 'saveTransaction', input: { amount: 15000, accountId: 'gcash' } });
    const t = ask('remind me to pay rent tomorrow at 9');
    expect(t.say).toBe('Okay. I’ll remind you: Pay rent tomorrow at 9:00 AM.');
    expect(t.action).toMatchObject({ type: 'saveTask', input: { title: 'Pay rent', due: '2026-10-26', dueTime: '09:00', reminder: { type: 'before', minutes: 0 } } });
  });
  it('answers questions from the vault', () => {
    expect(ask('how much did I spend on coffee this month').say).toBe('You spent ₱305 on Coffee this month, in 2 records.');
    expect(ask('how much did I spend today').say).toBe('You spent ₱150 today, in 1 record.');
    expect(ask('gcash balance').say).toBe('GCash has ₱5,000.');
    expect(ask("what's on my calendar today").say).toBe('One thing today: Team meeting at 10:00 AM.');
    expect(ask('what tasks are due').say).toBe('1 due today: Submit report.');
  });
  it('opens items without reading secrets', () => {
    expect(ask('open gmail').action).toEqual({ type: 'openEntry', id: 'g' });
    expect(ask('open gmail').say).toMatch(/won’t say passwords/);
    expect(ask('open netflix').say).toMatch(/couldn’t find/);
  });
  it('speaks money as words', () => {
    expect(speakable('Done. ₱2,720 for Coffee.')).toBe('Done. 2,720 pesos for Coffee.');
  });
});
