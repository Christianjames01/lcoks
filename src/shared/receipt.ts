// Receipt details: what a photographed receipt says, line by line — store, each
// item (quantity, name, unit price, amount), subtotal, VAT, discounts, total, and
// how it was paid (cash given and change). Pure functions; the text comes from the
// phone's on-device reader (VaultNativePlugin.recognizeText).

export interface ReceiptItem {
  qty: number;
  name: string;
  /** Price of one (minor units); 0 when the receipt doesn't show it. */
  price: number;
  /** Line amount (minor units). */
  amount: number;
}

export interface ReceiptDetails {
  store: string;
  /** Branch / address line under the store name ('' if none). */
  branch: string;
  items: ReceiptItem[];
  subtotal: number;
  /** "VATable sales" (the amount VAT is computed on). */
  vatable: number;
  /** The VAT itself (12% in the Philippines). */
  vat: number;
  vatExempt: number;
  discount: number;
  serviceCharge: number;
  total: number;
  /** How it was paid: "Cash", "GCash", "Card"… ('' if not printed). */
  payment: string;
  /** Cash given (tendered). */
  cash: number;
  change: number;
  /** Receipt / OR number if printed. */
  number: string;
}

export const MAX_RECEIPT_ITEMS = 60;

const MONEY_G = /(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g;
const money = (s: string) => [...s.matchAll(MONEY_G)].map((m) => Number(m[1]!.replace(/,/g, '')) * 100 + Number(m[2]));

const L = {
  subtotal: /\bsub\s*-?\s*total\b/i,
  vatable: /\bvat(?:able)?\s*(?:sales|amt\.?\s*base)?\b(?!\s*(?:amount|12|\())/i,
  vatAmount: /\b(?:vat\s*(?:amount|amt|12\s*%|\(\s*12\s*%\s*\)|tax)|12\s*%\s*vat|vat\s*input|value\s*added\s*tax)\b|^\s*vat\s*[:\s]/i,
  vatExempt: /\bvat\s*-?\s*exempt\b/i,
  zeroRated: /\bzero\s*-?\s*rated\b/i,
  discount: /\b(?:discount|disc\.?|less|senior|pwd|promo)\b/i,
  service: /\bservice\s*charge\b|\bsvc\b/i,
  total: /\b(?:grand\s*total|total\s*(?:amount|due|sales?|php)?|amount\s*due|amt\s*due|net\s*amount|balance\s*due)\b/i,
  cash: /\b(?:cash(?:\s*tendered)?|tendered|amount\s*tendered|amt\s*tendered|amount\s*paid|payment)\b/i,
  change: /\b(?:change|sukli)\b/i,
  cardOrWallet: /\b(gcash|maya|paymaya|shopeepay|grabpay|visa|mastercard|master\s*card|credit\s*card|debit\s*card|card|bdo|bpi)\b/i,
  header: /\b(?:tin|vat\s*reg|non-?vat|min\s*#?|serial|s\/n|sn\s*:|permit|ptu|accreditation|pos\s*#?|terminal|cashier|server|table|guest|order\s*(?:no|#)|date|time|tel|phone|mobile|www\.|\.com|thank|welcome|come\s*again|official\s*receipt|sales\s*invoice|invoice\s*(?:no|#)|this\s*serves|bir|valid\s*for|customer|address|name\s*:|signature)\b/i,
  number: /\b(?:or|si|receipt|invoice|trans(?:action)?)\s*(?:no\.?|#|number)\s*[:#]?\s*([A-Z0-9-]{3,20})/i,
  address: /\b(?:st\.?|street|ave\.?|avenue|road|rd\.?|brgy\.?|barangay|city|mall|branch|bldg|building|floor|plaza|centre|center|davao|manila|cebu|quezon|makati|pasig|taguig)\b/i
};

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(/-])([a-zñ])/g, (_m, a: string, b: string) => a + b.toUpperCase());

/** Clean up an item name: drop codes, stray symbols and the qty / price bits. */
function itemName(raw: string): string {
  return raw
    .replace(MONEY_G, ' ')
    .replace(/(?:^|\s)[@x×*]\s*(?=\s|$)/gi, ' ')
    .replace(/(?:^|\s)\d+\s*(?:pcs?|x|×|@)(?=\s|$)/gi, ' ')
    .replace(/^\s*\d{1,3}\s+/, '')
    .replace(/\s+\d{1,3}\s*$/, '')
    .replace(/[|_*#=]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "2 x Iced Latte @120.00 240.00", "1 Chickenjoy C1 129.00", "Burger 2 59.00 118.00", "Iced Latte  2 @ 120.00". */
function itemFrom(line: string): ReceiptItem | null {
  const amounts = money(line);
  if (!amounts.length) return null;
  const letters = (line.replace(MONEY_G, '').match(/[A-Za-zÑñ]/g) ?? []).length;
  if (letters < 2) return null;
  let qty = 1;
  const q =
    /^\s*(\d{1,3})\s*(?:x|×|pcs?|@)?\s+(?=[A-Za-z])/i.exec(line) ?? /(?:^|\s)(?:x|×)\s*(\d{1,3})(?=\s|$)/i.exec(line) ?? /(?:^|\s)(\d{1,3})\s*(?:x|×|@|pcs?)(?=\s|$)/i.exec(line) ?? /[A-Za-z)]\s+(\d{1,3})\s+\d[\d,]*\.\d{2}/.exec(line);
  if (q) qty = Math.max(1, Math.min(999, Number(q[1])));
  const amount = amounts[amounts.length - 1]!;
  let price = amounts.length >= 2 ? amounts[amounts.length - 2]! : qty > 1 ? Math.round(amount / qty) : amount;
  // Two numbers but they don't multiply out: the first is the unit price only if qty × price = amount.
  if (amounts.length >= 2 && qty > 1 && Math.abs(price * qty - amount) > qty) price = Math.round(amount / qty);
  if (amounts.length >= 2 && qty === 1 && price !== amount && price > 0 && amount % price === 0 && amount / price <= 99) qty = amount / price;
  const name = itemName(line);
  if (name.length < 2) return null;
  return { qty, name: titleCase(name).slice(0, 60), price, amount };
}

export function readReceipt(lines: readonly string[]): ReceiptDetails {
  const ls = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const r: ReceiptDetails = { store: '', branch: '', items: [], subtotal: 0, vatable: 0, vat: 0, vatExempt: 0, discount: 0, serviceCharge: 0, total: 0, payment: '', cash: 0, change: 0, number: '' };
  /** The amount on a label line, else the next line's (labels and values can be printed apart). */
  const valueAt = (i: number): number => {
    const own = money(ls[i]!);
    if (own.length) return own[own.length - 1]!;
    const next = ls[i + 1] ?? '';
    const nm = money(next);
    return nm.length && (next.match(/[A-Za-z]/g) ?? []).length < 3 ? nm[0]! : 0;
  };
  let firstItem = -1;
  let pendingName = '';
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]!;
    const n = L.number.exec(l);
    if (n && !r.number) r.number = n[1]!;
    if (L.change.test(l)) {
      r.change = valueAt(i);
      continue;
    }
    if (L.subtotal.test(l)) {
      r.subtotal = valueAt(i);
      continue;
    }
    if (L.vatExempt.test(l)) {
      r.vatExempt = valueAt(i);
      continue;
    }
    if (L.zeroRated.test(l)) continue;
    if (L.vatAmount.test(l) && !/vatable/i.test(l)) {
      r.vat = valueAt(i);
      continue;
    }
    if (/\bvatable\b/i.test(l)) {
      r.vatable = valueAt(i);
      continue;
    }
    if (L.service.test(l)) {
      r.serviceCharge = valueAt(i);
      continue;
    }
    if (L.discount.test(l) && money(l).length) {
      r.discount += valueAt(i);
      continue;
    }
    if (L.total.test(l)) {
      const v = valueAt(i);
      if (v) r.total = v; // the last total wins (after subtotal / VAT lines)
      continue;
    }
    const wallet = L.cardOrWallet.exec(l);
    if (wallet && money(l).length) {
      r.payment = titleCase(wallet[1]!.replace(/paymaya/i, 'maya').replace(/master\s*card/i, 'mastercard')).replace(/^Gcash$/, 'GCash').replace(/^Bdo$/, 'BDO').replace(/^Bpi$/, 'BPI');
      if (!r.total) r.total = valueAt(i);
      continue;
    }
    if (L.cash.test(l) && !L.total.test(l)) {
      const v = valueAt(i);
      if (v) {
        r.cash = v;
        r.payment ||= 'Cash';
      }
      continue;
    }
    if (L.header.test(l) || /\b\d{1,2}[:/]\d{2}\b.*\b\d{2,4}\b/.test(l)) continue;
    // Items: an amount on the line, or a name line followed by a "qty x price amount" line.
    const amounts = money(l);
    const letters = (l.replace(MONEY_G, '').match(/[A-Za-zÑñ]/g) ?? []).length;
    if (amounts.length && letters < 2 && pendingName) {
      const it = itemFrom(`${pendingName} ${l}`);
      if (it && r.items.length < MAX_RECEIPT_ITEMS) r.items.push(it);
      pendingName = '';
      if (firstItem < 0) firstItem = i;
      continue;
    }
    const it = itemFrom(l);
    if (it) {
      if (firstItem < 0) firstItem = i;
      if (r.items.length < MAX_RECEIPT_ITEMS) r.items.push(it);
      pendingName = '';
      continue;
    }
    // A name without a price: maybe its numbers are on the next line.
    if (!amounts.length && letters >= 3 && firstItem >= 0 && !L.address.test(l)) pendingName = l;
    else if (!amounts.length && letters >= 3 && firstItem < 0) pendingName = l;
  }
  // Header: store name, then the branch / address line under it.
  const head = ls.slice(0, Math.max(1, firstItem < 0 ? 8 : Math.min(firstItem, 8)));
  for (let i = 0; i < head.length; i++) {
    const l = head[i]!;
    if (L.header.test(l) || /\d{3,}/.test(l) || l.length < 3 || l.length > 48 || money(l).length) continue;
    if ((l.match(/[A-Za-zÑñ&']/g) ?? []).length < l.replace(/\s/g, '').length * 0.7) continue;
    if (!r.store) {
      r.store = titleCase(l).replace(/\bSm\b/g, 'SM').replace(/\bMcdonald'S\b/g, "McDonald's");
      continue;
    }
    if (!r.branch && L.address.test(l)) {
      r.branch = titleCase(l).replace(/\bSm\b/g, 'SM');
      break;
    }
  }
  // Fill gaps the receipt implies.
  const itemsSum = r.items.reduce((a, it) => a + it.amount, 0);
  if (!r.subtotal && itemsSum) r.subtotal = itemsSum;
  if (!r.total) r.total = r.subtotal + r.serviceCharge - r.discount;
  if (r.cash && !r.change && r.cash > r.total) r.change = r.cash - r.total;
  if (!r.vat && r.vatable) r.vat = Math.round(r.vatable * 0.12);
  return r;
}

/** Items that add up differently from the subtotal: worth a "check the items" note. */
export const itemsMismatch = (r: ReceiptDetails) => r.items.length > 0 && r.subtotal > 0 && Math.abs(r.items.reduce((a, it) => a + it.amount, 0) - r.subtotal) > 100;

/** Receipt details from the renderer or the decrypted payload; undefined when unusable. */
export function validateReceipt(v: unknown): ReceiptDetails | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const n = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 100_000_000_000_000 ? (x as number) : 0);
  const t = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const items: ReceiptItem[] = (Array.isArray(r.items) ? r.items : [])
    .slice(0, MAX_RECEIPT_ITEMS)
    .map((it) => (it && typeof it === 'object' ? (it as Record<string, unknown>) : {}))
    .map((it) => ({ qty: Math.max(1, Math.min(999, Number.isInteger(it.qty) ? (it.qty as number) : 1)), name: t(it.name, 60), price: n(it.price), amount: n(it.amount) }))
    .filter((it) => it.name);
  const out: ReceiptDetails = {
    store: t(r.store, 60),
    branch: t(r.branch, 80),
    items,
    subtotal: n(r.subtotal),
    vatable: n(r.vatable),
    vat: n(r.vat),
    vatExempt: n(r.vatExempt),
    discount: n(r.discount),
    serviceCharge: n(r.serviceCharge),
    total: n(r.total),
    payment: t(r.payment, 30),
    cash: n(r.cash),
    change: n(r.change),
    number: t(r.number, 30)
  };
  return out.items.length || out.total || out.store ? out : undefined;
}
