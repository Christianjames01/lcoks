// Kloud: VaultLocks' voice (and typed) assistant. Pure functions: understand one
// sentence, then answer it from the unlocked vault. The renderer runs the action
// (save, open, lock) and speaks the reply.
//
// Kloud never reads a secret out loud: passwords, PINs and card numbers are not
// part of any answer, only opened on screen.

import { newEventInput, occurrencesOn, formatTime, type CalendarEvent, type CalendarEventInput } from './calendar';
import {
  addMonths,
  allMoneyCategories,
  balances,
  dayKey,
  formatMoney,
  moneyCategory,
  monthOf,
  parseDay,
  parseQuick,
  type MoneyAccount,
  type MoneyCategory,
  type QuickParse,
  type Transaction
} from './money';
import { emptyTask, isTaskOverdue, type Task, type TaskInput } from './tasks';

export const KLOUD_NAME = 'Kloud';

// ------------------------------------------------------------------ when --

export interface When {
  /** YYYY-MM-DD, '' when the sentence names no day. */
  day: string;
  /** HH:MM, '' when it names no time. */
  time: string;
  /** The sentence without the date / time words. */
  rest: string;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const hm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/**
 * Dates and times in a sentence: "tomorrow at 9", "on friday 3:30 pm", "in 10
 * minutes", "tonight", "oct 30", "bukas" (tomorrow), "mamaya" (later today).
 * A time without am/pm: 1–6 means afternoon, 7–11 morning.
 */
export function parseWhen(text: string, now: Date = new Date()): When {
  // Keeps the user's capitals in the rest (names); every pattern ignores case.
  let s = ` ${text.replace(/[,.!?]/g, ' ')} `;
  let day = '';
  let time = '';
  const take = (re: RegExp) => {
    const m = re.exec(s);
    if (m) s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return m;
  };

  // "in 10 minutes", "in 2 hours", "in 3 days"
  const rel = take(/\s(?:in|after)\s+(\d{1,3}|an?|one|two|three|five|ten|fifteen|thirty)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)\s/i);
  if (rel) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, thirty: 30 };
    const n = words[rel[1]!] ?? Number(rel[1]);
    const unit = rel[2]!;
    const at = new Date(now);
    if (/^m/.test(unit)) at.setMinutes(at.getMinutes() + n);
    else if (/^h/.test(unit)) at.setHours(at.getHours() + n);
    else if (/^d/.test(unit)) at.setDate(at.getDate() + n);
    else at.setDate(at.getDate() + 7 * n);
    day = dayKey(at);
    if (/^[mh]/.test(unit)) time = hm(at.getHours(), at.getMinutes());
  }

  if (!day) {
    if (take(/\s(?:the\s+)?day after tomorrow\s/i)) day = dayKey(addDays(now, 2));
    else if (take(/\s(?:tomorrow|tmrw|tom|bukas)\s/i)) day = dayKey(addDays(now, 1));
    else if (take(/\s(?:today|ngayon|mamaya)\s/i)) day = dayKey(now);
    else if (take(/\stonight\s/i)) {
      day = dayKey(now);
      time = '20:00';
    } else {
      const wd = take(/\s(?:on\s+|this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thurs|fri|sat)\s/i);
      if (wd) {
        const target = WEEKDAYS.findIndex((w) => w.startsWith(wd[1]!.slice(0, 3).toLowerCase()));
        let diff = (target - now.getDay() + 7) % 7;
        if (diff === 0 || /next/i.test(wd[0])) diff = diff === 0 ? 7 : diff;
        day = dayKey(addDays(now, diff));
      } else {
        const md =
          take(/\s(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s/i) ??
          take(/\s(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s/i);
        if (md) {
          const monthWord = /\d/.test(md[1]!) ? md[2]! : md[1]!;
          const dayNum = Number(/\d/.test(md[1]!) ? md[1] : md[2]);
          const month = MONTHS.findIndex((m) => m.startsWith(monthWord.slice(0, 3)));
          let d = new Date(now.getFullYear(), month, dayNum);
          if (dayKey(d) < dayKey(now)) d = new Date(now.getFullYear() + 1, month, dayNum);
          if (d.getMonth() === month) day = dayKey(d);
        }
      }
    }
  }

  if (!time) {
    if (take(/\s(?:at\s+)?noon\s/i)) time = '12:00';
    else if (take(/\s(?:at\s+)?midnight\s/i)) time = '00:00';
    else {
      const t = take(/\s(?:at\s+|by\s+|around\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|in the morning|in the afternoon|in the evening|at night)?\s/i);
      // A bare number is only a time after "at", or with am / pm.
      if (t && (t[3] || /^\s(at|by|around)\s/.test(t[0]) || t[2])) {
        let h = Number(t[1]);
        const m = Number(t[2] ?? 0);
        const ap = (t[3] ?? '').toLowerCase();
        if (/p|afternoon|evening|night/.test(ap) && h < 12) h += 12;
        else if (/a|morning/.test(ap) && h === 12) h = 0;
        else if (!ap && h >= 1 && h <= 6) h += 12;
        if (h <= 23 && m <= 59) time = hm(h, m);
      } else if (t) {
        // Not a time: put it back.
        s = s.slice(0, t.index) + t[0] + s.slice(t.index);
      }
      if (!time) {
        if (take(/\s(?:in the\s+)?morning\s/i)) time = '09:00';
        else if (take(/\s(?:in the\s+)?afternoon\s/i)) time = '15:00';
        else if (take(/\s(?:in the\s+)?evening\s/i)) time = '19:00';
      }
    }
  }
  // A time with no day: today, or tomorrow if that time has passed.
  if (time && !day) day = hm(now.getHours(), now.getMinutes()) < time ? dayKey(now) : dayKey(addDays(now, 1));
  return { day, time, rest: s.replace(/\s+/g, ' ').trim() };
}

// -------------------------------------------------------------- intents --

export type KloudIntent =
  | { type: 'help' }
  | { type: 'lock' }
  | { type: 'money'; entry: QuickParse }
  | { type: 'task'; title: string; when: When }
  | { type: 'event'; title: string; when: When }
  | { type: 'spending'; category: string | null; period: Period }
  | { type: 'balance'; account: string | null }
  | { type: 'agenda'; day: string; label: string }
  | { type: 'tasksDue' }
  | { type: 'open'; query: string }
  | { type: 'view'; view: 'money' | 'calendar' | 'tasks' | 'vault' }
  | { type: 'unknown'; text: string };

export type Period = 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'year';

const clean = (t: string) =>
  t
    .replace(/[“”"]/g, '')
    .replace(/^\s*(?:hey\s+|ok(?:ay)?\s+|hi\s+)?(?:kloud|cloud|claude|clod)[\s,]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const title = (t: string) => {
  const x = t
    .replace(/^(?:to|that|about|for)\s+/i, '')
    .replace(/\s+(?:on|at|for|by)$/i, '')
    .trim();
  return x ? x.charAt(0).toUpperCase() + x.slice(1) : '';
};

function periodOf(t: string): Period {
  if (/\btoday\b|\bngayon\b/.test(t)) return 'today';
  if (/\byesterday\b|\bkahapon\b/.test(t)) return 'yesterday';
  if (/\blast week\b/.test(t)) return 'lastWeek';
  if (/\bthis week\b|\bweek\b/.test(t)) return 'week';
  if (/\blast month\b/.test(t)) return 'lastMonth';
  if (/\bthis year\b|\byear\b/.test(t)) return 'year';
  return 'month';
}

/** Which of the user's categories a question names ("on coffee", "for games"). */
function categoryIn(t: string, cats: readonly MoneyCategory[]): string | null {
  const s = ` ${t.toLowerCase()} `;
  for (const c of cats) {
    if (c.kind !== 'expense') continue;
    const names = [c.name.toLowerCase(), ...c.name.toLowerCase().split(/\s*&\s*|\s+and\s+/), ...c.words];
    if (names.some((n) => n.length > 1 && new RegExp(`[^a-z]${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z]`).test(s))) return c.id;
  }
  return null;
}

export function understand(input: string, ctx: { accounts: readonly MoneyAccount[]; categories?: readonly MoneyCategory[]; now?: Date }): KloudIntent {
  const text = clean(input);
  const t = text.toLowerCase();
  const now = ctx.now ?? new Date();
  const cats = ctx.categories ?? allMoneyCategories();
  if (!t) return { type: 'unknown', text };
  if (/^(help|what can you do|what do you do|commands?)\b/.test(t)) return { type: 'help' };
  if (/^(lock|lock (it|the vault|vaultlocks|my vault)|lock up)$/.test(t)) return { type: 'lock' };

  // Reminders and tasks
  const task = /^(?:please\s+)?(?:remind me(?: to)?|set a reminder(?: to)?|add (?:a )?(?:task|to ?do|reminder)(?: to)?|new task|create (?:a )?task|task|to ?do|don'?t forget(?: to)?|paalala)\s+(.+)$/i.exec(text);
  if (task) {
    const when = parseWhen(task[1]!, now);
    return { type: 'task', title: title(when.rest), when };
  }
  // Events
  const ev = /^(?:add|schedule|create|put|book)\s+(?:an?\s+)?(event|meeting|appointment|calendar event)?\s*(?:called|named|for)?\s*(.+)$/i.exec(text);
  if (ev && /\b(event|meeting|appointment|schedule|calendar)\b/.test(t)) {
    const when = parseWhen(ev[2]!.replace(/\b(?:to|on|in) (?:my )?calendar\b/i, ''), now);
    // "a meeting with Ana" → "Meeting with Ana"
    const noun = ev[1] && !/event/i.test(ev[1]) ? `${ev[1]} ` : '';
    return { type: 'event', title: title(`${noun}${when.rest}`), when };
  }

  // Questions
  // "I spent 85 on grab" is a record, not a question.
  const telling = /^(?:i\s+)?(?:spent|paid|bought)\b/.test(t) && /\d/.test(t);
  const asking = !telling && (/^(how|what|when|which|do i|did i|am i|show|tell|list|ano|magkano)\b|\?$/.test(t) || /\b(spent|spend|spending|balance|left|schedule|agenda)\b/.test(t));
  if (asking) {
    if (/\b(balance|how much (?:is|do i have)|money (?:in|on)|left (?:in|on))\b/.test(t)) {
      const a = ctx.accounts.find((x) => new RegExp(`\\b${x.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t));
      return { type: 'balance', account: a?.id ?? null };
    }
    if (/\b(spen[dt]|spending|expenses?|gastos|magkano)\b/.test(t)) return { type: 'spending', category: categoryIn(t, cats), period: periodOf(t) };
    if (/\b(calendar|events?|schedule|agenda|meetings?|appointments?|what'?s on|plans?)\b/.test(t)) {
      const when = /\btomorrow\b|\bbukas\b/.test(t) ? addDays(now, 1) : now;
      return { type: 'agenda', day: dayKey(when), label: /\btomorrow\b|\bbukas\b/.test(t) ? 'tomorrow' : 'today' };
    }
    if (/\b(tasks?|to ?dos?|due|overdue)\b/.test(t)) return { type: 'tasksDue' };
  }

  // Opening things
  const view = /^(?:open|show|go to|switch to)\s+(?:my\s+|the\s+)?(expenses?|money|wallets?|calendar|tasks?|to ?dos?|vault|home)$/.exec(t);
  if (view) {
    const v = view[1]!;
    return { type: 'view', view: /exp|money|wallet/.test(v) ? 'money' : /cal/.test(v) ? 'calendar' : /task|do/.test(v) ? 'tasks' : 'vault' };
  }
  const open = /^(?:open|show|find|get|look up)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:password|account|login|card|details|item|info))?$/.exec(t);
  if (open && !/\d/.test(open[1]!)) return { type: 'open', query: open[1]! };

  // Money: "lunch 150 gcash", "I spent 85 on grab", "cash in 500 gcash"
  const money = text.replace(/^(?:add|log|record|i\s+(?:spent|paid)|spent|paid|bought)\s+/i, '').replace(/\b(?:pesos?|php)\b/gi, '').replace(/\b(?:from|using|with|via|sa)\s+(?=\S)/gi, '');
  const entry = parseQuick(money, now, ctx.accounts);
  if (entry) {
    // "on coffee" → the note is the item, not the preposition.
    entry.note = entry.note.replace(/^(?:on|for)\s+/i, '');
    if (entry.note) entry.note = entry.note.charAt(0).toUpperCase() + entry.note.slice(1);
    return { type: 'money', entry };
  }
  return { type: 'unknown', text };
}

// --------------------------------------------------------------- answers --

export type KloudAction =
  | { type: 'saveTransaction'; input: QuickParse }
  | { type: 'saveTask'; input: TaskInput }
  | { type: 'saveEvent'; input: CalendarEventInput }
  | { type: 'openEntry'; id: string }
  | { type: 'openView'; view: 'money' | 'calendar' | 'tasks' | 'vault' }
  | { type: 'lock' };

export interface KloudReply {
  /** What Kloud says (and shows). */
  say: string;
  action?: KloudAction;
}

export interface KloudVault {
  transactions: readonly Transaction[];
  accounts: readonly MoneyAccount[];
  events: CalendarEvent[];
  tasks: Task[];
  entries: readonly { id: string; title: string; categoryId: string }[];
  currency: string;
}

function periodRange(p: Period, now: Date): { from: string; to: string; label: string } {
  const today = dayKey(now);
  const weekStart = addDays(now, -((now.getDay() + 6) % 7)); // Monday
  switch (p) {
    case 'today':
      return { from: today, to: today, label: 'today' };
    case 'yesterday': {
      const y = dayKey(addDays(now, -1));
      return { from: y, to: y, label: 'yesterday' };
    }
    case 'week':
      return { from: dayKey(weekStart), to: today, label: 'this week' };
    case 'lastWeek':
      return { from: dayKey(addDays(weekStart, -7)), to: dayKey(addDays(weekStart, -1)), label: 'last week' };
    case 'lastMonth': {
      const m = addMonths(monthOf(today), -1);
      return { from: `${m}-01`, to: `${m}-31`, label: 'last month' };
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: 'this year' };
    default:
      return { from: `${monthOf(today)}-01`, to: today, label: 'this month' };
  }
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const dayWord = (day: string, now: Date) =>
  day === dayKey(now) ? 'today' : day === dayKey(addDays(now, 1)) ? 'tomorrow' : parseDay(day).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' });

/** The task Kloud makes for "remind me to …": due on the day said, reminder at that time (09:00 for a day only). */
export function taskInput(name: string, when: When): TaskInput {
  return { ...emptyTask(when.day), title: name, dueTime: when.day ? when.time : '', reminder: when.day ? { type: 'before', minutes: 0 } : null };
}

export function answer(intent: KloudIntent, v: KloudVault, now: Date = new Date()): KloudReply {
  const money = (x: number) => formatMoney(x, v.currency);
  switch (intent.type) {
    case 'help':
      return {
        say: 'You can say things like: “lunch 150 from GCash”, “remind me to pay rent tomorrow at 9”, “how much did I spend on coffee this month”, “what’s on my calendar today”, “GCash balance”, or “open Gmail”.'
      };
    case 'lock':
      return { say: 'Locking VaultLocks.', action: { type: 'lock' } };
    case 'money': {
      const e = intent.entry;
      const acc = e.accountId ? v.accounts.find((a) => a.id === e.accountId)?.name : undefined;
      const what = e.note || moneyCategory(e.category).name;
      return {
        say: e.kind === 'income' ? `Done. Added ${money(e.amount)}${acc ? ` to ${acc}` : ''}${e.note ? `: ${e.note}` : ''}.` : `Done. ${money(e.amount)} for ${what}${acc ? ` from ${acc}` : ''}.`,
        action: { type: 'saveTransaction', input: e }
      };
    }
    case 'task': {
      if (!intent.title) return { say: 'What should I remind you about?' };
      const { day, time } = intent.when;
      const input = taskInput(intent.title, intent.when);
      const when = day ? ` ${dayWord(day, now)}${time ? ` at ${formatTime(time)}` : ''}` : '';
      return { say: `Okay. I’ll remind you: ${intent.title}${when}.`, action: { type: 'saveTask', input } };
    }
    case 'event': {
      if (!intent.title) return { say: 'What should I call the event?' };
      const day = intent.when.day || dayKey(now);
      const hour = intent.when.time ? Number(intent.when.time.slice(0, 2)) : 9;
      const input: CalendarEventInput = { ...newEventInput(day, { hour }), title: intent.title };
      if (intent.when.time) {
        const [h, m] = intent.when.time.split(':').map(Number) as [number, number];
        input.startTime = intent.when.time;
        input.endTime = hm(Math.min(23, h + 1), m);
      }
      return { say: `Added “${intent.title}” to your calendar ${dayWord(day, now)} at ${formatTime(input.startTime)}.`, action: { type: 'saveEvent', input } };
    }
    case 'spending': {
      const r = periodRange(intent.period, now);
      const rows = v.transactions.filter((t) => t.kind === 'expense' && t.date >= r.from && t.date <= r.to && (!intent.category || t.category === intent.category));
      const total = rows.reduce((s, t) => s + t.amount, 0);
      const name = intent.category ? moneyCategory(intent.category).name : '';
      if (!rows.length) return { say: `You haven’t spent anything${name ? ` on ${name}` : ''} ${r.label}.` };
      return { say: `You spent ${money(total)}${name ? ` on ${name}` : ''} ${r.label}, in ${rows.length} record${rows.length === 1 ? '' : 's'}.` };
    }
    case 'balance': {
      const b = balances(v.accounts as MoneyAccount[], v.transactions as Transaction[]);
      if (intent.account) {
        const a = v.accounts.find((x) => x.id === intent.account)!;
        return { say: `${a.name} has ${money(b.get(a.id) ?? 0)}.` };
      }
      const parts = v.accounts.map((a) => `${a.name} ${money(b.get(a.id) ?? 0)}`);
      return { say: parts.length ? `Your balances: ${list(parts)}.` : 'You have no accounts yet.' };
    }
    case 'agenda': {
      const occ = occurrencesOn(v.events, intent.day);
      if (!occ.length) return { say: `Nothing on your calendar ${intent.label}.` };
      const items = occ.slice(0, 6).map((o) => (o.event.allDay ? o.event.title : `${o.event.title} at ${formatTime(o.event.startTime)}`));
      return { say: `${occ.length === 1 ? 'One thing' : `${occ.length} things`} ${intent.label}: ${list(items)}.` };
    }
    case 'tasksDue': {
      const today = dayKey(now);
      const overdue = v.tasks.filter((t) => isTaskOverdue(t, now));
      const due = v.tasks.filter((t) => !t.completed && t.due === today && !isTaskOverdue(t, now));
      if (!overdue.length && !due.length) return { say: 'No tasks due today. Nice.' };
      const parts: string[] = [];
      if (due.length) parts.push(`${due.length} due today: ${list(due.slice(0, 4).map((t) => t.title))}`);
      if (overdue.length) parts.push(`${overdue.length} overdue: ${list(overdue.slice(0, 3).map((t) => t.title))}`);
      return { say: `${parts.join('. ')}.`, action: { type: 'openView', view: 'tasks' } };
    }
    case 'view':
      return { say: `Opening ${intent.view === 'money' ? 'Expenses' : intent.view === 'calendar' ? 'Calendar' : intent.view === 'tasks' ? 'Tasks' : 'your vault'}.`, action: { type: 'openView', view: intent.view } };
    case 'open': {
      const q = intent.query.toLowerCase().trim();
      const score = (e: { title: string }) => {
        const tt = e.title.toLowerCase();
        return tt === q ? 3 : tt.startsWith(q) ? 2 : tt.includes(q) || q.split(' ').every((w) => tt.includes(w)) ? 1 : 0;
      };
      const best = [...v.entries].map((e) => ({ e, s: score(e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
      if (!best) return { say: `I couldn’t find “${intent.query}” in your vault.` };
      return { say: `Opening ${best.e.title}. I won’t say passwords out loud.`, action: { type: 'openEntry', id: best.e.id } };
    }
    default:
      return { say: 'Sorry, I didn’t get that. Try “lunch 150”, “remind me to call Mama at 7”, or “what’s on my calendar today”.' };
  }
}

/** What to send to text-to-speech: "₱2,720" reads as "2,720 pesos". */
export function speakable(text: string, currency = 'PHP'): string {
  const unit = currency === 'PHP' ? 'pesos' : currency === 'USD' ? 'dollars' : currency;
  return text
    .replace(/[₱$€£¥]\s?([\d,]+(?:\.\d+)?)/g, (_, n: string) => `${n} ${unit}`)
    .replace(/[“”"]/g, '')
    .replace(/·/g, ',');
}
