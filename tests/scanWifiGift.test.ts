// Camera scan parsing, Wi-Fi QR codes and gift cards (balance, history, "Use balance").

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultService } from '../src/main/vault/vaultService';
import { BUILTIN_CATEGORIES } from '../src/shared/categories';
import { upcomingDates } from '../src/shared/expiry';
import { addHistory, amountText, daysToExpiry, giftExpenseCategory, historyLine, parseAmountText, parseHistory } from '../src/shared/giftcards';
import { luhn, parseScan } from '../src/shared/scan';
import { wifiOf, wifiQrText } from '../src/shared/wifi';

const PW = 'Scan-Gift-Test-Master-Pass-2026!';

describe('camera scan: bank cards', () => {
  it('reads bank, type, number (Luhn-checked), expiry and name; never CVV or PIN', () => {
    const r = parseScan('cards', ['BPI', 'DEBIT', '4386 1520 0981 1234', 'VALID', 'FROM 09/24 THRU 09/29', 'CHRISTIAN JAMES', 'VISA', 'CVV 123', 'PIN 4321']);
    expect(luhn('4386152009811234')).toBe(false);
    expect(r.fields).toMatchObject({ bankName: 'BPI', cardType: 'Debit', cardNumber: '4386152009811234', expiry: '09/29', cardholder: 'CHRISTIAN JAMES' });
    expect(r.fields.cvv).toBeUndefined();
    expect(r.fields.pin).toBeUndefined();
    expect(r.checked).toEqual([]);
    expect(r.title).toBe('BPI Debit');
  });
  it('fixes common misreads and marks a valid number as checked', () => {
    const r = parseScan('cards', ['BDO', 'CREDIT', '4111 11I1 1111 1111', '12/28', 'JUAN DELA CRUZ']);
    expect(r.fields.cardNumber).toBe('4111111111111111');
    expect(r.checked).toEqual(['cardNumber']);
    expect(r.fields.cardType).toBe('Credit');
    expect(r.fields.cardholder).toBe('JUAN DELA CRUZ');
  });
});

describe('camera scan: IDs, gift cards, loyalty, Wi-Fi stickers', () => {
  it('Philippine IDs: type, number, name and expiry', () => {
    const r = parseScan('ids', ['REPUBLIKA NG PILIPINAS', "LAND TRANSPORTATION OFFICE", "DRIVER'S LICENSE", 'Last Name, First Name, Middle Name', 'DELA CRUZ, JUAN SANTOS', 'License No.', 'N01-23-456789', 'Expiration Date', '2029/05/31']);
    expect(r.fields).toMatchObject({ idType: "Driver's License", idNumber: 'N01-23-456789', fullName: 'JUAN SANTOS DELA CRUZ', expiryDate: '2029-05-31' });
    const p = parseScan('ids', ['PAMBANSANG PAGKAKAKILANLAN', 'Philippine Identification Card', '1234-5678-9012-3456', 'Apelyido/Last Name', 'ORTOUSTE', 'Mga Pangalan/Given Names', 'CHRISTIAN JAMES']);
    expect(p.fields).toMatchObject({ idType: 'PhilSys National ID', idNumber: '1234-5678-9012-3456', fullName: 'CHRISTIAN JAMES ORTOUSTE' });
  });
  it('gift cards: brand, number, amount, date', () => {
    const r = parseScan('giftcards', ['STARBUCKS', 'GIFT CARD', '₱1,000', '6061 0234 5678 9012', 'Valid until Dec 31, 2026']);
    expect(r.fields).toMatchObject({ brand: 'Starbucks', balance: '1000', initialValue: '1000', cardNumber: '6061023456789012', expiryDate: '2026-12-31' });
    expect(r.title).toBe('Starbucks Gift Card');
  });
  it('loyalty cards: brand and member name', () => {
    expect(parseScan('loyalty', ['SM ADVANTAGE', 'MARIA CLARA SANTOS', '8880 1234 5678 9001']).fields).toMatchObject({ brand: 'SM Advantage', memberName: 'MARIA CLARA SANTOS' });
  });
  it('router stickers: network name and key', () => {
    const r = parseScan('wifiNetwork', ['PLDT HOME FIBR', 'SSID: PLDTHOMEFIBR5G_a1b2', 'Password: Xk29pLm7QzR4', 'S/N 1234']);
    expect(r.fields).toMatchObject({ ssid: 'PLDTHOMEFIBR5G_a1b2', password: 'Xk29pLm7QzR4', security: 'WPA / WPA2 / WPA3' });
    expect(parseScan('wifiNetwork', ['WLAN Name', 'Converge_2.4G_ABCD', 'WLAN Key: 9f8e7d6c']).fields).toMatchObject({ ssid: 'Converge_2.4G_ABCD', password: '9f8e7d6c' });
  });
  it('nothing readable → no fields', () => {
    expect(parseScan('cards', ['', '  ']).fields).toEqual({});
  });
});

describe('Wi-Fi QR code text', () => {
  it('uses the WIFI: format with escaping', () => {
    expect(wifiQrText({ ssid: 'PLDT-Home 5G', password: 'pa;ss:wo,rd"\\', security: 'WPA / WPA2 / WPA3' })).toBe('WIFI:T:WPA;S:PLDT-Home 5G;P:pa\\;ss\\:wo\\,rd\\"\\\\;;');
    expect(wifiQrText({ ssid: 'Cafe', security: 'None (open)' })).toBe('WIFI:T:nopass;S:Cafe;;');
    expect(wifiQrText({ ssid: 'Old', password: 'abcde', security: 'WEP', hidden: true })).toBe('WIFI:T:WEP;S:Old;P:abcde;H:true;;');
    expect(() => wifiQrText({ ssid: ' ' })).toThrow();
  });
  it('finds the network on Wi-Fi items and older Wi-Fi items moved to Others', () => {
    expect(wifiOf({ categoryId: 'wifiNetwork', fields: { ssid: 'Home', hidden: 'Yes' }, tags: [] })).toEqual({ ssid: 'Home', security: undefined, hidden: true });
    expect(wifiOf({ categoryId: 'others', fields: { name: 'Office', notes: 'Wi-Fi security: WPA2' }, tags: ['wifi'] })).toEqual({ ssid: 'Office', security: 'WPA2', hidden: false });
    expect(wifiOf({ categoryId: 'others', fields: { name: 'Gym locker' }, tags: [] })).toBeNull();
  });
  it('is a built-in category with a hidden password', () => {
    const c = BUILTIN_CATEGORIES.find((x) => x.id === 'wifiNetwork')!;
    expect(c.fields.find((f) => f.key === 'password')?.type).toBe('password');
  });
});

describe('gift cards', () => {
  it('reads and writes amounts', () => {
    expect(parseAmountText('₱1,000.50')).toBe(100050);
    expect(parseAmountText('820')).toBe(82000);
    expect(parseAmountText('')).toBeNull();
    expect(parseAmountText('abc')).toBeNull();
    expect(amountText(64000)).toBe('640');
    expect(amountText(64050)).toBe('640.50');
  });
  it('keeps a readable history, newest first', () => {
    const h = addHistory('2026-10-03 · -0 · Birthday gift', { date: '2026-10-22', amount: 18000, note: 'Caramel  macchiato' });
    expect(h.split('\n')[0]).toBe('2026-10-22 · -180 · Caramel macchiato');
    expect(parseHistory(h)[0]).toEqual({ date: '2026-10-22', amount: 18000, note: 'Caramel macchiato' });
    expect(parseHistory('Got it from Mama')[0]).toEqual({ date: '', amount: 0, note: 'Got it from Mama' });
    expect(historyLine({ date: '2026-01-01', amount: 100, note: '' })).toBe('2026-01-01 · -1');
  });
  it('picks the expense category from the brand', () => {
    expect(giftExpenseCategory('Starbucks', 'Starbucks Gift Card')).toBe('coffee');
    expect(giftExpenseCategory('Jollibee', 'Voucher')).toBe('food');
    expect(giftExpenseCategory('SM', 'SM Gift Pass')).toBe('shopping');
  });
  it('days to expiry', () => {
    expect(daysToExpiry('2026-10-29', new Date(2026, 9, 24, 15))).toBe(5);
    expect(daysToExpiry('', new Date())).toBeNull();
  });
});

describe('Use balance (vault)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-gift-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('lowers the balance, adds history and the expense in one save; encrypted at rest', async () => {
    const file = path.join(dir, 'vault', 'vault.vault');
    const v = new VaultService(file);
    await v.create(PW, null);
    const card = await v.saveEntry({ categoryId: 'giftcards', title: 'Starbucks Gift Card', fields: { brand: 'Starbucks', cardNumber: '6061023456789012', pin: '1111', balance: '1,000', initialValue: '1000', expiryDate: '2026-12-31' }, tags: [], favorite: false });
    const r = await v.useGiftCard(card.id, { amount: 18000, note: 'Secret macchiato', date: '2026-10-22', expense: { category: 'coffee' } });
    expect(r.balance).toBe(82000);
    expect(r.transaction).toMatchObject({ kind: 'expense', amount: 18000, category: 'coffee', note: 'Secret macchiato', date: '2026-10-22' });
    const e = v.snapshot().entries.find((x) => x.id === card.id)!;
    expect(e.fields.balance).toBe('820');
    expect(e.fields.history).toBe('2026-10-22 · -180 · Secret macchiato');
    // secrets untouched
    expect(await v.getSecret(card.id, 'cardNumber')).toBe('6061023456789012');
    expect(await v.getSecret(card.id, 'pin')).toBe('1111');
    expect(await fs.readFile(file, 'utf8')).not.toContain('Secret macchiato');

    // without an expense
    const r2 = await v.useGiftCard(card.id, { amount: 2000, note: '', date: '2026-10-23' });
    expect(r2).toMatchObject({ balance: 80000, transaction: null });
    expect(v.snapshot().transactions).toHaveLength(1);

    await expect(v.useGiftCard(card.id, { amount: 900000, note: '', date: '2026-10-23' })).rejects.toMatchObject({ userMessage: expect.stringMatching(/more than the balance/) });
    await expect(v.useGiftCard(card.id, { amount: 0, note: '', date: '2026-10-23' })).rejects.toThrow();
    const other = await v.saveEntry({ categoryId: 'personal', title: 'GitHub', fields: { username: 'x' }, tags: [], favorite: false });
    await expect(v.useGiftCard(other.id, { amount: 100, note: '', date: '2026-10-23' })).rejects.toMatchObject({ userMessage: expect.stringMatching(/not a gift card/) });
  });

  it('expiring gift cards show up in the reminders', () => {
    const entry = { id: 'g', categoryId: 'giftcards', title: 'SM Gift Pass', fields: { expiryDate: '2026-10-29' } } as never;
    const up = upcomingDates([entry], new Date(2026, 9, 24, 9), 7);
    expect(up.map((u) => u.days)).toEqual([5]);
  });
});
