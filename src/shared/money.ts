// Expense & income tracking: categories, the quick-entry parser ("lunch 150",
// "salary 30k") and small date / money helpers. Pure functions, shared by the
// vault core (validation) and the renderer.

export type TxKind = 'expense' | 'income';

/** Amounts are stored as integers in minor units (centavos / cents). */
export interface Transaction {
  id: string;
  kind: TxKind;
  amount: number;
  category: string;
  note: string;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  /** Money account the record belongs to (Cash, GCash…); optional. */
  accountId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionInput {
  id?: string;
  kind: TxKind;
  amount: number;
  category: string;
  note: string;
  date: string;
  accountId?: string;
}

/** Where the money is: wallet cash, an e-wallet or a bank account. */
export interface MoneyAccount {
  id: string;
  name: string;
  kind: AccountKind;
  /** Balance before the first record, minor units (may be negative, e.g. a credit card). */
  opening: number;
  /** Card colour chosen by the user (#rrggbb); none = automatic (bank colours / palette). */
  color?: string;
  /** Card look; none = gradient. */
  style?: CardStyle;
  /** Last 4 digits shown on the card as •••• 1234 (optional). */
  last4?: string;
}

export type CardStyle = 'gradient' | 'solid' | 'glass' | 'black';
export const CARD_STYLES: [CardStyle, string][] = [
  ['gradient', 'Gradient'],
  ['solid', 'Solid'],
  ['glass', 'Glass'],
  ['black', 'Black']
];
/** Colours offered for cards (plus a custom one). */
export const CARD_COLORS = [
  '#0a5bd6', '#1c3f94', '#5b3cc4', '#8e24aa', '#d81b60', '#c8102e', '#e53935', '#f4511e',
  '#f59e0b', '#2e7d32', '#0f9d58', '#00897b', '#039be5', '#6d4c41', '#455a64', '#1c1c1e'
];
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/** Black or white text, whichever reads better on the colour. */
export function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.45 ? '#111111' : '#ffffff';
}

export type AccountKind = 'cash' | 'ewallet' | 'bank' | 'credit' | 'other';

/** Display order of account groups (wallets page, pickers). */
export const ACCOUNT_KIND_ORDER: readonly AccountKind[] = ['cash', 'ewallet', 'bank', 'credit', 'other'];

/** Card colour for an account: familiar colours for common PH banks / e-wallets, else one picked from the name. */
export function accountColor(a: Pick<MoneyAccount, 'name' | 'kind'> & { color?: string }): { bg: string; fg: string } {
  if (isHexColor(a.color)) return { bg: a.color, fg: readableOn(a.color) };
  const n = a.name.toLowerCase();
  const known: [RegExp, string, string?][] = [
    [/gcash/, '#0a5bd6'],
    [/maya|paymaya/, '#0f9d58'],
    [/bdo/, '#0b3a8c'],
    [/bpi/, '#c8102e'],
    [/metrobank|metro bank/, '#1c3f94'],
    [/landbank|land bank/, '#00843d'],
    [/union ?bank/, '#f47920'],
    [/security ?bank/, '#0097d7'],
    [/rcbc/, '#0b63b5'],
    [/china ?bank/, '#b5121b'],
    [/pnb/, '#1f3c88'],
    [/seabank|sea bank/, '#ff6a13'],
    [/gotyme/, '#5b3cc4'],
    [/cimb/, '#9e1b32'],
    [/shopee/, '#ee4d2d'],
    [/grab ?pay/, '#00a84f'],
    [/coins/, '#1a73e8'],
    [/wise/, '#9fe870', '#0e2a0e'],
    [/paypal/, '#003087']
  ];
  for (const [re, bg, fg] of known) if (re.test(n)) return { bg, fg: fg ?? '#ffffff' };
  if (a.kind === 'cash') return { bg: '#2e7d32', fg: '#ffffff' };
  const palette = ['#e53935', '#8e24aa', '#3949ab', '#00897b', '#f4511e', '#6d4c41', '#d81b60', '#5e35b1', '#039be5', '#43a047'];
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { bg: palette[h % palette.length]!, fg: '#ffffff' };
}

export const DEFAULT_ACCOUNTS: readonly MoneyAccount[] = [
  { id: 'cash', name: 'Cash', kind: 'cash', opening: 0 },
  { id: 'gcash', name: 'GCash', kind: 'ewallet', opening: 0 },
  { id: 'maya', name: 'Maya', kind: 'ewallet', opening: 0 },
  { id: 'bank', name: 'Bank', kind: 'bank', opening: 0 }
];

export const MAX_ACCOUNTS = 30;

/** Current balance of every account: opening + money in − money out. */
export function balances(accounts: readonly MoneyAccount[], list: readonly Transaction[]): Map<string, number> {
  const m = new Map(accounts.map((a) => [a.id, a.opening]));
  for (const t of list) {
    if (!t.accountId || !m.has(t.accountId)) continue;
    m.set(t.accountId, m.get(t.accountId)! + (t.kind === 'income' ? t.amount : -t.amount));
  }
  return m;
}

/** The account a quick entry names ("grab 85 gcash"), by id or name. */
export function accountIn(text: string, accounts: readonly MoneyAccount[]): MoneyAccount | undefined {
  const words = ` ${text.toLowerCase()} `;
  return accounts.find((a) => [a.id, a.name.toLowerCase()].some((w) => w.length >= 2 && hasWord(words, w)));
}

/** Index of `word` as a whole word (or phrase) in `text`, ignoring case; -1 if absent. */
function wordIndex(text: string, word: string): number {
  const lower = text.toLowerCase();
  const w = word.toLowerCase();
  const letter = /[\p{L}\p{N}]/u;
  for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + 1)) {
    const before = i === 0 ? '' : lower[i - 1]!;
    const after = lower[i + w.length] ?? '';
    if (!letter.test(before) && !letter.test(after)) return i;
  }
  return -1;
}
const hasWord = (text: string, word: string) => wordIndex(text, word) !== -1;

export type MoneyIcon =
  | 'coffee'
  | 'food'
  | 'cart'
  | 'car'
  | 'bolt'
  | 'home'
  | 'bag'
  | 'health'
  | 'film'
  | 'book'
  | 'sparkles'
  | 'users'
  | 'dots'
  | 'wallet'
  | 'briefcase'
  | 'gift'
  | 'trending'
  // Extra icons for the user's own categories
  | 'gamepad'
  | 'cashout'
  | 'phone'
  | 'paw'
  | 'plane'
  | 'dumbbell'
  | 'music'
  | 'baby'
  | 'tag';

export interface MoneyCategory {
  id: string;
  name: string;
  kind: TxKind;
  icon: MoneyIcon;
  /** Words that pick this category in quick entry (lower case). */
  words: string[];
}

export const MONEY_CATEGORIES: readonly MoneyCategory[] = [
  {
    id: 'food',
    name: 'Food & Drinks',
    kind: 'expense',
    icon: 'food',
    words: ['food', 'lunch', 'dinner', 'breakfast', 'merienda', 'snack', 'jollibee', 'mcdo', 'mcdonalds', 'kfc', 'chowking', 'pizza', 'milktea', 'drinks', 'restaurant', 'eat', 'kain']
  },
  {
    id: 'coffee',
    name: 'Coffee',
    kind: 'expense',
    icon: 'coffee',
    words: ['coffee', 'kape', 'cafe', 'café', 'starbucks', 'latte', 'americano', 'espresso', 'cappuccino', 'macchiato', 'mocha', 'frappe', 'frappuccino', 'cold brew', 'tim hortons', 'dunkin', 'coffee bean', 'bo\'s', 'kopi']
  },
  { id: 'groceries', name: 'Groceries', kind: 'expense', icon: 'cart', words: ['grocery', 'groceries', 'market', 'palengke', 'supermarket', 'sm', 'puregold', 'savemore', 'rice', 'bigas'] },
  {
    id: 'transport',
    name: 'Fare & Transport',
    kind: 'expense',
    icon: 'car',
    words: ['transport', 'grab', 'angkas', 'joyride', 'jeep', 'jeepney', 'tricycle', 'taxi', 'bus', 'mrt', 'lrt', 'fare', 'pamasahe', 'gas', 'fuel', 'gasoline', 'parking', 'toll', 'uber']
  },
  {
    id: 'bills',
    name: 'Bills & Utilities',
    kind: 'expense',
    icon: 'bolt',
    words: ['bill', 'bills', 'electric', 'electricity', 'meralco', 'davao light', 'water', 'internet', 'wifi', 'pldt', 'converge', 'globe', 'smart', 'load', 'postpaid', 'phone']
  },
  { id: 'housing', name: 'Housing', kind: 'expense', icon: 'home', words: ['rent', 'upa', 'dorm', 'boarding', 'condo', 'mortgage', 'amortization', 'association'] },
  { id: 'shopping', name: 'Shopping', kind: 'expense', icon: 'bag', words: ['shopping', 'shopee', 'lazada', 'clothes', 'shoes', 'shirt', 'gadget', 'mall'] },
  { id: 'health', name: 'Health', kind: 'expense', icon: 'health', words: ['health', 'medicine', 'gamot', 'doctor', 'hospital', 'pharmacy', 'mercury', 'checkup', 'dental', 'vitamins', 'gym'] },
  { id: 'entertainment', name: 'Entertainment', kind: 'expense', icon: 'film', words: ['movie', 'cinema', 'netflix', 'spotify', 'youtube', 'game', 'games', 'steam', 'concert', 'subscription'] },
  { id: 'education', name: 'Education', kind: 'expense', icon: 'book', words: ['tuition', 'school', 'books', 'book', 'course', 'class', 'project', 'printing', 'print', 'xerox'] },
  { id: 'personal', name: 'Personal Care', kind: 'expense', icon: 'sparkles', words: ['haircut', 'salon', 'barber', 'skincare', 'toiletries', 'laundry'] },
  { id: 'family', name: 'Family & Gifts', kind: 'expense', icon: 'users', words: ['family', 'gift', 'regalo', 'birthday', 'donation', 'church', 'offering', 'padala'] },
  { id: 'other', name: 'Other', kind: 'expense', icon: 'dots', words: [] },
  { id: 'salary', name: 'Salary', kind: 'income', icon: 'wallet', words: ['salary', 'sweldo', 'sahod', 'payroll', 'paycheck', 'wage'] },
  { id: 'business', name: 'Business', kind: 'income', icon: 'briefcase', words: ['business', 'sales', 'sold', 'client', 'freelance', 'commission', 'income'] },
  { id: 'gifts', name: 'Gifts & Allowance', kind: 'income', icon: 'gift', words: ['allowance', 'baon', 'received', 'bonus', '13th'] },
  { id: 'topup', name: 'Cash in / Top-up', kind: 'income', icon: 'wallet', words: ['cash in', 'cashin', 'top up', 'topup', 'add money', 'deposit', 'load wallet'] },
  { id: 'other-income', name: 'Other income', kind: 'income', icon: 'trending', words: ['refund', 'interest', 'cashback', 'dividend', 'reimbursement'] }
];

export const MONEY_CATEGORY_IDS: ReadonlySet<string> = new Set(MONEY_CATEGORIES.map((c) => c.id));

/** Icons the user can pick for their own categories. */
export const CUSTOM_MONEY_ICONS: readonly MoneyIcon[] = ['tag', 'gamepad', 'cashout', 'phone', 'paw', 'plane', 'dumbbell', 'music', 'baby', 'film', 'bag', 'food', 'car', 'gift', 'wallet', 'briefcase', 'health', 'book', 'sparkles', 'home'];
export const MAX_MONEY_CATEGORIES = 40;

/**
 * The user's own categories (stored in the vault). The renderer registers the
 * unlocked vault's list here so names and icons show everywhere; the vault core
 * passes its list explicitly instead.
 */
let customMoney: readonly MoneyCategory[] = [];
export function setCustomMoneyCategories(list: readonly MoneyCategory[]): void {
  customMoney = list;
}
/** Built-in categories, the user's own ones before "Other". */
export function allMoneyCategories(custom: readonly MoneyCategory[] = customMoney): MoneyCategory[] {
  const out: MoneyCategory[] = [];
  for (const kind of ['expense', 'income'] as const) {
    const base = MONEY_CATEGORIES.filter((c) => c.kind === kind);
    const other = base.filter((c) => c.id === defaultCategory(kind));
    out.push(...base.filter((c) => c.id !== defaultCategory(kind)), ...custom.filter((c) => c.kind === kind), ...other);
  }
  return out;
}

export const moneyCategory = (id: string, custom: readonly MoneyCategory[] = customMoney): MoneyCategory =>
  MONEY_CATEGORIES.find((c) => c.id === id) ?? custom.find((c) => c.id === id) ?? MONEY_CATEGORIES.find((c) => c.id === 'other')!;

export const defaultCategory = (kind: TxKind) => (kind === 'income' ? 'other-income' : 'other');

/** Largest amount accepted (minor units): one trillion in major units. */
export const MAX_AMOUNT = 100_000_000_000_000;

export const CURRENCIES = ['PHP', 'USD', 'EUR', 'GBP', 'JPY', 'KRW', 'SGD', 'AUD', 'CAD', 'HKD', 'CNY', 'INR', 'IDR', 'MYR', 'THB', 'VND', 'AED', 'SAR'] as const;

// ------------------------------------------------------------------ dates --

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD for a local date. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse YYYY-MM-DD as a local date (midday, so DST never shifts the day). */
export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

export const isDayKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && dayKey(parseDay(v)) === v;

/** YYYY-MM of a day key. */
export const monthOf = (day: string) => day.slice(0, 7);

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y!, m! - 1 + delta, 1, 12);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// ------------------------------------------------------------------ money --

/** Minor units → display string, e.g. "₱1,250.50" (no decimals when whole). */
export function formatMoney(minor: number, currency: string, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const digits = currency === 'JPY' || currency === 'KRW' || currency === 'VND' || currency === 'IDR' ? 0 : 2;
  const value = minor / 100;
  const whole = Number.isInteger(value);
  let s: string;
  try {
    s = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: opts.compact && Math.abs(value) >= 10_000 ? 'compact' : 'standard',
      minimumFractionDigits: whole || opts.compact ? 0 : digits,
      // Compact: "₱236" below 10,000, "₱12.5K" above.
      maximumFractionDigits: opts.compact ? (Math.abs(value) >= 10_000 ? 1 : 0) : digits,
      signDisplay: opts.sign ? 'exceptZero' : 'auto'
    }).format(value);
  } catch {
    s = `${currency} ${value.toFixed(whole ? 0 : digits)}`;
  }
  return s;
}

/** Totals for a list of transactions (minor units). */
export function totals(list: readonly Transaction[]): { expense: number; income: number; net: number } {
  let expense = 0;
  let income = 0;
  for (const t of list) {
    if (t.kind === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { expense, income, net: income - expense };
}

// ------------------------------------------------------------ quick entry --

export interface QuickParse {
  kind: TxKind;
  amount: number;
  category: string;
  note: string;
  date: string;
  accountId?: string;
}

const INCOME_HINT = /^\+|\b(salary|sweldo|sahod|income|bonus|allowance|baon|received|refund|cashback|sold|sales|interest|dividend|commission|payroll|freelance|cash ?in|top ?up|add money|deposit)\b/i;
const AMOUNT_RE = /(^|\s)([+-]?)(?:₱|php|p|\$|usd|€|£|¥)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(k|m)?(?=\s|$)/i;

/**
 * Understand short entries like "lunch 150", "grab 85.50 yesterday gcash",
 * "cash in gcash 500" or "salary 30k". Returns null when no amount is found.
 * `accounts`: names to look for ("gcash", "maya"…); the match becomes accountId.
 */
export function parseQuick(text: string, today: Date = new Date(), accounts: readonly MoneyAccount[] = [], custom: readonly MoneyCategory[] = customMoney): QuickParse | null {
  let rest = ` ${text.trim()} `;
  if (!rest.trim()) return null;

  let date = dayKey(today);
  const day = new Date(today);
  if (/\b(yesterday|kahapon)\b/i.test(rest)) {
    day.setDate(day.getDate() - 1);
    date = dayKey(day);
    rest = rest.replace(/\b(yesterday|kahapon)\b/gi, ' ');
  } else if (/\b(today|ngayon)\b/i.test(rest)) {
    rest = rest.replace(/\b(today|ngayon)\b/gi, ' ');
  }

  const m = AMOUNT_RE.exec(rest);
  if (!m) return null;
  const sign = m[2];
  const int = m[3]!.replace(/,/g, '');
  const frac = (m[4] ?? '').padEnd(2, '0');
  let amount = Number(int) * 100 + Number(frac || 0);
  const mult = m[5]?.toLowerCase();
  if (mult === 'k') amount *= 1000;
  if (mult === 'm') amount *= 1_000_000;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
  rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);

  // "… gcash": the account is not part of the note.
  // ("cash in gcash 500" names GCash, not the Cash account.)
  const account = accountIn(rest.replace(/\b(cash ?in|cash ?out|top ?up)\b/gi, ' '), accounts);
  if (account) {
    for (const w of [account.name, account.id]) {
      const i = wordIndex(rest, w);
      if (i !== -1) {
        rest = rest.slice(0, i) + ' ' + rest.slice(i + w.length);
        break;
      }
    }
  }

  const kind: TxKind = sign === '+' || (sign !== '-' && INCOME_HINT.test(text.trim())) ? 'income' : 'expense';
  // The user's own categories first: their words are more specific ("ml", "cashout").
  const match = [...custom, ...MONEY_CATEGORIES].filter((c) => c.kind === kind).find((c) => c.words.some((w) => hasWord(rest, w)));
  const note = rest.replace(/\s+/g, ' ').trim();
  return {
    kind,
    amount,
    category: match?.id ?? defaultCategory(kind),
    note: note ? note.charAt(0).toUpperCase() + note.slice(1) : '',
    date,
    ...(account ? { accountId: account.id } : {})
  };
}
