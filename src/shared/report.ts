// Monthly report: the numbers (pure) and a one-page PDF made on the device.
// The PDF holds amounts and categories only — never secrets or account numbers.

import { addMonths, formatMoney, moneyCategory, monthOf, parseDay, type Transaction } from './money';

export interface MonthReport {
  month: string;
  label: string;
  spent: number;
  income: number;
  saved: number;
  prevSpent: number;
  byCategory: { category: string; name: string; amount: number }[];
  sixMonths: { month: string; label: string; spent: number }[];
  biggest: { note: string; date: string; amount: number }[];
  days: number;
}

const label = (m: string, opts: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }) => parseDay(`${m}-01`).toLocaleDateString('en', opts);

export function monthReport(list: readonly Transaction[], month: string): MonthReport {
  const inMonth = (m: string) => list.filter((t) => monthOf(t.date) === m);
  const sum = (xs: readonly Transaction[], kind: 'expense' | 'income') => xs.filter((t) => t.kind === kind).reduce((a, t) => a + t.amount, 0);
  const cur = inMonth(month);
  const spent = sum(cur, 'expense');
  const income = sum(cur, 'income');
  const by = new Map<string, number>();
  for (const t of cur) if (t.kind === 'expense') by.set(t.category, (by.get(t.category) ?? 0) + t.amount);
  return {
    month,
    label: label(month),
    spent,
    income,
    saved: income - spent,
    prevSpent: sum(inMonth(addMonths(month, -1)), 'expense'),
    byCategory: [...by].map(([category, amount]) => ({ category, name: moneyCategory(category).name, amount })).sort((a, b) => b.amount - a.amount),
    sixMonths: Array.from({ length: 6 }, (_, i) => {
      const m = addMonths(month, i - 5);
      return { month: m, label: label(m, { month: 'short' }), spent: sum(inMonth(m), 'expense') };
    }),
    biggest: cur
      .filter((t) => t.kind === 'expense')
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((t) => ({ note: t.note || moneyCategory(t.category).name, date: t.date, amount: t.amount })),
    days: cur.length ? new Set(cur.map((t) => t.date)).size : 0
  };
}

// ------------------------------------------------------------------- PDF --

/** Standard PDF fonts only know Latin-1: "₱" becomes "PHP ", other symbols "?". */
const latin1 = (s: string) =>
  s
    .replace(/₱\s?/g, 'PHP ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const esc = (s: string) => latin1(s).replace(/[\\()]/g, (c) => `\\${c}`);

/** Width of Helvetica text (approx., 1000 units / em) to right-align numbers. */
function width(s: string, size: number, bold = false): number {
  let w = 0;
  for (const c of latin1(s)) w += /[0-9]/.test(c) ? 556 : /[ .,:]/.test(c) ? 278 : /[A-Z]/.test(c) ? 667 : /[il]/.test(c) ? 222 : c === '-' ? 333 : 556;
  return (w * size * (bold ? 1.04 : 1)) / 1000;
}

/** A one-page A4 PDF of the report, as bytes. */
export function reportPdf(r: MonthReport, currency: string): Uint8Array {
  const money = (v: number) => formatMoney(v, currency);
  const W = 595;
  const H = 842;
  const L = 48;
  const R = W - 48;
  const ops: string[] = [];
  const text = (s: string, x: number, y: number, size: number, opt: { bold?: boolean; gray?: number; right?: boolean } = {}) => {
    const xx = opt.right ? x - width(s, size, opt.bold) : x;
    ops.push(`BT /${opt.bold ? 'F2' : 'F1'} ${size} Tf ${opt.gray ?? 0} g ${xx.toFixed(1)} ${(H - y).toFixed(1)} Td (${esc(s)}) Tj ET`);
  };
  const rect = (x: number, y: number, w: number, h: number, gray: number) => ops.push(`${gray} g ${x.toFixed(1)} ${(H - y - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
  const box = (x: number, y: number, w: number, h: number) => ops.push(`0.86 G 0.8 w ${x.toFixed(1)} ${(H - y - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re S`);

  text('VAULTLOCKS - MONTHLY REPORT', L, 60, 9, { bold: true, gray: 0.42 });
  text(r.label, L, 86, 24, { bold: true });
  rect(R - 30, 50, 30, 30, 0.07);

  // Three totals
  const bw = (R - L - 20) / 3;
  const diff = r.spent - r.prevSpent;
  const cards: [string, string, string][] = [
    ['Spent', money(r.spent), r.prevSpent ? `${diff <= 0 ? 'down' : 'up'} ${money(Math.abs(diff))} vs last month` : ''],
    ['Income', money(r.income), ''],
    ['Saved', money(r.saved), r.income > 0 ? `${Math.round((Math.max(0, r.saved) / r.income) * 100)}% of income` : '']
  ];
  cards.forEach(([k, v, sub], i) => {
    const x = L + i * (bw + 10);
    box(x, 108, bw, 66);
    text(k, x + 12, 128, 10, { gray: 0.42 });
    text(v, x + 12, 150, 16, { bold: true });
    if (sub) text(sub, x + 12, 166, 8.5, { gray: 0.42 });
  });

  // By category
  let y = 206;
  text('BY CATEGORY', L, y, 9, { bold: true, gray: 0.42 });
  y += 18;
  const top = r.byCategory.slice(0, 10);
  const max = Math.max(1, ...top.map((c) => c.amount));
  const barX = L + 140;
  const barW = R - barX - 90;
  for (const c of top) {
    text(c.name, L, y + 8, 10.5);
    rect(barX, y, barW, 8, 0.93);
    rect(barX, y, Math.max(2, (c.amount / max) * barW), 8, 0.07);
    text(money(c.amount), R, y + 8, 10.5, { bold: true, right: true });
    y += 20;
  }
  if (!top.length) {
    text('No expenses this month.', L, y + 8, 10.5, { gray: 0.42 });
    y += 20;
  }

  // Six months
  y += 16;
  text('LAST 6 MONTHS', L, y, 9, { bold: true, gray: 0.42 });
  y += 12;
  const ch = 110;
  const smax = Math.max(1, ...r.sixMonths.map((m) => m.spent));
  const slot = (R - L) / 6;
  r.sixMonths.forEach((m, i) => {
    const h = (m.spent / smax) * ch;
    const x = L + i * slot + slot * 0.18;
    rect(x, y + ch - h, slot * 0.64, Math.max(1, h), m.month === r.month ? 0.07 : 0.78);
    text(m.label, x + slot * 0.32 - width(m.label, 9) / 2, y + ch + 16, 9, { gray: 0.42 });
    if (m.spent) text(money(m.spent), x + slot * 0.32 - width(money(m.spent), 7.5) / 2, y + ch - h - 5, 7.5, { gray: 0.3 });
  });
  ops.push(`0.86 G 0.8 w ${L} ${H - y - ch} m ${R} ${H - y - ch} l S`);
  y += ch + 40;

  // Biggest
  text('BIGGEST EXPENSES', L, y, 9, { bold: true, gray: 0.42 });
  y += 18;
  for (const b of r.biggest) {
    text(`${b.note} - ${parseDay(b.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`, L, y + 8, 10.5);
    text(money(b.amount), R, y + 8, 10.5, { bold: true, right: true });
    y += 20;
  }

  ops.push(`0.9 G 0.8 w ${L} ${H - 780} m ${R} ${H - 780} l S`);
  text('Made on your device by VaultLocks. Amounts and categories only - no passwords or account numbers.', L, 796, 8.5, { gray: 0.42 });

  // Assemble: catalog, pages, page, 2 fonts, content.
  const content = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

