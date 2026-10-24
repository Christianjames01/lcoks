// "Scan with camera": turn the text the phone read from a photo (on the device,
// see VaultNativePlugin.recognizeText) into form fields. Pure functions.
//
// Never filled from a photo: CVV, PIN and passwords of cards — the user types
// those. (A router sticker's Wi-Fi key is the exception: reading it is the point.)

import { detectBrand } from './cards';

export type ScanKind = 'cards' | 'ids' | 'giftcards' | 'loyalty' | 'wifiNetwork';
export const SCAN_KINDS: ReadonlySet<string> = new Set<ScanKind>(['cards', 'ids', 'giftcards', 'loyalty', 'wifiNetwork']);

export interface ScanResult {
  fields: Record<string, string>;
  /** Suggested item title (e.g. "BPI Debit"), '' when nothing fits. */
  title: string;
  /** Card numbers that passed the Luhn check. */
  checked: string[];
}

/** Common OCR mix-ups inside a run of digits. */
const fixDigits = (s: string) => s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');

export function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return d.length >= 12 && sum % 10 === 0;
}

/** Card number: 13–19 digits in groups, preferring one that passes the Luhn check. */
function cardNumber(text: string): { number: string; checked: boolean } | null {
  const runs = text.match(/(?:[\dOoIlSBZ]{4}[ -]?){2,4}[\dOoIlSBZ]{1,7}/g) ?? [];
  const found = runs.map((r) => fixDigits(r).replace(/[^\d]/g, '')).filter((d) => d.length >= 13 && d.length <= 19);
  const good = found.find(luhn);
  if (good) return { number: good, checked: true };
  return found[0] ? { number: found[0], checked: false } : null;
}

const network = (n: string) =>
  /^4/.test(n) ? 'Visa' : /^(5[1-5]|2[2-7])/.test(n) ? 'Mastercard' : /^3[47]/.test(n) ? 'American Express' : /^35/.test(n) ? 'JCB' : /^62/.test(n) ? 'UnionPay' : '';

/** MM/YY expiry; with "valid from" and "valid thru" on one card, the later one. */
function expiry(text: string): string {
  const all = [...text.matchAll(/(?<!\d)(0[1-9]|1[0-2])\s?[/\-]\s?(\d{2}|20\d{2})(?!\d)/g)].map((m) => ({ mm: m[1]!, yy: m[2]!.slice(-2) }));
  if (!all.length) return '';
  const last = all.reduce((a, b) => (Number(b.yy + b.mm) > Number(a.yy + a.mm) ? b : a));
  return `${last.mm}/${last.yy}`;
}

const NOT_NAME = /\b(visa|master ?card|debit|credit|prepaid|valid|thru|from|good|member|since|bank|card|platinum|gold|classic|electronic|use|only|signature|authorized|international|rewards|gift|republic|philippines|pilipinas|expires?|date|birth|sex|address|nationality|number|no\.?)\b/i;

/** A person's name printed on a card: 2–4 capitalised words, letters only. */
function personName(lines: string[], skip: (l: string) => boolean = () => false): string {
  for (const raw of lines) {
    const l = raw.trim().replace(/\s+/g, ' ');
    if (skip(l) || NOT_NAME.test(l)) continue;
    if (/^[A-ZÑ][A-ZÑ.'-]*(?: [A-ZÑ][A-ZÑ.'-]*){1,3}$/.test(l) && l.length >= 5 && l.length <= 40) return l;
  }
  return '';
}

/** "2027-05-31", "2027/05/31", "05/31/2027", "31 MAY 2027" → YYYY-MM-DD. */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function isoDates(text: string): string[] {
  const out: string[] = [];
  const push = (y: number, m: number, d: number) => {
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  };
  for (const m of text.matchAll(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g)) push(+m[1]!, +m[2]!, +m[3]!);
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?!\d)/g)) push(+m[3]!, +m[1]!, +m[2]!);
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{4})/g)) push(+m[3]!, MONTHS.indexOf(m[2]!.toLowerCase()) + 1, +m[1]!);
  for (const m of text.matchAll(/\b([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/g)) push(+m[3]!, MONTHS.indexOf(m[1]!.toLowerCase()) + 1, +m[2]!);
  return out;
}

/** Philippine IDs: which one, and its number. */
const ID_TYPES: { type: string; words: RegExp; number: RegExp }[] = [
  { type: 'PhilSys National ID', words: /philsys|pambansang pagkakakilanlan|philippine identification/i, number: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/ },
  { type: "Driver's License", words: /driver'?s? licen[cs]e|land transportation/i, number: /\b[A-Z]\d{2}[- ]\d{2}[- ]\d{6}\b/ },
  { type: 'Passport', words: /passport|pasaporte/i, number: /\b[A-Z]{1,2}\d{6,7}[A-Z]?\b/ },
  { type: 'UMID', words: /\bumid\b|unified multi-purpose/i, number: /\b\d{4}[- ]\d{7}[- ]\d\b/ },
  { type: 'SSS', words: /social security system|\bsss\b/i, number: /\b\d{2}[- ]\d{7}[- ]\d\b/ },
  { type: 'PhilHealth', words: /philhealth/i, number: /\b\d{2}[- ]\d{9}[- ]\d\b/ },
  { type: 'Pag-IBIG (HDMF)', words: /pag-?ibig|hdmf/i, number: /\b\d{4}[- ]\d{4}[- ]\d{4}\b/ },
  { type: 'TIN (BIR)', words: /bureau of internal revenue|\btin\b/i, number: /\b\d{3}[- ]\d{3}[- ]\d{3}(?:[- ]\d{3,5})?\b/ },
  { type: 'PRC License', words: /professional regulation/i, number: /\b\d{7}\b/ },
  { type: 'Postal ID', words: /postal identity|philpost/i, number: /\b[A-Z]{3}\d{9}[A-Z]?\b/ }
];

/** Name on a Philippine ID: under "Last name / Given names" labels, else a capitalised line. */
function idName(lines: string[]): string {
  // "DELA CRUZ, JUAN SANTOS" (driver's license, UMID): last name first.
  const comma = lines.map((l) => l.trim()).find((l) => /^[A-ZÑ][A-ZÑ' -]+, [A-ZÑ][A-ZÑ.' -]+$/.test(l));
  if (comma) {
    const [l, g] = comma.split(', ');
    return `${g} ${l}`;
  }
  // PhilSys: each part on the line under its own label.
  const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
  const iLast = at(/^(?!.*gitnang).*(apelyido|last name|surname)/i);
  const iGiven = at(/mga pangalan|given names?|first name/i);
  const iMiddle = at(/gitnang apelyido|middle name/i);
  const next = (i: number) => (i >= 0 ? (lines[i + 1] ?? '').trim() : '');
  if (iLast >= 0 && iGiven >= 0 && iLast !== iGiven) return [next(iGiven), iMiddle !== iLast && iMiddle !== iGiven ? next(iMiddle) : '', next(iLast)].filter(Boolean).join(' ');
  return personName(lines);
}

/** Router stickers: "SSID: …", "Wi-Fi name", "WLAN key / Password / PSK: …". */
function wifiSticker(lines: string[]): Record<string, string> {
  const pick = (re: RegExp) => {
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i]!);
      if (!m) continue;
      const v = (m[1] ?? '').trim() || (lines[i + 1] ?? '').trim();
      if (v) return v;
    }
    return '';
  };
  const ssid = pick(/(?:ssid|wi-?fi name|network name|wlan name)(?:\s*\(?\d(?:\.\d)?\s*g(?:hz)?\)?)?\s*[:：]?\s*(.*)$/i);
  const password = pick(/(?:wlan key|wi-?fi key|wpa ?key|network key|wireless key|psk|key|password|pass ?word|pwd)\s*[:：]\s*(.*)$/i);
  const out: Record<string, string> = {};
  if (ssid) out.ssid = ssid;
  if (password) out.password = password;
  return out;
}

export function parseScan(kind: ScanKind, lines: readonly string[]): ScanResult {
  const ls = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const text = ls.join('\n');
  const fields: Record<string, string> = {};
  const checked: string[] = [];
  let title = '';

  if (kind === 'wifiNetwork') {
    Object.assign(fields, wifiSticker(ls));
    if (fields.password) fields.security = 'WPA / WPA2 / WPA3';
    title = fields.ssid ?? '';
    return { fields, title, checked };
  }

  if (kind === 'ids') {
    const id = ID_TYPES.find((t) => t.words.test(text));
    if (id) {
      fields.idType = id.type;
      const n = id.number.exec(text)?.[0];
      if (n) fields.idNumber = n;
    }
    const name = idName(ls);
    if (name) fields.fullName = name;
    const dates = isoDates(text);
    // Expiry: the date after a "valid until / expir" label, else the latest date in the future.
    const expLine = ls.findIndex((l) => /valid until|expir|petsa ng pagkawalang/i.test(l));
    const expDates = expLine >= 0 ? isoDates(ls.slice(expLine, expLine + 2).join(' ')) : [];
    const exp = expDates[0] ?? dates.filter((d) => d > new Date().toISOString().slice(0, 10)).sort().pop();
    if (exp) fields.expiryDate = exp;
    title = fields.idType ?? '';
    return { fields, title, checked };
  }

  // Bank / gift / loyalty cards
  const brand = detectBrand(text);
  const num = cardNumber(text);
  if (num) {
    fields.cardNumber = num.number;
    if (num.checked) checked.push('cardNumber');
  }
  if (kind === 'cards') {
    if (brand) fields.bankName = brand;
    const type = /\bcredit\b/i.test(text) ? 'Credit' : /\bdebit\b/i.test(text) ? 'Debit' : /\bprepaid\b/i.test(text) ? 'Prepaid' : '';
    if (type) fields.cardType = type;
    const exp = expiry(text);
    if (exp) fields.expiry = exp;
    const name = personName(ls, (l) => !!brand && l.toLowerCase().includes(brand.toLowerCase()));
    if (name) fields.cardholder = name;
    const net = num ? network(num.number) : '';
    title = [brand, type || net].filter(Boolean).join(' ');
  } else if (kind === 'giftcards') {
    if (brand) fields.brand = brand;
    const amount = /(?:₱|php|p)\s?(\d{1,3}(?:,\d{3})+|\d{2,6})(?:\.\d{2})?/i.exec(text);
    if (amount) fields.balance = fields.initialValue = amount[1]!.replace(/,/g, '');
    const dates = isoDates(text);
    if (dates.length) fields.expiryDate = dates.sort().pop()!;
    title = brand ? `${brand} Gift Card` : '';
  } else {
    if (brand) fields.brand = brand;
    const name = personName(ls, (l) => !!brand && detectBrand(l) === brand);
    if (name) fields.memberName = name;
    title = brand ? `${brand} Rewards` : '';
  }
  return { fields, title, checked };
}
