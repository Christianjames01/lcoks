// "Scan with camera": turn the text the phone read from a photo (on the device,
// see VaultNativePlugin.recognizeText) into form fields. Pure functions.
//
// Never filled from a photo: CVV, PIN and passwords of cards — the user types
// those. (A router sticker's Wi-Fi key is the exception: reading it is the point.)

import { detectBrand } from './cards';
import { parseWifiQr } from './wifi';

export type ScanKind = 'cards' | 'ids' | 'giftcards' | 'loyalty' | 'wifiNetwork';
export const SCAN_KINDS: ReadonlySet<string> = new Set<ScanKind>(['cards', 'ids', 'giftcards', 'loyalty', 'wifiNetwork']);

export interface ScanResult {
  fields: Record<string, string>;
  /** Suggested item title (e.g. "BPI Debit"), '' when nothing fits. */
  title: string;
  /** Card numbers that passed the Luhn check, and fields read from a QR code. */
  checked: string[];
  /** Read from a QR code (exact), not from printed text. */
  viaQr?: boolean;
}

/** A QR code found in the photo: a router's "join Wi-Fi" code, or a gift card's number. */
export function parseScanQr(kind: ScanKind, qr: string | null): ScanResult | null {
  if (!qr) return null;
  if (kind === 'wifiNetwork') {
    const w = parseWifiQr(qr);
    if (!w) return null;
    const fields: Record<string, string> = { ssid: w.ssid, security: w.security, hidden: w.hidden ? 'Yes' : 'No' };
    if (w.password) fields.password = w.password;
    return { fields, title: w.ssid, checked: Object.keys(fields), viaQr: true };
  }
  if ((kind === 'giftcards' || kind === 'loyalty') && /^\d{8,24}$/.test(qr.trim())) {
    return { fields: { cardNumber: qr.trim() }, title: '', checked: ['cardNumber'], viaQr: true };
  }
  return null;
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

/** Words printed on cards that are never part of the holder's name. */
const NOT_NAME_WORDS = new Set(
  (
    'visa mastercard master debit credit prepaid valid thru from good until month year expires expiry member since bank card platinum gold classic ' +
    'titanium signature infinite world elite premier prestige rewards reward electronic use only authorized international philippines pilipinas ' +
    'republic savings account customer service hotline thank you not transferable property of holder name number no date birth sex address ' +
    'nationality amore cashback contactless paypass union pay gift voucher points stars loyalty www com ph inc corp atm cirrus maestro plus'
  ).split(' ')
);

/**
 * A person's name printed on a card: 2–4 words of letters, in capitals or Title Case.
 * Lines below the card number are preferred (that is where cards print the name).
 */
function personName(lines: string[], opts: { skip?: (l: string) => boolean; after?: number } = {}): string {
  let best = '';
  let bestScore = -Infinity;
  lines.forEach((raw, i) => {
    const l = raw.trim().replace(/\s+/g, ' ');
    if (l.length < 5 || l.length > 40 || opts.skip?.(l) || detectBrand(l)) return;
    if (!/^[A-Za-zÑñ.'-]+(?: [A-Za-zÑñ.'-]+){1,3}$/.test(l)) return;
    const words = l.split(' ');
    if (words.some((w) => NOT_NAME_WORDS.has(w.toLowerCase().replace(/[.'-]/g, '')))) return;
    const caps = l === l.toUpperCase();
    const title = words.every((w) => /^[A-ZÑ]/.test(w));
    if (!caps && !title) return;
    let score = 0;
    if (opts.after !== undefined && opts.after >= 0) score += i > opts.after ? 4 - Math.min(3, i - opts.after - 1) : -2;
    if (caps) score += 1;
    if (words.length >= 2 && words.length <= 3) score += 1;
    if (words.filter((w) => w.replace(/\./g, '').length === 1).length > 1) score -= 2;
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  });
  return best;
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

/**
 * Router stickers, e.g. "Wireless Network Name (SSID): PLDTHOMEFIBR_a1b2",
 * "WLAN Name 5G: …", "SSID" on one line and the name on the next, "WLAN Key: …".
 * Router admin logins on the same sticker ("Username/Password: admin") are skipped.
 */
const SSID_LABEL = /\b(?:ssid|wi-?fi name|wifi network|network name|wlan name|wireless network name|wireless name)\b/i;
const KEY_LABEL_STRONG = /\b(?:wlan key|wi-?fi key|wi-?fi password|wireless password|wireless key|wpa2? ?key|wpa ?psk|network key|psk|security key|passphrase)\b/i;
const KEY_LABEL_WEAK = /\b(?:password|pass ?word|pwd|key)\b/i;
const ADMIN = /\b(?:admin|user ?name|login|web|telnet|gui|management|default access|ip)\b/i;

/** What follows the label: after the colon behind it, else right after it (minus "(2.4G)" / "(SSID)"). */
function afterLabel(line: string, label: RegExp): string {
  const m = label.exec(line);
  if (!m) return '';
  const rest = line.slice(m.index + m[0].length);
  const colon = rest.search(/[:：]/);
  if (colon >= 0) return rest.slice(colon + 1).trim();
  return rest
    .replace(/^\s*(?:\((?:ssid|[\d.]+\s*g(?:hz)?)\)|[\d.]+\s*g(?:hz)?)\s*/i, '')
    .replace(/^[\s=-]+/, '')
    .trim();
}

function wifiSticker(lines: string[]): Record<string, string> {
  const pick = (label: RegExp, skip?: RegExp) => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (!label.test(l) || (skip && skip.test(l))) continue;
      let v = afterLabel(l, label);
      // Label alone on its line: the value is on the next line.
      if (!v) {
        const next = (lines[i + 1] ?? '').trim();
        if (next && !SSID_LABEL.test(next) && !KEY_LABEL_WEAK.test(next)) v = next;
      }
      v = v.replace(/\s+/g, ' ').trim();
      if (v && v.length <= 64) return v;
    }
    return '';
  };
  const ssid = pick(SSID_LABEL);
  const password = pick(KEY_LABEL_STRONG) || pick(KEY_LABEL_WEAK, ADMIN);
  const out: Record<string, string> = {};
  // Network names have no spaces on most stickers; OCR sometimes inserts one around "_" / "-".
  if (ssid) out.ssid = ssid.replace(/\s*([_-])\s*/g, '$1');
  if (password) out.password = password.replace(/\s+/g, '');
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
    const numLine = num ? ls.findIndex((l) => fixDigits(l).replace(/[^\d]/g, '').includes(num.number.slice(-4))) : -1;
    const name = personName(ls, { skip: (l) => !!brand && l.toLowerCase().includes(brand.toLowerCase()), after: numLine });
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
    const name = personName(ls, { skip: (l) => !!brand && detectBrand(l) === brand });
    if (name) fields.memberName = name;
    title = brand ? `${brand} Rewards` : '';
  }
  return { fields, title, checked };
}

// ---------------------------------------------------------------- receipts --

export interface ReceiptResult {
  /** Minor units; null when no total was found. */
  amount: number | null;
  store: string;
  /** YYYY-MM-DD or ''. */
  date: string;
  /** How it was paid, as an account id the user has (GCash, Maya, Cash…). */
  accountId?: string;
  /** Category the store suggests ('' = none). */
  category: string;
}

const MONEY = /(?:₱|php|p)?\s?(\d{1,3}(?:[,\s]\d{3})+|\d+)[.,](\d{2})(?!\d)/i;
const TOTAL_LINE = /\b(?:grand\s*total|total\s*(?:amount|due|sales?)?|amount\s*due|amt\s*due|total\s*php|net\s*amount|balance\s*due|kabuuan|kabuuang\s*halaga|tanan|kinatibuk-?an|kabug-?osan)\b/i;
const NOT_TOTAL = /\b(?:sub\s*-?\s*total|vat(?:able)?|vat-?exempt|discount|diskwento|change|sukli|bayad|gibayad|tendered|cash\s*tendered|items?|qty|zero[- ]rated|service\s*charge)\b/i;
const NOT_STORE = /\b(?:official\s*receipt|sales\s*invoice|invoice|receipt|tin|vat|reg|non-?vat|min|sn|s\/n|pos|cashier|tel|phone|address|st\.|street|brgy|city|branch|date|time|thank|welcome|store\s*#|or\s*#|si\s*#|table|order)\b/i;

const amountOf = (line: string): number | null => {
  const m = MONEY.exec(line.replace(/O(?=\d)|(?<=\d)O/g, '0'));
  if (!m) return null;
  const v = Number(m[1]!.replace(/[,\s]/g, '')) * 100 + Number(m[2]);
  return v > 0 && v < 100_000_000 ? v : null;
};

/** Store name: the first line near the top that reads like a name (letters, not an address or label). */
function storeOf(lines: string[]): string {
  for (const raw of lines.slice(0, 8)) {
    const l = raw.trim().replace(/\s+/g, ' ');
    if (l.length < 3 || l.length > 40 || NOT_STORE.test(l) || /\d{3,}/.test(l)) continue;
    if ((l.match(/[A-Za-zÑñ]/g) ?? []).length < l.replace(/\s/g, '').length * 0.7) continue;
    const brand = detectBrand(l);
    if (brand) return brand;
    // Title Case it ("JOLLIBEE" → "Jollibee").
    return l.toLowerCase().replace(/\b[a-zñ]/g, (c) => c.toUpperCase()).replace(/\bSm\b/g, 'SM');
  }
  return '';
}

/**
 * A photographed receipt → expense fields. The total is the amount on a "TOTAL /
 * AMOUNT DUE" line (not subtotal / VAT / change), else the largest amount on it.
 */
export function parseReceipt(lines: readonly string[], accounts: readonly { id: string; name: string }[] = [], now: Date = new Date()): ReceiptResult {
  const ls = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let amount: number | null = null;
  // Labelled total: the value on the same line, else on the next line. The last such line wins (after a subtotal).
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]!;
    if (!TOTAL_LINE.test(l) || NOT_TOTAL.test(l)) continue;
    const v = amountOf(l) ?? (ls[i + 1] && !TOTAL_LINE.test(ls[i + 1]!) ? amountOf(ls[i + 1]!) : null);
    if (v !== null) amount = v;
  }
  if (amount === null) {
    const all = ls.filter((l) => !NOT_TOTAL.test(l)).map(amountOf).filter((v): v is number => v !== null);
    if (all.length) amount = Math.max(...all);
  }
  const text = ls.join('\n');
  const today = now.toISOString().slice(0, 10);
  // Receipt date: the latest one that isn't in the future (valid-until dates on receipts are years ahead).
  const dates = isoDates(text)
    .concat([...text.matchAll(/(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{2})(?!\d)/g)].map((m) => `20${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`))
    .filter((d) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d) && d <= today && d >= `${Number(today.slice(0, 4)) - 2}-01-01`)
    .sort();
  const store = storeOf(ls);
  const lower = ` ${text.toLowerCase()} `;
  const pay = accounts.find((a) => a.name.length > 1 && new RegExp(`[^a-z]${a.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z]`).test(lower));
  return { amount, store, date: dates.pop() ?? '', ...(pay ? { accountId: pay.id } : {}), category: '' };
}
