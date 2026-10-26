// Filipino touches: money words in quick add, local categories, receipt labels,
// PH holidays, and the language tables.

import { describe, expect, it } from 'vitest';
import { easter, holidaysOf, holidaysOn } from '../src/shared/holidays';
import { LANGUAGES, deviceLang, localizeDateText, setLang, tr } from '../src/shared/i18n';
import { CEB } from '../src/shared/locales/ceb';
import { HIL } from '../src/shared/locales/hil';
import { ILO } from '../src/shared/locales/ilo';
import { TAGLISH } from '../src/shared/locales/taglish';
import { TL } from '../src/shared/locales/tl';
import { parseQuick, spelledAmounts } from '../src/shared/money';
import { readReceipt } from '../src/shared/receipt';
import { parseReceipt } from '../src/shared/scan';

const NOW = new Date('2026-10-26T09:00:00');

describe('quick add in Filipino', () => {
  it('spelled amounts', () => {
    expect(spelledAmounts('isang daan pamasahe')).toBe('100 pamasahe');
    expect(spelledAmounts('dalawang daan at singkwenta')).toBe('250');
    expect(spelledAmounts('5 libo padala kay Nanay')).toBe('5000 padala kay Nanay');
    expect(spelledAmounts('duha ka gatos')).toBe('200');
    expect(spelledAmounts('lunch 150')).toBe('lunch 150');
  });
  it('local categories', () => {
    const q = (s: string) => parseQuick(s, NOW, [], [], {});
    expect(q('isang daan pamasahe')).toMatchObject({ amount: 10000, category: 'transport', kind: 'expense' });
    expect(q('5 libo padala kay Nanay')).toMatchObject({ amount: 500000, category: 'padala' });
    expect(q('load 2h')).toMatchObject({ amount: 20000, category: 'load' });
    expect(q('sud-an otsenta')).toMatchObject({ amount: 8000, category: 'food' });
    expect(q('baon ni Mika singkwenta')).toMatchObject({ amount: 5000, category: 'baon', kind: 'expense' });
    expect(q('baon 200')).toMatchObject({ kind: 'income' });
    expect(q('ikapu 500')).toMatchObject({ category: 'church' });
    expect(q('sari-sari 35')).toMatchObject({ category: 'sarisari' });
    expect(q('sweldo 30k')).toMatchObject({ amount: 3000000, kind: 'income' });
  });
});

describe('receipts with Filipino labels', () => {
  const lines = ['KAINAN SA KANTO', 'Bajada, Davao City', '2 Pancit Canton 60.00 120.00', '1 Lumpia 45.00', '3 Coke Mismo 20.00 60.00', 'KABUUAN 225.00', 'BAYAD 300.00', 'SUKLI 75.00', 'SALAMAT PO!'];
  it('Kabuuan / Bayad / Sukli', () => {
    expect(readReceipt(lines)).toMatchObject({ total: 22500, cash: 30000, change: 7500 });
    expect(parseReceipt(lines, [], NOW).amount).toBe(22500);
  });
  it('Bisaya: Tanan / Gibayad', () => {
    expect(readReceipt(['Kape 120.00', 'Pan 30.00', 'TANAN 150.00', 'GIBAYAD 200.00'])).toMatchObject({ total: 15000, cash: 20000, change: 5000 });
  });
});

describe('PH holidays', () => {
  it('Easter and Holy Week move every year', () => {
    expect(easter(2026).getDate()).toBe(5); // April 5, 2026
    expect(easter(2027).getMonth()).toBe(2); // March 28, 2027
    expect(holidaysOn('2026-04-03').map((h) => h.name)).toEqual(['Good Friday']);
    expect(holidaysOn('2027-03-26').map((h) => h.name)).toEqual(['Good Friday']);
  });
  it('fixed dates, National Heroes Day, Kadayawan, 13th month', () => {
    expect(holidaysOn('2026-12-25')[0]).toMatchObject({ name: 'Christmas Day', kind: 'regular' });
    expect(holidaysOn('2026-08-31')[0]).toMatchObject({ name: 'National Heroes Day' }); // last Monday of August 2026
    // Third Sunday of August 2026 is the 16th: Kadayawan 14–16.
    expect(holidaysOn('2026-08-16').map((h) => h.kind)).toEqual(['festival']);
    expect(holidaysOn('2026-08-14').length).toBe(1);
    expect(holidaysOn('2026-12-24').map((h) => h.kind)).toEqual(['special', 'reminder']);
    expect(holidaysOf(2026).length).toBeGreaterThan(20);
  });
});

describe('languages', () => {
  it('phone language → app language', () => {
    expect(deviceLang(['fil-PH'])).toBe('tl');
    expect(deviceLang(['ceb'])).toBe('ceb');
    expect(deviceLang(['ja', 'en-US'])).toBe('en');
    expect(LANGUAGES.map((l) => l.id)).toEqual(['en', 'taglish', 'tl', 'ceb', 'hil', 'ilo', 'auto']);
  });
  it('translations only use the {0} slots the English has; dates use local names', () => {
    for (const [name, table] of Object.entries({ TL, CEB, HIL, ILO, TAGLISH })) {
      for (const [en, out] of Object.entries(table)) {
        // A slot may be left out (Filipino has no plural "s"), never made up.
        const want = new Set(en.match(/\{\d+\}/g) ?? []);
        const extra = (out.match(/\{\d+\}/g) ?? []).filter((s) => !want.has(s));
        expect(`${name}: ${en} → ${extra.join()}`).toBe(`${name}: ${en} → `);
        // Values that matter for the amount ({0} in "{0} left") must survive.
        if (want.has('{0}') && !/item\{1\}|record\{2\}|password\{1\}|day\{1\}|week\{1\}|field\{1\}|event\{1\}|expense\{1\}/.test(en)) expect(`${name}: ${en} → ${out.includes('{0}')}`).toBe(`${name}: ${en} → true`);
      }
    }
    setLang('tl');
    expect(tr('Spent')).not.toBe('Spent');
    expect(localizeDateText('Monday, October 26', 'tl')).toBe('Lunes, Oktubre 26');
    expect(localizeDateText('Sat, Oct 3', 'ceb')).toBe('Sab, Okt 3');
    setLang('en');
    expect(tr('Spent')).toBe('Spent');
  });
});
