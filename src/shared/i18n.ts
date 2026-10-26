// App language: English, Taglish, Tagalog, Bisaya (Cebuano), Hiligaynon, Ilocano.
// Text is looked up by its English wording; anything not translated stays English.
// The choice is kept per device (phone in Bisaya, computer in English, same vault).

import { CEB } from './locales/ceb';
import { HIL } from './locales/hil';
import { ILO } from './locales/ilo';
import { TAGLISH } from './locales/taglish';
import { TL } from './locales/tl';

export type Lang = 'en' | 'taglish' | 'tl' | 'ceb' | 'hil' | 'ilo';
export type LangChoice = Lang | 'auto';

export const LANGUAGES: readonly { id: LangChoice; name: string; note: string; tag: string }[] = [
  { id: 'en', name: 'English', note: 'Default', tag: 'EN' },
  { id: 'taglish', name: 'Taglish', note: 'English na may Utang, Ipon, Sukli…', tag: 'TAG' },
  { id: 'tl', name: 'Tagalog', note: 'Filipino', tag: 'TL' },
  { id: 'ceb', name: 'Bisaya', note: 'Cebuano · Binisaya', tag: 'CEB' },
  { id: 'hil', name: 'Hiligaynon', note: 'Ilonggo · Maayong aga!', tag: 'HIL' },
  { id: 'ilo', name: 'Ilocano', note: 'Ilokano · Naimbag a bigat!', tag: 'ILO' },
  { id: 'auto', name: 'Same as phone', note: 'Follows the phone’s language', tag: '' }
];

const TABLES: Record<Lang, Readonly<Record<string, string>>> = { en: {}, taglish: TAGLISH, tl: TL, ceb: CEB, hil: HIL, ilo: ILO };
const KEY = 'vaultlocks.lang';

let lang: Lang = 'en';
let table: Readonly<Record<string, string>> = {};

/** The phone's own language, if it is one we speak. */
export function deviceLang(langs: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]): Lang {
  for (const l of langs) {
    const base = l.toLowerCase().split(/[-_]/)[0];
    if (base === 'fil' || base === 'tl') return 'tl';
    if (base === 'ceb') return 'ceb';
    if (base === 'hil') return 'hil';
    if (base === 'ilo') return 'ilo';
    if (base === 'en') return 'en';
  }
  return 'en';
}

export function savedChoice(): LangChoice {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return LANGUAGES.some((l) => l.id === v) ? (v as LangChoice) : 'en';
  } catch {
    return 'en';
  }
}

export function saveChoice(c: LangChoice): void {
  try {
    globalThis.localStorage?.setItem(KEY, c);
  } catch {
    /* private mode: stays for this session only */
  }
}

export const currentLang = (): Lang => lang;

/** Switch the text tables (and day/month names). */
export function setLang(l: Lang): void {
  lang = l;
  table = TABLES[l] ?? {};
  installDateNames(l);
}

/**
 * Translate an English UI text. `{0}`, `{1}`… (or `{name}`) are filled from `vars`,
 * so a translation can put them in its own order.
 */
export function tr(en: string, vars?: readonly unknown[] | Readonly<Record<string, unknown>>): string {
  let s = table[en] ?? en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = Array.isArray(vars) ? vars[Number(k)] : (vars as Record<string, unknown>)[k];
    return v === undefined || v === null ? m : String(v);
  });
  return s;
}

// ------------------------------------------------------------ day and month names --

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const NAMES: Partial<Record<Lang, { months: string[]; days: string[] }>> = {
  tl: {
    months: ['Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo', 'Hulyo', 'Agosto', 'Setyembre', 'Oktubre', 'Nobyembre', 'Disyembre'],
    days: ['Linggo', 'Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado']
  },
  ceb: {
    months: ['Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo', 'Hulyo', 'Agosto', 'Septiyembre', 'Oktubre', 'Nobyembre', 'Disyembre'],
    days: ['Domingo', 'Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado']
  },
  hil: {
    months: ['Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo', 'Hulyo', 'Agosto', 'Septiyembre', 'Oktubre', 'Nobyembre', 'Disyembre'],
    days: ['Dominggo', 'Lunes', 'Martes', 'Miyerkoles', 'Huwebes', 'Biyernes', 'Sabado']
  },
  ilo: {
    months: ['Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunio', 'Hulio', 'Agosto', 'Septiembre', 'Oktubre', 'Nobiembre', 'Disiembre'],
    days: ['Domingo', 'Lunes', 'Martes', 'Mierkoles', 'Huebes', 'Biernes', 'Sabado']
  }
};

/** Short form: first three letters, as on calendars (Ene, Peb… / Lun, Mar…). */
const short = (s: string) => s.slice(0, 3);

/** English month/day names → the language's, in text produced by a date formatter. */
export function localizeDateText(text: string, l: Lang = lang): string {
  const n = NAMES[l];
  if (!n) return text;
  const map = new Map<string, string>();
  EN_MONTHS.forEach((m, i) => {
    map.set(m, n.months[i]!);
    map.set(short(m), short(n.months[i]!));
  });
  map.set('Sept', short(n.months[8]!));
  EN_DAYS.forEach((d, i) => {
    map.set(d, n.days[i]!);
    map.set(short(d), short(n.days[i]!));
  });
  const words = [...map.keys()].sort((a, b) => b.length - a.length);
  return text.replace(new RegExp(`\\b(${words.join('|')})\\b`, 'g'), (w) => map.get(w) ?? w);
}

/** Month and day names for headers (Sunday first). */
export const dayNames = (l: Lang = lang): readonly string[] => NAMES[l]?.days ?? EN_DAYS;
export const monthNames = (l: Lang = lang): readonly string[] => NAMES[l]?.months ?? EN_MONTHS;

type DateFn = (this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) => string;
const original: { date?: DateFn; full?: DateFn } = {};

/** Dates the app writes with toLocaleDateString()/toLocaleString() come out in the chosen language. */
function installDateNames(l: Lang): void {
  if (typeof Date === 'undefined') return;
  original.date ??= Date.prototype.toLocaleDateString as DateFn;
  original.full ??= Date.prototype.toLocaleString as DateFn;
  if (!NAMES[l]) {
    Date.prototype.toLocaleDateString = original.date;
    Date.prototype.toLocaleString = original.full;
    return;
  }
  const wrap = (fn: DateFn): DateFn =>
    function (this: Date, locales, options) {
      // Only text the app formats for people (no locale given): English names, then swapped.
      if (locales !== undefined) return fn.call(this, locales, options);
      return localizeDateText(fn.call(this, 'en-US', options), l);
    };
  Date.prototype.toLocaleDateString = wrap(original.date);
  Date.prototype.toLocaleString = wrap(original.full);
}

/** Load this device's choice (renderer start-up). */
export function initLang(): Lang {
  const c = savedChoice();
  const l = c === 'auto' ? deviceLang() : c;
  setLang(l);
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'taglish' ? 'en' : l === 'tl' ? 'fil' : l;
  return l;
}

/** Time of day greeting in the chosen language. */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  return h < 12 ? tr('Good morning') : h < 18 ? tr('Good afternoon') : tr('Good evening');
}

// Renderer: pick the language before any screen's text is built (lists and labels
// made when modules load use it too, so switching language reloads the app).
if (typeof window !== 'undefined' && typeof document !== 'undefined') initLang();
