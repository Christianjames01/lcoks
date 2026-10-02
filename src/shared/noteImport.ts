// Turns pasted plain-text notes (e.g. copied from the phone's Notes app) into
// vault items: splits the text into separate notes, recognises "Label: value"
// lines, and picks the most likely category.
//
// SECURITY: when a note contains unlabeled text that looks like it could be a
// secret, the whole note is imported as a Secure Note (hidden by default)
// instead of risking a password ending up in a visible "Notes" field.

import { normalizeExpiry } from './cards';
import type { CategoryDef } from './types';

export type SplitMode = 'auto' | 'separator' | 'blank' | 'blank2';

export interface ImportedNote {
  title: string;
  categoryId: string;
  fields: Record<string, string>;
  tags: string[];
  /** Original text, for the preview. */
  source: string;
}

const SEPARATOR_LINE = /^\s*(-{3,}|={3,}|\*{3,}|_{3,}|#{3,})\s*$/;

/** Split pasted text into individual notes. */
export function splitNotes(text: string, mode: SplitMode = 'auto'): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const lines = normalized.split('\n');
  const hasSeparators = lines.some((l) => SEPARATOR_LINE.test(l));
  const effective: SplitMode = mode === 'auto' ? (hasSeparators ? 'separator' : 'blank') : mode;

  let chunks: string[];
  if (effective === 'separator') {
    chunks = [];
    let cur: string[] = [];
    for (const l of lines) {
      if (SEPARATOR_LINE.test(l)) {
        chunks.push(cur.join('\n'));
        cur = [];
      } else cur.push(l);
    }
    chunks.push(cur.join('\n'));
  } else {
    const blanks = effective === 'blank2' ? 2 : 1;
    chunks = normalized.split(new RegExp(`\\n(?:[ \\t]*\\n){${blanks},}`));
  }
  return chunks.map((c) => c.replace(/^\s*\n|\n\s*$/g, '').trim()).filter((c) => c.length > 0);
}

// ----------------------------------------------------------- label mapping --

type Semantic =
  | 'title'
  | 'username'
  | 'email'
  | 'password'
  | 'pin'
  | 'accountNumber'
  | 'accountName'
  | 'bankName'
  | 'customerNumber'
  | 'website'
  | 'network'
  | 'securityType'
  | 'licenseKey'
  | 'product'
  | 'purchaseDate'
  | 'expirationDate'
  | 'recoveryEmail'
  | 'recoveryPhone'
  | 'phone'
  | 'platform'
  | 'accountId'
  | 'cardNumber'
  | 'cvv'
  | 'cardholder'
  | 'cardType'
  | 'idNumber'
  | 'fullName'
  | 'issueDate'
  | 'issuedBy'
  | 'policyNumber'
  | 'coverage'
  | 'bloodType'
  | 'allergies'
  | 'emergency'
  | 'plan'
  | 'price'
  | 'renewal'
  | 'billing'
  | 'payment'
  | 'securityQA'
  | 'notes';

const ALIASES: [RegExp, Semantic][] = [
  [/^((sss|tin|philhealth|pag-?ibig|hdmf|mid|umid|crn|passport|prc|philsys|psn|national id|postal id|voter'?s? id|driver'?s? licen[cs]e)( (number|no\.?|#|id))?|(licen[cs]e|id) (number|no\.?|#))$/, 'idNumber'],
  [/^(policy( number| no\.?| #)?|member( id| number| no\.?)|hmo( number| no\.?| id)?)$/, 'policyNumber'],
  [/^(full name|name on id|insured( person)?|member name|holder)$/, 'fullName'],
  [/^(issued?( on| date)?|date issued|issue date)$/, 'issueDate'],
  [/^(issued by|issuing office|place (of )?issue)$/, 'issuedBy'],
  [/^(coverage|benefits?|plan type)$/, 'coverage'],
  [/^(blood( type| group)?)$/, 'bloodType'],
  [/^(allerg(y|ies)|medical( conditions?)?|conditions?|medications?)$/, 'allergies'],
  [/^(emergency( contacts?| contact person)?|in case of emergency|ice)$/, 'emergency'],
  [/^(plan|subscription|tier)$/, 'plan'],
  [/^(price|amount|cost|fee|monthly fee)$/, 'price'],
  [/^(renew(al|s)?( date)?|next (billing|payment|renewal)( date)?|billing date|due date)$/, 'renewal'],
  [/^(billing( cycle)?|frequency)$/, 'billing'],
  [/^(paid with|payment( method)?|card used)$/, 'payment'],
  [/^(security question|secret question|question ?\d?|q ?\d|answer ?\d?|a ?\d|secret answer)$/, 'securityQA'],
  [/^(title|name|label|app|application|account for)$/, 'title'],
  [/^(uid|account id|player id|game id|riot id|psn id|steam id|server id)$/, 'accountId'],
  [/^(ign|in-?game name|nickname|gamer ?tag)$/, 'username'],
  [/^(user ?name|user|login|log ?in|user ?id|id|handle)$/, 'username'],
  [/^(e-?mail|email address|gmail|mail)$/, 'email'],
  [/^(recovery e-?mail|backup e-?mail|alternate e-?mail)$/, 'recoveryEmail'],
  [/^(recovery (phone|number|mobile)|backup (phone|number))$/, 'recoveryPhone'],
  [/^(pass ?word|pass|pw|pwd|passwd|passcode|password ?\d?)$/, 'password'],
  [/^(pin|m-?pin|atm pin|card pin|pin code|pincode|otp pin)$/, 'pin'],
  [/^(card (number|no\.?|#)|cc( number)?|debit card|credit card)$/, 'cardNumber'],
  [/^(cvv|cvc|cvv2|cvc2|security code|card code)$/, 'cvv'],
  [/^(card ?holder( name)?|name on card)$/, 'cardholder'],
  [/^(card type|type)$/, 'cardType'],
  [/^(exp|exp\.? date|expiry|valid thru|good thru)$/, 'expirationDate'],
  [/^(account (number|no\.?|num|#)|acct (no\.?|number|#)|acc (no\.?|number|#)|account)$/, 'accountNumber'],
  [/^(account name|name on (account|card)|account holder)$/, 'accountName'],
  [/^(bank|bank name)$/, 'bankName'],
  [/^(customer (number|no\.?|id)|cif( no\.?)?|client (id|number))$/, 'customerNumber'],
  [/^(website|web ?site|url|site|link|web)$/, 'website'],
  [/^(wi-?fi( name)?|ssid|network( name)?|router)$/, 'network'],
  [/^(security( type)?|encryption)$/, 'securityType'],
  [/^(license( key)?|licence( key)?|serial( key| number| no\.?)?|product key|activation (key|code)|cd key|key)$/, 'licenseKey'],
  [/^(product|software|program)$/, 'product'],
  [/^(purchase(d)?( date)?|bought|date purchased)$/, 'purchaseDate'],
  [/^(expir(y|ation|es)( date)?|valid until)$/, 'expirationDate'],
  [/^(phone|mobile|mobile (number|no\.?)|cell|contact( number)?|number)$/, 'phone'],
  [/^(platform|service|provider)$/, 'platform'],
  [/^(notes?|remarks?|comment|memo)$/, 'notes']
];

function semanticOf(label: string): Semantic | null {
  const l = label.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.:]$/, '');
  for (const [re, s] of ALIASES) if (re.test(l)) return s;
  return null;
}

const KV_LINE = /^\s*([A-Za-z][A-Za-z0-9 #./-]{0,28}?)\s*(?::|=|\s-\s|–|—)\s*(.+?)\s*$/;

let idLabel = '';

interface Parsed {
  kv: Partial<Record<Semantic, string>>;
  unlabeled: string[];
  extraLabeled: string[];
}

function parseLines(text: string): Parsed {
  idLabel = '';
  const kv: Partial<Record<Semantic, string>> = {};
  const unlabeled: string[] = [];
  const extraLabeled: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = KV_LINE.exec(line);
    if (m && !/^\/\//.test(m[2]!) && !/^https?$/i.test(m[1]!)) {
      const sem = semanticOf(m[1]!);
      if (sem === 'securityQA') {
        kv.securityQA = (kv.securityQA ? kv.securityQA + '\n' : '') + line;
        continue;
      }
      if (sem === 'idNumber' && kv.idNumber === undefined) idLabel = m[1]!;
      if (sem && kv[sem] === undefined) {
        kv[sem] = m[2]!;
        continue;
      }
      extraLabeled.push(line);
      continue;
    }
    unlabeled.push(line);
  }
  return { kv, unlabeled, extraLabeled };
}

// -------------------------------------------------------- category scoring --

const BANKS =
  /\b(bank|bpi|bdo|metrobank|landbank|land bank|pnb|unionbank|union bank|rcbc|china ?bank|security bank|eastwest|east west|gcash|maya|paymaya|seabank|gotyme|cimb|ing|tonik|psbank|ub|atm|debit|credit card|savings|checking|paypal)\b/i;
const SOCIAL =
  /\b(facebook|fb|instagram|ig|tiktok|twitter|x\.com|discord|snapchat|reddit|youtube|telegram|messenger|linkedin|threads|pinterest|twitch|viber|wechat|line)\b/i;
const GAMES =
  /\b(steam|epic games|playstation|psn|xbox|nintendo|riot|valorant|league of legends|lol|wild rift|mobile legends|mlbb|ml|genshin|honkai|hoyoverse|star rail|zenless|roblox|minecraft|call of duty|codm|pubg|free fire|garena|clash of clans|clash royale|supercell|ea games|origin|ubisoft|battle\.net|blizzard|honor of kings|dota|fortnite|among us|game|gaming|ign|uid)\b/i;
const WALLETS = /\b(gcash|maya|paymaya|shopee ?pay|grab ?pay|coins\.ph)\b/i;
const IDS =
  /\b(sss|tin|phil ?health|pag-?ibig|hdmf|umid|passport|driver'?s? licen[cs]e|prc|philsys|national id|postal id|voter'?s? id)\b/i;
const INSURERS =
  /\b(maxicare|intellicare|medicard|philcare|phil ?health|sun ?life|axa|pru ?life|prudential|manulife|fwd|insular|pioneer|etiqa|cocolife|hmo|insurance)\b/i;
const SUBSCRIPTIONS =
  /\b(netflix|spotify|youtube premium|yt premium|disney\+?|prime video|amazon prime|hbo|viu|icloud|apple (music|one|tv)|google one|canva|chatgpt|crunchyroll|game ?pass|ps ?plus|playstation plus)\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Convert common date formats (YYYY-MM-DD, MM/DD/YYYY, "Oct 5, 2026", "5 Oct 2026") to YYYY-MM-DD. */
export function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ok = (y: number, mo: number, d: number) =>
    y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : undefined;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) return ok(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) return ok(+m[3]!, +m[1]!, +m[2]!); // Philippine forms use MM/DD/YYYY
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(v);
  if (m) {
    const mo = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    if (mo >= 0) return ok(+m[3]!, mo + 1, +m[2]!);
  }
  m = /^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4})$/.exec(v);
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    if (mo >= 0) return ok(+m[3]!, mo + 1, +m[1]!);
  }
  return undefined;
}

const ID_TYPES: [RegExp, string][] = [
  [/philsys|national id|\bpsn\b/i, 'PhilSys National ID'],
  [/\bsss\b/i, 'SSS'],
  [/phil ?health/i, 'PhilHealth'],
  [/pag-?ibig|hdmf|\bmid\b/i, 'Pag-IBIG (HDMF)'],
  [/\btin\b|\bbir\b/i, 'TIN (BIR)'],
  [/umid|\bcrn\b/i, 'UMID'],
  [/passport/i, 'Passport'],
  [/driver|licen[cs]e|\blto\b/i, "Driver's License"],
  [/\bprc\b/i, 'PRC License'],
  [/postal/i, 'Postal ID'],
  [/voter/i, "Voter's ID"]
];

const EMAIL_PROVIDERS = /\b(gmail|google account|yahoo|outlook|hotmail|live\.com|icloud|proton ?mail|zoho|e-?mail)\b/i;
const WIFI = /\b(wi-?fi|ssid|router|hotspot|pldt|converge|globe at home|sky ?fiber|modem)\b/i;
const SOFTWARE = /\b(license|licence|serial|product key|activation|windows|office 365|microsoft office|adobe|antivirus|steam key)\b/i;
const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_VALUE = /\b((https?:\/\/)?([a-z0-9-]+\.)+(com|net|org|ph|io|app|dev|gov|edu)(\/\S*)?)\b/i;

/** Heuristic: an unlabeled token that looks like a password or code. */
function looksSecret(line: string): boolean {
  return line
    .split(/\s+/)
    .some((t) => t.length >= 6 && !/^https?:/i.test(t) && !EMAIL_VALUE.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t) || /^\d{4,}$/.test(t));
}

function firstWords(s: string, max = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Classify one note into an item for the vault. */
/** Classify one note. Pass `forceCategoryId` when the user picks the category in the preview. */
export function classifyNote(text: string, categories: CategoryDef[], index = 0, forceCategoryId?: string): ImportedNote {
  const { kv, unlabeled, extraLabeled } = parseLines(text);
  const all = text;

  // A short first unlabeled line is usually the note's title.
  let title = kv.title ?? '';
  const restUnlabeled = [...unlabeled];
  if (!title && restUnlabeled[0] && restUnlabeled[0].length <= 60 && !looksSecret(restUnlabeled[0])) {
    title = restUnlabeled.shift()!;
  }

  const hasCreds = Boolean(kv.password || kv.username || kv.email);
  const brandText = title + ' ' + (kv.platform ?? '');
  let categoryId: string;
  if (kv.cardNumber || kv.cvv) {
    categoryId = 'cards';
  } else if (WALLETS.test(brandText) && (kv.pin || kv.phone || kv.password || kv.accountName || kv.securityQA)) {
    categoryId = 'wallets';
  } else if (kv.idNumber) {
    categoryId = 'ids';
  } else if (kv.policyNumber || kv.bloodType || kv.allergies || kv.emergency || (INSURERS.test(brandText) && (kv.accountNumber || kv.phone || kv.fullName || kv.coverage))) {
    categoryId = 'insurance';
  } else if (IDS.test(title) && (kv.phone || kv.accountNumber)) {
    categoryId = 'ids';
  } else if (SUBSCRIPTIONS.test(brandText) && (hasCreds || kv.plan || kv.price || kv.renewal)) {
    categoryId = 'subscriptions';
  } else if (kv.bankName || kv.accountNumber || kv.customerNumber || (BANKS.test(all) && (kv.pin || kv.password || kv.accountNumber || kv.username))) {
    categoryId = 'banking';
  } else if (kv.network || (WIFI.test(all) && kv.password)) {
    categoryId = 'others';
  } else if (kv.licenseKey || (SOFTWARE.test(all) && (kv.product || /key|serial/i.test(all)))) {
    categoryId = 'software';
  } else if ((kv.accountId || GAMES.test(title + ' ' + (kv.platform ?? '') + ' ' + (kv.website ?? ''))) && (hasCreds || kv.accountId)) {
    categoryId = 'games';
  } else if (SOCIAL.test(title + ' ' + (kv.platform ?? '') + ' ' + (kv.website ?? '')) && hasCreds) {
    categoryId = 'social';
  } else if (EMAIL_PROVIDERS.test(title + ' ' + (kv.platform ?? '')) && kv.password) {
    categoryId = 'email';
  } else if (hasCreds) {
    categoryId = 'personal';
  } else {
    categoryId = 'notes';
  }

  // Unlabeled text that might be a secret → keep the whole note hidden.
  const leftovers = [...restUnlabeled, ...extraLabeled];
  if (categoryId !== 'notes' && restUnlabeled.some(looksSecret)) categoryId = 'notes';
  if (forceCategoryId && categories.some((c) => c.id === forceCategoryId)) categoryId = forceCategoryId;

  const category = categories.find((c) => c.id === categoryId) ?? categories.find((c) => c.id === 'notes')!;
  const fields: Record<string, string> = {};
  const has = (key: string) => category.fields.some((f) => f.key === key);
  const put = (key: string, value: string | undefined) => {
    if (value && has(key) && !fields[key]) fields[key] = value.trim();
  };

  if (category.id === 'notes') {
    fields.content = text.trim();
  } else {
    put('password', kv.password);
    put('pin', kv.pin);
    put('accountNumber', kv.accountNumber);
    put('accountName', kv.accountName);
    put('bankName', kv.bankName);
    put('customerNumber', kv.customerNumber);
    put('website', kv.website ?? (all.replace(/[^\s@]+@[^\s@]+/g, ' ').match(URL_VALUE)?.[1] ?? undefined));
    put('profileUrl', kv.website);
    put('name', kv.network);
    put('licenseKey', kv.licenseKey);
    put('product', kv.product);
    put('purchaseDate', kv.purchaseDate && /^\d{4}-\d{2}-\d{2}$/.test(kv.purchaseDate) ? kv.purchaseDate : undefined);
    put('expirationDate', kv.expirationDate && /^\d{4}-\d{2}-\d{2}$/.test(kv.expirationDate) ? kv.expirationDate : undefined);
    put('recoveryEmail', kv.recoveryEmail);
    put('recoveryPhone', kv.recoveryPhone ?? kv.phone);
    put('platform', kv.platform);
    put('accountId', kv.accountId);
    put('cardNumber', kv.cardNumber);
    put('cvv', kv.cvv);
    put('cardholder', kv.cardholder ?? kv.accountName);
    put('cardType', kv.cardType && ['Debit', 'Credit', 'Prepaid', 'ATM', 'Virtual'].find((o) => kv.cardType!.toLowerCase().includes(o.toLowerCase())));
    if (has('expiry') && kv.expirationDate) {
      const exp = normalizeExpiry(kv.expirationDate);
      if (exp) fields.expiry = exp;
    }
    put('service', kv.platform);
    // Email address: the dedicated field where one exists, otherwise use it as the username.
    const emailValue = kv.email ?? (kv.username && EMAIL_VALUE.test(kv.username) ? undefined : all.match(EMAIL_VALUE)?.[0]);
    if (has('email')) put('email', emailValue);
    else if (!kv.username) put('username', emailValue);
    put('username', kv.username);
    if ((category.id === 'banking' || category.id === 'cards') && !fields.bankName) {
      const m = all.match(BANKS);
      if (m && !/^(bank|atm|debit|savings|checking)$/i.test(m[1]!)) fields.bankName = m[1]!.toUpperCase();
    }
    const extraNotes: string[] = [];
    const date = (key: string, value: string | undefined, label: string) => {
      if (!value || !has(key)) return;
      const iso = toIsoDate(value);
      if (iso) put(key, iso);
      else extraNotes.push(`${label}: ${value}`);
    };
    if (category.id === 'wallets') {
      put('provider', kv.platform ?? capitalize(brandText.match(WALLETS)?.[1] ?? ''));
      put('mobileNumber', kv.phone);
      put('mpin', kv.pin);
    }
    if (category.id === 'ids') {
      const idSource = `${idLabel} ${title}`;
      put('idType', ID_TYPES.find(([re]) => re.test(idSource))?.[1] ?? 'Other');
      put('idNumber', kv.idNumber ?? kv.phone ?? kv.accountNumber);
      date('expiryDate', kv.expirationDate, 'Expires');
      date('issueDate', kv.issueDate, 'Issued');
      put('issuedBy', kv.issuedBy);
    }
    if (category.id === 'insurance') {
      put('provider', kv.platform ?? capitalize(brandText.match(INSURERS)?.[1] ?? ''));
      const t = `${title} ${kv.platform ?? ''} ${kv.coverage ?? ''}`.toLowerCase();
      put(
        'policyType',
        /philhealth/.test(t) ? 'PhilHealth' : /maxicare|intellicare|medicard|philcare|hmo/.test(t) ? 'HMO' : /life/.test(t) ? 'Life insurance' : /car|auto|vehicle/.test(t) ? 'Car insurance' : undefined
      );
      put('memberNumber', kv.policyNumber ?? kv.idNumber ?? kv.accountNumber);
      put('coverage', kv.coverage);
      date('expiryDate', kv.expirationDate, 'Valid until');
      put('bloodType', kv.bloodType && ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].find((b) => b === kv.bloodType!.replace(/\s/g, '').toUpperCase()));
      put('allergies', kv.allergies);
      put('emergencyContacts', kv.emergency);
    }
    if (category.id === 'subscriptions') {
      put('service', kv.platform ?? (title && !title.startsWith('Imported') ? title : undefined));
      put('plan', kv.plan);
      put('price', kv.price);
      const cyc = `${kv.billing ?? ''} ${kv.price ?? ''} ${kv.plan ?? ''}`.toLowerCase();
      put('billingCycle', /year|annual/.test(cyc) ? 'Yearly' : /quarter/.test(cyc) ? 'Quarterly' : /week/.test(cyc) ? 'Weekly' : /month|\/mo/.test(cyc) ? 'Monthly' : undefined);
      date('renewalDate', kv.renewal, 'Renews');
      put('paymentMethod', kv.payment);
    }
    put('fullName', kv.fullName ?? kv.accountName);
    put('insured', kv.fullName ?? kv.accountName);
    put('securityQA', kv.securityQA);
    if (kv.securityQA && !has('securityQA')) extraNotes.push('(security questions were moved to a hidden field)');
    const notes = [...leftovers, ...extraNotes.filter((n) => !n.startsWith('(')), kv.securityType ? `Wi-Fi security: ${kv.securityType}` : '', kv.notes ?? ''].filter(Boolean).join('\n');
    put('notes', notes);
  }

  if (!title) {
    title =
      fields.bankName ||
      fields.name ||
      fields.product ||
      fields.platform ||
      fields.service ||
      (category.id === 'notes' ? firstWords(text.split('\n')[0] ?? '') : '') ||
      `Imported ${category.name} ${index + 1}`;
  }
  if (category.id === 'games' && !fields.platform && title && !title.startsWith('Imported')) fields.platform = title;
  if (category.id === 'email' && !fields.service && EMAIL_PROVIDERS.test(title)) fields.service = capitalize(title.match(EMAIL_PROVIDERS)![1]!.toLowerCase());

  return { title: firstWords(title, 200), categoryId: category.id, fields, tags: ['imported'], source: text };
}

export function importNotes(text: string, categories: CategoryDef[], mode: SplitMode = 'auto'): ImportedNote[] {
  return splitNotes(text, mode).map((n, i) => classifyNote(n, categories, i));
}
