import {
  Banknote,
  BookOpen,
  Briefcase,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Ellipsis,
  Landmark,
  Smartphone,
  Gift,
  HeartPulse,
  House,
  PiggyBank,
  Plus,
  Settings2,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Trash,
  TrendingDown,
  TrendingUp,
  Users,
  UtensilsCrossed,
  Wallet,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CURRENCIES,
  MAX_AMOUNT,
  MONEY_CATEGORIES,
  addMonths,
  dayKey,
  defaultCategory,
  formatMoney,
  moneyCategory,
  monthOf,
  parseDay,
  parseQuick,
  totals,
  balances,
  type AccountKind,
  type MoneyAccount,
  type MoneyIcon,
  type Transaction,
  type TxKind
} from '../../shared/money';
import type { KnockInfo } from '../../shared/api';
import type { VaultSnapshot } from '../../shared/types';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';

const ICONS: Record<MoneyIcon, LucideIcon> = {
  food: UtensilsCrossed,
  cart: ShoppingCart,
  car: Car,
  bolt: Zap,
  home: House,
  bag: ShoppingBag,
  health: HeartPulse,
  film: Clapperboard,
  book: BookOpen,
  sparkles: Sparkles,
  users: Users,
  dots: Ellipsis,
  wallet: Wallet,
  briefcase: Briefcase,
  gift: Gift,
  trending: TrendingUp
};

export function MoneyIconFor({ category, size = 16 }: { category: string; size?: number }) {
  const C = ICONS[moneyCategory(category).icon];
  return <C size={size} strokeWidth={1.8} aria-hidden />;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const monthLabel = (month: string) => parseDay(`${month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const dayLabel = (day: string) => parseDay(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** "1,250.50" → 125050 minor units; null when not a positive amount. */
function toMinor(text: string): number | null {
  const t = text.replace(/[^\d.]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [i, f = ''] = t.split('.');
  const v = Number(i) * 100 + Number(f.padEnd(2, '0') || 0);
  return v > 0 && v <= MAX_AMOUNT ? v : null;
}
const fromMinor = (v: number) => (v % 100 === 0 ? String(v / 100) : (v / 100).toFixed(2));

interface Props {
  snap: VaultSnapshot;
  mobile: boolean;
  onChanged: () => Promise<void>;
  /** Bumped by the "+" button: open the editor for the selected day. */
  addRequest: { id: number; kind: TxKind } | null;
  onAddHandled: () => void;
}

type Editing = { tx?: Transaction; date: string; kind: TxKind; accountId?: string } | null;

export function MoneyView({ snap, mobile, onChanged, addRequest, onAddHandled }: Props) {
  const toast = useToast();
  const today = dayKey(new Date());
  const [month, setMonth] = useState(monthOf(today));
  const [selected, setSelected] = useState(today);
  const [quick, setQuick] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [setup, setSetup] = useState(false);
  const { currency, monthlyBudget } = snap.settings;
  const money = (v: number, o?: { compact?: boolean; sign?: boolean }) => formatMoney(v, currency, o);

  // "+" in the bottom bar / title bar.
  useEffect(() => {
    if (!addRequest) return;
    setEditing({ date: selected, kind: addRequest.kind });
    onAddHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRequest?.id]);

  const inMonth = useMemo(() => snap.transactions.filter((t) => monthOf(t.date) === month), [snap.transactions, month]);
  const sums = useMemo(() => totals(inMonth), [inMonth]);
  const byDay = useMemo(() => {
    const m = new Map<string, { expense: number; income: number }>();
    for (const t of inMonth) {
      const d = m.get(t.date) ?? { expense: 0, income: 0 };
      d[t.kind] += t.amount;
      m.set(t.date, d);
    }
    return m;
  }, [inMonth]);
  const dayList = useMemo(
    () => snap.transactions.filter((t) => t.date === selected).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [snap.transactions, selected]
  );
  const breakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of inMonth) if (t.kind === 'expense') m.set(t.category, (m.get(t.category) ?? 0) + t.amount);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [inMonth]);

  const parsed = useMemo(() => parseQuick(quick, new Date(), snap.accounts), [quick, snap.accounts]);
  const accountBalances = useMemo(() => balances(snap.accounts, snap.transactions), [snap.accounts, snap.transactions]);
  const [managing, setManaging] = useState(false);
  const [viewingAccount, setViewingAccount] = useState<string | null>(null);

  const goMonth = (delta: number) => {
    const next = addMonths(month, delta);
    setMonth(next);
    setSelected(next === monthOf(today) ? today : `${next}-01`);
  };

  const save = async (input: { id?: string; kind: TxKind; amount: number; category: string; note: string; date: string; accountId?: string }) => {
    const r = await api.vault.saveTransaction(input);
    if (!r.ok) throw new Error(r.message);
    api.app.haptic('success');
    await onChanged();
    return r.value;
  };

  const addQuick = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!parsed) return toast('Add an amount, e.g. "lunch 150".', 'error');
    setBusy(true);
    try {
      // Typed "yesterday"/"today" wins; otherwise the record goes on the day selected in the calendar.
      const date = /\b(yesterday|kahapon|today|ngayon)\b/i.test(quick) ? parsed.date : selected;
      const t = await save({ ...parsed, date });
      setQuick('');
      setSelected(t.date);
      setMonth(monthOf(t.date));
      toast(`${t.kind === 'income' ? 'Income' : 'Expense'} of ${money(t.amount)} added.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const maxDay = Math.max(1, ...[...byDay.values()].map((d) => d.expense));
  const budgetLeft = monthlyBudget - sums.expense;
  const budgetPct = monthlyBudget > 0 ? Math.min(100, (sums.expense / monthlyBudget) * 100) : 0;
  const isCurrent = month === monthOf(today);
  const daysLeft = isCurrent ? new Date(parseDay(today).getFullYear(), parseDay(today).getMonth() + 1, 0).getDate() - parseDay(today).getDate() + 1 : 0;

  return (
    <div className="page money">
      <div className="page-narrow">
        <header className="money-head">
          {!mobile && <h1 className="h1 grow">Expenses</h1>}
          <div className="month-switch" role="group" aria-label="Month">
            <button type="button" className="icon-btn" onClick={() => goMonth(-1)} aria-label="Previous month">
              <ChevronLeft size={18} />
            </button>
            <span className="month-label" aria-live="polite">
              {monthLabel(month)}
            </span>
            <button type="button" className="icon-btn" onClick={() => goMonth(1)} aria-label="Next month">
              <ChevronRight size={18} />
            </button>
          </div>
          {!isCurrent && (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setMonth(monthOf(today));
                setSelected(today);
              }}
            >
              Today
            </button>
          )}
          <button type="button" className="icon-btn" onClick={() => setSetup(true)} aria-label="Budget and currency" title="Budget and currency">
            <Settings2 size={18} />
          </button>
        </header>

        <section className="money-summary" aria-label={`Summary for ${monthLabel(month)}`}>
          <div className="ms-card spent">
            <span className="ms-label">
              <TrendingDown size={14} aria-hidden /> Spent
            </span>
            <span className="ms-value" title={money(sums.expense)}>{money(sums.expense, { compact: mobile })}</span>
          </div>
          <div className="ms-card income">
            <span className="ms-label">
              <TrendingUp size={14} aria-hidden /> Income
            </span>
            <span className="ms-value" title={money(sums.income)}>{money(sums.income, { compact: mobile })}</span>
          </div>
          <div className="ms-card">
            <span className="ms-label">
              <Wallet size={14} aria-hidden /> Balance
            </span>
            <span className="ms-value" title={money(sums.net, { sign: true })}>{money(sums.net, { sign: true, compact: mobile })}</span>
          </div>
          {monthlyBudget > 0 ? (
            <button type="button" className={`ms-budget ${budgetLeft < 0 ? 'over' : ''}`} onClick={() => setSetup(true)}>
              <span className="ms-budget-row">
                <span className="ms-label">
                  <PiggyBank size={14} aria-hidden /> Budget {money(monthlyBudget)}
                </span>
                <span className="ms-budget-left">
                  {budgetLeft >= 0 ? `${money(budgetLeft)} left` : `${money(-budgetLeft)} over`}
                  {isCurrent && budgetLeft > 0 && daysLeft > 0 ? ` · ${money(Math.floor(budgetLeft / daysLeft))}/day` : ''}
                </span>
              </span>
              <span className="ms-bar" role="img" aria-label={`${Math.round(budgetPct)}% of budget used`}>
                <span style={{ width: `${budgetPct}%` }} />
              </span>
            </button>
          ) : (
            <button type="button" className="ms-budget empty" onClick={() => setSetup(true)}>
              <PiggyBank size={15} aria-hidden /> Set a monthly budget
            </button>
          )}
        </section>

        <section className="acct-strip" aria-label="Accounts">
          {snap.accounts.map((a) => (
            <button key={a.id} type="button" className={`acct-card kind-${a.kind}`} onClick={() => setViewingAccount(a.id)} title={`Open ${a.name}`}>
              <span className="acct-icon">
                <AccountIcon kind={a.kind} />
              </span>
              <span className="acct-name">{a.name}</span>
              <span className="acct-bal">{money(accountBalances.get(a.id) ?? 0, { compact: mobile })}</span>
            </button>
          ))}
          <button type="button" className="acct-card add" onClick={() => setManaging(true)}>
            <span className="acct-icon">
              <Plus size={16} aria-hidden />
            </span>
            <span className="acct-name">{snap.accounts.length ? 'Manage' : 'Add account'}</span>
          </button>
        </section>

        <form className="quick-entry" onSubmit={addQuick}>
          <input
            className="input"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder={mobile ? 'e.g. "lunch 150" or "salary 30k"' : 'Type "lunch 150", "grab 85 yesterday" or "salary 30k"'}
            aria-label="Quick add expense or income"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={200}
          />
          <button type="submit" className="btn primary" disabled={busy || !parsed}>
            {busy ? <span className="spinner" aria-hidden /> : <Plus size={16} aria-hidden />}
            <span className="btn-text">Add</span>
          </button>
          {quick.trim() && (
            <div className="quick-preview" aria-live="polite">
              {parsed ? (
                <>
                  <span className="qp-icon">
                    <MoneyIconFor category={parsed.category} size={14} />
                  </span>
                  <span>
                    {parsed.kind === 'income' ? 'Money in' : 'Expense'} · {moneyCategory(parsed.category).name}
                    {parsed.accountId ? ` · ${snap.accounts.find((a) => a.id === parsed.accountId)?.name ?? ''}` : ''} · <strong>{money(parsed.amount)}</strong>
                    {' · '}
                    {/\b(yesterday|kahapon|today|ngayon)\b/i.test(quick) ? dayLabel(parsed.date) : dayLabel(selected)}
                  </span>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() =>
                      setEditing({
                        date: /\b(yesterday|kahapon|today|ngayon)\b/i.test(quick) ? parsed.date : selected,
                        kind: parsed.kind,
                        tx: { id: '', ...parsed, createdAt: '', updatedAt: '' }
                      })
                    }
                  >
                    Edit details
                  </button>
                </>
              ) : (
                <span className="dim">Add an amount, e.g. “lunch 150”.</span>
              )}
            </div>
          )}
        </form>

        <div className="money-grid">
          <section className="card cal" aria-label={`Calendar, ${monthLabel(month)}`}>
            <Calendar month={month} today={today} selected={selected} byDay={byDay} maxDay={maxDay} money={money} onSelect={setSelected} />
          </section>

          <section className="card day-panel" aria-label={dayLabel(selected)}>
            <div className="day-head">
              <div className="grow">
                <div className="day-title">{dayLabel(selected)}</div>
                {dayList.length > 0 && (
                  <div className="dim small">
                    {(() => {
                      const d = totals(dayList);
                      return `Spent ${money(d.expense)}${d.income ? ` · Income ${money(d.income)}` : ''}`;
                    })()}
                  </div>
                )}
              </div>
              <button type="button" className="btn sm" onClick={() => setEditing({ date: selected, kind: 'expense' })}>
                <Plus size={14} aria-hidden /> Add
              </button>
            </div>
            {dayList.length === 0 ? (
              <div className="day-empty">
                <CalendarDays size={20} aria-hidden />
                <span>Nothing recorded on this day.</span>
              </div>
            ) : (
              <ul className="tx-list">
                {dayList.map((t) => (
                  <li key={t.id}>
                    <TxRow tx={t} money={money} account={snap.accounts.find((a) => a.id === t.accountId)?.name} onOpen={() => setEditing({ tx: t, date: t.date, kind: t.kind })} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="section-title">
          <span className="label">Spending by category</span>
          <span className="dim small">{monthLabel(month)}</span>
        </div>
        {breakdown.length === 0 ? (
          <EmptyState card art="category" title="No expenses this month" text="Type an expense above, or tap a day in the calendar and press Add." />
        ) : (
          <ul className="card breakdown">
            {breakdown.map(([cat, amount]) => (
              <li key={cat} className="bd-row">
                <span className="bd-icon">
                  <MoneyIconFor category={cat} />
                </span>
                <span className="bd-main">
                  <span className="bd-top">
                    <span className="bd-name">{moneyCategory(cat).name}</span>
                    <span className="bd-amount">{money(amount)}</span>
                  </span>
                  <span className="bd-bar" aria-hidden>
                    <span style={{ width: `${(amount / Math.max(1, sums.expense)) * 100}%` }} />
                  </span>
                </span>
                <span className="bd-pct">{Math.round((amount / Math.max(1, sums.expense)) * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <TxEditor
          editing={editing}
          currency={currency}
          accounts={snap.accounts}
          balances={accountBalances}
          money={money}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const t = await save(input);
            setSelected(t.date);
            setMonth(monthOf(t.date));
            setEditing(null);
            toast(input.id ? 'Changes saved.' : t.kind === 'income' ? `Cash added: ${money(t.amount)}.` : `Expense added: ${money(t.amount)}.`);
          }}
          onDelete={async (id) => {
            await unwrap(api.vault.deleteTransaction(id));
            api.app.haptic('warning');
            await onChanged();
            setEditing(null);
            toast('Record deleted.');
          }}
        />
      )}
      {managing && (
        <AccountsDialog
          accounts={snap.accounts}
          balances={accountBalances}
          money={money}
          currency={currency}
          onClose={() => setManaging(false)}
          onChanged={onChanged}
          onOpen={(id) => {
            setManaging(false);
            setViewingAccount(id);
          }}
        />
      )}
      {viewingAccount && !editing && snap.accounts.some((a) => a.id === viewingAccount) && (
        <AccountPage
          account={snap.accounts.find((a) => a.id === viewingAccount)!}
          balance={accountBalances.get(viewingAccount) ?? 0}
          transactions={snap.transactions.filter((t) => t.accountId === viewingAccount)}
          currency={currency}
          money={money}
          onClose={() => setViewingAccount(null)}
          onAdd={(kind) => setEditing({ date: today, kind, accountId: viewingAccount })}
          onOpenTx={(t) => setEditing({ tx: t, date: t.date, kind: t.kind })}
          onChanged={onChanged}
        />
      )}
      {setup && <MoneySetup currency={currency} budget={monthlyBudget} balancesOn={snap.settings.quickAddBalances} onClose={() => setSetup(false)} onSaved={onChanged} />}
    </div>
  );
}

// --------------------------------------------------------------- calendar --

function Calendar({
  month,
  today,
  selected,
  byDay,
  maxDay,
  money,
  onSelect
}: {
  month: string;
  today: string;
  selected: string;
  byDay: Map<string, { expense: number; income: number }>;
  maxDay: number;
  money: (v: number, o?: { compact?: boolean }) => string;
  onSelect: (day: string) => void;
}) {
  const first = parseDay(`${month}-01`);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = first.getDay();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);

  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step || monthOf(selected) !== month) return;
    e.preventDefault();
    const d = parseDay(selected);
    d.setDate(d.getDate() + step);
    const next = dayKey(d);
    if (monthOf(next) !== month) return;
    onSelect(next);
    requestAnimationFrame(() => (document.querySelector(`.cal-day[data-day="${next}"]`) as HTMLElement | null)?.focus());
  };

  return (
    <div className="cal-grid" role="grid" onKeyDown={onKey}>
      {WEEKDAYS.map((w) => (
        <span key={w} className="cal-wd" role="columnheader" aria-label={w}>
          {w.charAt(0)}
          <span className="cal-wd-rest">{w.slice(1)}</span>
        </span>
      ))}
      {cells.map((day, i) => {
        if (!day) return <span key={`x${i}`} className="cal-pad" aria-hidden />;
        const d = byDay.get(day);
        const level = d?.expense ? Math.min(4, Math.ceil((d.expense / maxDay) * 4)) : 0;
        const label = `${dayLabel(day)}${d?.expense ? `, spent ${money(d.expense)}` : ''}${d?.income ? `, income ${money(d.income)}` : ''}`;
        return (
          <button
            key={day}
            type="button"
            role="gridcell"
            className="cal-day"
            data-day={day}
            data-level={level}
            aria-selected={day === selected}
            aria-current={day === today ? 'date' : undefined}
            aria-label={label}
            tabIndex={day === selected ? 0 : -1}
            onClick={() => onSelect(day)}
          >
            <span className="cal-num">{Number(day.slice(8))}</span>
            {d?.expense ? <span className="cal-amt">{money(d.expense, { compact: true })}</span> : null}
            {d?.income ? <span className="cal-inc" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- rows ---

function TxRow({ tx, money, account, onOpen }: { tx: Transaction; money: (v: number, o?: { sign?: boolean }) => string; account?: string; onOpen: () => void }) {
  const cat = moneyCategory(tx.category);
  return (
    <button type="button" className={`tx-row ${tx.kind}`} onClick={onOpen}>
      <span className="tx-icon">
        <MoneyIconFor category={tx.category} />
      </span>
      <span className="row-main">
        <span className="row-title" style={{ display: 'block' }}>
          {tx.note || cat.name}
        </span>
        <span className="row-sub" style={{ display: 'block' }}>
          {cat.name}
          {account ? ` · ${account}` : ''}
        </span>
      </span>
      <span className="tx-amount">{tx.kind === 'income' ? `+${money(tx.amount)}` : `−${money(tx.amount)}`}</span>
    </button>
  );
}

// ---------------------------------------------------------------- editor --

function TxEditor({
  editing,
  currency,
  accounts,
  balances: bal,
  money,
  onClose,
  onSave,
  onDelete
}: {
  editing: NonNullable<Editing>;
  currency: string;
  accounts: MoneyAccount[];
  balances: Map<string, number>;
  money: (v: number, o?: { sign?: boolean }) => string;
  onClose: () => void;
  onSave: (input: { id?: string; kind: TxKind; amount: number; category: string; note: string; date: string; accountId?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const existing = editing.tx?.id ? editing.tx : undefined;
  const [kind, setKind] = useState<TxKind>(editing.tx?.kind ?? editing.kind);
  const [amount, setAmount] = useState(editing.tx ? fromMinor(editing.tx.amount) : '');
  // Add cash starts on "Cash in / Top-up", the usual reason.
  const firstCategory = (k: TxKind) => (k === 'income' ? 'topup' : defaultCategory(k));
  const [category, setCategory] = useState(editing.tx?.category ?? firstCategory(editing.kind));
  const [note, setNote] = useState(editing.tx?.note ?? '');
  const [date, setDate] = useState(editing.tx?.date || editing.date);
  const [accountId, setAccountId] = useState<string | undefined>(editing.tx?.accountId ?? editing.accountId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const cats = MONEY_CATEGORIES.filter((c) => c.kind === kind);

  const switchKind = (k: TxKind) => {
    setKind(k);
    if (moneyCategory(category).kind !== k) setCategory(firstCategory(k));
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const minor = toMinor(amount);
    if (minor === null) return setError('Enter an amount greater than zero.');
    if (!date) return setError('Choose a date.');
    setBusy(true);
    setError(null);
    try {
      await onSave({ id: existing?.id, kind, amount: minor, category, note: note.trim(), date, accountId });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        title={existing ? (kind === 'income' ? 'Edit cash in' : 'Edit expense') : kind === 'income' ? 'Add cash' : 'Add expense'}
        onClose={onClose}
        busy={busy}
        footer={
          <>
            {existing && (
              <button type="button" className="btn danger left" onClick={() => setConfirm(true)} disabled={busy}>
                <Trash size={15} aria-hidden /> Delete
              </button>
            )}
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={`btn primary tx-save is-${kind}`} onClick={() => void submit()} disabled={busy}>
              {busy && <span className="spinner" aria-hidden />} {kind === 'income' ? 'Add cash' : 'Save expense'}
            </button>
          </>
        }
      >
        <form onSubmit={submit} noValidate>
          <div className={`segmented tx-kind is-${kind}`} role="group" aria-label="Type">
            <button type="button" aria-pressed={kind === 'expense'} onClick={() => switchKind('expense')}>
              − Expense
            </button>
            <button type="button" aria-pressed={kind === 'income'} onClick={() => switchKind('income')}>
              + Add cash
            </button>
          </div>
          <div className="field amount-field">
            <label htmlFor="tx-amount">Amount ({currency})</label>
            <input
              id="tx-amount"
              className="input amount-input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
              placeholder="0.00"
              autoComplete="off"
              aria-invalid={!!error}
              aria-describedby={error ? 'tx-err' : undefined}
              data-autofocus
            />
            {error && (
              <div id="tx-err" className="error-text" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="field">
            <span className="label">Category</span>
            <div className="cat-picker" role="radiogroup" aria-label="Category">
              {cats.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={category === c.id} className="cat-chip" onClick={() => setCategory(c.id)}>
                  <MoneyIconFor category={c.id} size={15} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          {accounts.length > 0 && (
            <div className="field">
              <span className="label">{kind === 'income' ? 'Add to' : 'Paid with'}</span>
              <div className="pick-cards" role="radiogroup" aria-label="Account">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={accountId === a.id}
                    className={`pick-card kind-${a.kind}`}
                    onClick={() => setAccountId(accountId === a.id ? undefined : a.id)}
                  >
                    <span className="pick-top">
                      <AccountIcon kind={a.kind} size={14} />
                      <span className="pick-name">{a.name}</span>
                    </span>
                    <span className="pick-bal">{money(bal.get(a.id) ?? 0)}</span>
                  </button>
                ))}
              </div>
              {(() => {
                const acc = accounts.find((a) => a.id === accountId);
                const minor = toMinor(amount);
                if (!acc) return <div className="help-text">Tap an account to take the money from it (tap again to clear).</div>;
                // Editing: take this record's old effect out first.
                const sign = (k: TxKind) => (k === 'income' ? 1 : -1);
                const before = (bal.get(acc.id) ?? 0) - (existing && existing.accountId === acc.id ? sign(existing.kind) * existing.amount : 0);
                const after = minor ? before + sign(kind) * minor : before;
                return (
                  <div className={`bal-after is-${kind}`}>
                    <span>{acc.name}</span>
                    <span className="bal-from">{money(before)}</span>
                    {minor ? (
                      <>
                        <span aria-hidden>→</span>
                        <strong>{money(after)}</strong>
                        <span className="dim">{kind === 'income' ? 'after cash in' : 'left'}</span>
                      </>
                    ) : null}
                  </div>
                );
              })()}
            </div>
          )}
          <div className="grid-2">
            <div className="field">
              <label htmlFor="tx-note">Note</label>
              <input id="tx-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Lunch with team" autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="tx-date">Date</label>
              <input id="tx-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <button type="submit" hidden />
        </form>
      </Dialog>
      {confirm && existing && (
        <ConfirmDialog
          title="Delete record?"
          danger
          confirmLabel="Delete"
          message={`${existing.note || moneyCategory(existing.category).name} will be permanently deleted.`}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false);
            setBusy(true);
            try {
              await onDelete(existing.id);
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------ budget setup --

function MoneySetup({ currency, budget, balancesOn, onClose, onSaved }: { currency: string; budget: number; balancesOn: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [cur, setCur] = useState(currency);
  const [amount, setAmount] = useState(budget ? fromMinor(budget) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const save = async () => {
    const minor = amount.trim() ? toMinor(amount) : 0;
    if (minor === null) return setError('Enter a budget amount, or leave it empty for no budget.');
    setBusy(true);
    try {
      await unwrap(api.vault.updateSettings({ currency: cur, monthlyBudget: minor }));
      await onSaved();
      toast('Budget saved.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Budget & currency"
      size="narrow"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="m-cur">Currency</label>
        <select id="m-cur" className="select" value={cur} onChange={(e) => setCur(e.target.value)}>
          {(CURRENCIES as readonly string[]).includes(cur) ? null : <option value={cur}>{cur}</option>}
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="m-budget">Monthly budget</label>
        <input
          id="m-budget"
          className="input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
          placeholder="No budget"
          autoComplete="off"
          aria-invalid={!!error}
        />
        {error ? <div className="error-text">{error}</div> : <div className="help-text">Shows how much you have left to spend each month.</div>}
      </div>
      <QuickAddSettings balancesOn={balancesOn} onSaved={onSaved} />
    </Dialog>
  );
}

/** Adding while locked: lock screen box (always) and, on Android, back tap + notification. */
function QuickAddSettings({ balancesOn, onSaved }: { balancesOn: boolean; onSaved: () => Promise<void> }) {
  const [notif, setNotif] = useState<'on' | 'off' | 'unsupported' | null>(null);
  const [knock, setKnock] = useState<KnockInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setNotif(await api.inbox.notification());
    setKnock(await api.inbox.knock());
  }, []);
  useEffect(() => {
    void load();
    // Coming back from the phone's permission screens.
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const needNotifications = async () => {
    let perm = await api.notifications.status();
    if (perm === 'prompt') perm = await api.notifications.request();
    if (perm === 'denied') throw new Error('Allow notifications for VaultLocks in your phone settings first.');
  };

  const toggleNotif = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) await needNotifications();
      await unwrap(api.inbox.setNotification(on));
      setNotif(on ? 'on' : 'off');
      toast(on ? 'Quick add notification is on.' : 'Quick add notification is off.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleKnock = async (on: boolean, sensitivity = knock?.sensitivity ?? 1) => {
    setBusy(true);
    try {
      if (on) await needNotifications();
      await unwrap(api.inbox.setKnock(on, sensitivity));
      await load();
      if (on !== knock?.on) toast(on ? 'Double tap the back of your phone to add an expense.' : 'Double tap is off.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const tryIt = async () => {
    const r = await api.inbox.openPopup();
    if (!r.ok) toast(r.message, 'error');
  };

  const android = knock?.supported === true;

  return (
    <div className="quick-add-settings">
      <div className="label" style={{ marginBottom: 8 }}>
        Add while locked
      </div>

      {android && (
        <>
          <div className="qas-block">
            <div className="title">Double tap the back of the phone</div>
            <ol className="qas-steps">
              <li>
                {knock.xiaomi ? (
                  <>
                    Best: your phone&apos;s own <strong>Back tap</strong>. Go to Settings → Additional settings → Gesture shortcuts → <strong>Back tap</strong> → Double
                    tap, and choose the app <strong>“Add expense”</strong> if it is offered.
                  </>
                ) : (
                  <>
                    If your phone has a <strong>Back tap</strong> gesture that can open apps, choose the app <strong>“Add expense”</strong>.
                  </>
                )}
              </li>
              <li>Otherwise let VaultLocks detect it (works while the screen is on, also on the lock screen):</li>
            </ol>
            <label className="setting qas-row" htmlFor="qa-knock">
              <span className="grow">
                <span className="title" style={{ display: 'block' }}>
                  VaultLocks double-tap detection
                </span>
                <span className="desc" style={{ display: 'block' }}>
                  Uses the motion sensor; shows a small permanent notification and uses a little battery.
                </span>
              </span>
              <input id="qa-knock" type="checkbox" className="switch" checked={knock.on} disabled={busy} onChange={(e) => void toggleKnock(e.target.checked)} />
            </label>
            {knock.on && (
              <div className="qas-sub">
                <Segmented label="Tap strength" value={knock.sensitivity} options={[[0, 'Firm'], [1, 'Normal'], [2, 'Light']]} onChange={(v) => void toggleKnock(true, v)} />
                {(!knock.canPopUp || knock.xiaomi) && (
                  <div className="notice" style={{ marginTop: 10 }}>
                    <span>
                      For the pop-up to appear over the lock screen, allow{' '}
                      {knock.xiaomi ? (
                        <>
                          <strong>Show on Lock screen</strong>, <strong>Display pop-up windows while running in the background</strong> and{' '}
                          <strong>Autostart</strong>
                        </>
                      ) : (
                        <strong>Display over other apps</strong>
                      )}
                      .
                      <span className="qas-perm-btns">
                        {knock.xiaomi && (
                          <button type="button" className="btn sm" onClick={() => void api.inbox.openPermissions('app')}>
                            Phone permissions
                          </button>
                        )}
                        {!knock.canPopUp && (
                          <button type="button" className="btn sm" onClick={() => void api.inbox.openPermissions('overlay')}>
                            Display over other apps
                          </button>
                        )}
                        {!knock.fullScreen && (
                          <button type="button" className="btn sm" onClick={() => void api.inbox.openPermissions('fullscreen')}>
                            Full-screen notifications
                          </button>
                        )}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            )}
            <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={() => void tryIt()}>
              Try the pop-up
            </button>
          </div>

          <label className="setting qas-row" htmlFor="qa-bal">
            <span className="grow">
              <span className="title" style={{ display: 'block' }}>
                Show balances in the pop-up
              </span>
              <span className="desc" style={{ display: 'block' }}>
                See how much is left in GCash, BDO… while locked. Anyone holding your phone could see the balances (never your records or passwords).
              </span>
            </span>
            <input
              id="qa-bal"
              type="checkbox"
              className="switch"
              checked={balancesOn}
              disabled={busy}
              onChange={async (e) => {
                const on = e.target.checked;
                setBusy(true);
                try {
                  await unwrap(api.vault.updateSettings({ quickAddBalances: on }));
                  await onSaved();
                } catch (err) {
                  toast(errorMessage(err), 'error');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>

          {notif !== null && notif !== 'unsupported' && (
            <label className="setting qas-row" htmlFor="qa-notif">
              <span className="grow">
                <span className="title" style={{ display: 'block' }}>
                  Quick add notification
                </span>
                <span className="desc" style={{ display: 'block' }}>
                  Tap it to open the pop-up, or type “lunch 150 gcash” right in it.
                </span>
              </span>
              <input id="qa-notif" type="checkbox" className="switch" checked={notif === 'on'} disabled={busy} onChange={(e) => void toggleNotif(e.target.checked)} />
            </label>
          )}
        </>
      )}
      <p className="help-text" style={{ margin: '8px 0 0' }}>
        The lock screen also has an “Add expense” button. Entries added while locked are encrypted and appear here after you unlock. Only your account names (not balances or
        records) are readable while locked, so the pop-up can list them.
      </p>
    </div>
  );
}

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

// --------------------------------------------------------------- accounts --

const ACCOUNT_ICONS: Record<AccountKind, LucideIcon> = { cash: Banknote, ewallet: Smartphone, bank: Landmark, other: Wallet };
const ACCOUNT_KIND_NAMES: [AccountKind, string][] = [
  ['cash', 'Cash'],
  ['ewallet', 'E-wallet'],
  ['bank', 'Bank'],
  ['other', 'Other']
];

export function AccountIcon({ kind, size = 16 }: { kind: AccountKind; size?: number }) {
  const C = ACCOUNT_ICONS[kind] ?? Wallet;
  return <C size={size} strokeWidth={1.8} aria-hidden />;
}

/** Add, rename, set the starting balance of, or remove accounts. */
function AccountsDialog({
  accounts,
  balances: bal,
  money,
  currency,
  onClose,
  onChanged,
  onOpen
}: {
  accounts: MoneyAccount[];
  balances: Map<string, number>;
  money: (v: number) => string;
  currency: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [editing, setEditing] = useState<MoneyAccount | 'new' | null>(null);
  const [removing, setRemoving] = useState<MoneyAccount | null>(null);
  const toast = useToast();

  return (
    <>
      <Dialog
        title="Accounts"
        subtitle="Cash, e-wallets and banks"
        size="narrow"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>
              Done
            </button>
            <button type="button" className="btn primary" onClick={() => setEditing('new')}>
              <Plus size={15} aria-hidden /> Add account
            </button>
          </>
        }
      >
        {accounts.length === 0 ? (
          <div className="day-empty">No accounts. Add Cash, GCash or a bank to track balances.</div>
        ) : (
          <ul className="tx-list">
            {accounts.map((a) => (
              <li key={a.id}>
                <button type="button" className="tx-row" onClick={() => onOpen(a.id)}>
                  <span className="tx-icon">
                    <AccountIcon kind={a.kind} />
                  </span>
                  <span className="row-main">
                    <span className="row-title" style={{ display: 'block' }}>
                      {a.name}
                    </span>
                    <span className="row-sub" style={{ display: 'block' }}>
                      {ACCOUNT_KIND_NAMES.find(([k]) => k === a.kind)?.[1]}
                    </span>
                  </span>
                  <span className="tx-amount">{money(bal.get(a.id) ?? 0)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      {editing && (
        <AccountEditor
          account={editing === 'new' ? null : editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onRemove={editing !== 'new' ? () => setRemoving(editing) : undefined}
          onSaved={async () => {
            await onChanged();
            setEditing(null);
            toast('Account saved.');
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          danger
          confirmLabel="Remove account"
          message="Its records stay in your expenses, just without an account."
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await unwrap(api.vault.deleteAccount(removing.id));
              await onChanged();
              setRemoving(null);
              setEditing(null);
              toast('Account removed.');
            } catch (err) {
              toast(errorMessage(err), 'error');
            }
          }}
        />
      )}
    </>
  );
}

function AccountEditor({
  account,
  currency,
  onClose,
  onSaved,
  onRemove
}: {
  account: MoneyAccount | null;
  currency: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onRemove?: () => void;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'ewallet');
  const [opening, setOpening] = useState(account && account.opening ? fromMinor(Math.abs(account.opening)) : '');
  const [negative, setNegative] = useState((account?.opening ?? 0) < 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return setError('Enter a name, e.g. GCash.');
    const minor = opening.trim() ? toMinor(opening) : 0;
    if (minor === null) return setError('Enter a valid starting balance.');
    setBusy(true);
    try {
      await unwrap(api.vault.saveAccount({ id: account?.id, name: name.trim(), kind, opening: negative ? -minor : minor }));
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={account ? 'Edit account' : 'Add account'}
      size="narrow"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {onRemove && (
            <button type="button" className="btn danger left" onClick={onRemove} disabled={busy}>
              <Trash size={15} aria-hidden /> Remove
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="acc-name">Name</label>
          <input id="acc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. GCash" autoComplete="off" data-autofocus />
        </div>
        <div className="field">
          <span className="label">Type</span>
          <div className="segmented" role="group" aria-label="Account type">
            {ACCOUNT_KIND_NAMES.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="acc-open">Starting balance ({currency})</label>
          <input id="acc-open" className="input" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" autoComplete="off" />
          <label className="checkbox" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} /> It's a debt (e.g. credit card balance)
          </label>
          {error ? <div className="error-text">{error}</div> : <div className="help-text">How much was in it before you started tracking.</div>}
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------ account page --

/** One account (e.g. BDO, GCash): its card and balance, add buttons, and every record — tap one to edit or delete it. */
function AccountPage({
  account,
  balance,
  transactions,
  currency,
  money,
  onClose,
  onAdd,
  onOpenTx,
  onChanged
}: {
  account: MoneyAccount;
  balance: number;
  transactions: Transaction[];
  currency: string;
  money: (v: number, o?: { sign?: boolean }) => string;
  onClose: () => void;
  onAdd: (kind: TxKind) => void;
  onOpenTx: (t: Transaction) => void;
  onChanged: () => Promise<void>;
}) {
  const [editingAccount, setEditingAccount] = useState(false);
  const [removing, setRemoving] = useState(false);
  const toast = useToast();
  const list = useMemo(() => [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [transactions]);
  const sums = useMemo(() => totals(transactions), [transactions]);

  return (
    <>
      <Dialog title={account.name} subtitle={ACCOUNT_KIND_NAMES.find(([k]) => k === account.kind)?.[1]} onClose={onClose}>
        <div className={`money-card kind-${account.kind}`}>
          <div className="mc-top">
            <span className="mc-icon">
              <AccountIcon kind={account.kind} size={18} />
            </span>
            <span className="mc-name">{account.name}</span>
            <span className="mc-kind">{ACCOUNT_KIND_NAMES.find(([k]) => k === account.kind)?.[1]}</span>
          </div>
          <div className="mc-label">Available balance</div>
          <div className={`mc-balance ${balance < 0 ? 'neg' : ''}`}>{money(balance)}</div>
          <div className="mc-foot">
            <span className="mc-in">+{money(sums.income)} in</span>
            <span className="mc-out">−{money(sums.expense)} out</span>
          </div>
        </div>

        <div className="acct-actions">
          <button type="button" className="btn tx-save is-expense" onClick={() => onAdd('expense')}>
            − Expense
          </button>
          <button type="button" className="btn tx-save is-income" onClick={() => onAdd('income')}>
            + Add cash
          </button>
          <button type="button" className="btn" onClick={() => setEditingAccount(true)} aria-label={`Edit ${account.name}`}>
            <Settings2 size={15} aria-hidden /> Edit
          </button>
        </div>

        <div className="section-title" style={{ marginTop: 18 }}>
          <span className="label">History</span>
          <span className="dim small">{list.length} record{list.length === 1 ? '' : 's'} · tap to edit or delete</span>
        </div>
        {list.length === 0 ? (
          <div className="day-empty">No records for {account.name} yet.</div>
        ) : (
          <ul className="tx-list">
            {list.map((t, i) => (
              <li key={t.id}>
                {(i === 0 || list[i - 1]!.date !== t.date) && <div className="tx-day">{dayLabel(t.date)}</div>}
                <TxRow tx={t} money={money} onOpen={() => onOpenTx(t)} />
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      {editingAccount && (
        <AccountEditor
          account={account}
          currency={currency}
          onClose={() => setEditingAccount(false)}
          onRemove={() => setRemoving(true)}
          onSaved={async () => {
            await onChanged();
            setEditingAccount(false);
            toast('Account saved.');
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${account.name}?`}
          danger
          confirmLabel="Remove account"
          message="Its records stay in your expenses, just without an account."
          onCancel={() => setRemoving(false)}
          onConfirm={async () => {
            try {
              await unwrap(api.vault.deleteAccount(account.id));
              await onChanged();
              toast('Account removed.');
              onClose();
            } catch (err) {
              toast(errorMessage(err), 'error');
            }
          }}
        />
      )}
    </>
  );
}
