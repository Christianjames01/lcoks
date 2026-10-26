import { CalendarClock, Check, FileText, HandCoins, PiggyBank, Plus, Receipt, Target, Trash, Undo2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { MAX_AMOUNT, allMoneyCategories, dayKey, formatMoney, moneyCategory, monthOf, parseDay, type MoneyAccount } from '../../shared/money';
import {
  billLastAmount,
  billsInOrder,
  billsMonth,
  budgetRows,
  debtLeft,
  debtPaid,
  debtSettled,
  debtTotals,
  goalPlan,
  type Bill,
  type BillStatus,
  type Debt,
  type Goal
} from '../../shared/plans';
import { monthReport, reportPdf } from '../../shared/report';
import type { VaultSnapshot } from '../../shared/types';
import { api, errorMessage, unwrap } from '../lib/api';
import { MoneyIconFor } from '../views/Money';
import { ConfirmDialog, Dialog } from './Dialog';
import { useToast } from './Toast';

import { tr } from '../../shared/i18n';
// ------------------------------------------------------------- helpers --

function toMinor(text: string, allowZero = false): number | null {
  const t = text.replace(/[^\d.]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [i, f = ''] = t.split('.');
  const v = Number(i) * 100 + Number(f.padEnd(2, '0') || 0);
  return (allowZero ? v >= 0 : v > 0) && v <= MAX_AMOUNT ? v : null;
}
const fromMinor = (v: number) => (v ? (v % 100 === 0 ? String(v / 100) : (v / 100).toFixed(2)) : '');
const shortDay = (d: string) => parseDay(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const useMoney = (snap: VaultSnapshot) => (v: number) => formatMoney(v, snap.settings.currency);

function AccountPick({ accounts, value, onChange, none = 'No account' }: { accounts: readonly MoneyAccount[]; value: string; onChange: (id: string) => void; none?: string }) {
  return (
    <div className="mp-chips" role="radiogroup" aria-label={tr("Account")}>
      {accounts.map((a) => (
        <button key={a.id} type="button" role="radio" aria-checked={value === a.id} className="vl-pill mp-pick" onClick={() => onChange(a.id)}>
          {a.name}
        </button>
      ))}
      <button type="button" role="radio" aria-checked={value === ''} className="vl-pill mp-pick" onClick={() => onChange('')}>
        {none}
      </button>
    </div>
  );
}

function Bar({ used, state }: { used: number; state?: 'ok' | 'near' | 'over' }) {
  return (
    <span className="mp-bar" aria-hidden>
      <span className={state ?? 'ok'} style={{ width: `${Math.min(100, used * 100)}%` }} />
    </span>
  );
}

const amountField = (id: string, label: string, value: string, set: (v: string) => void, opts: { placeholder?: string; help?: string; autofocus?: boolean } = {}) => (
  <div className="field">
    <label htmlFor={id}>{label}</label>
    <input id={id} className="input mp-amount" inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} placeholder={opts.placeholder ?? '0'} autoComplete="off" data-autofocus={opts.autofocus || undefined} />
    {opts.help && <span className="help-text">{opts.help}</span>}
  </div>
);

// --------------------------------------------------------- the button row --

export type PlanView = 'budgets' | 'utang' | 'bills' | 'goals' | 'report';

/** Expenses: the five money tools, with what needs attention. */
export function PlansBar({ snap, onOpen }: { snap: VaultSnapshot; onOpen: (v: PlanView) => void }) {
  const today = dayKey(new Date());
  const due = billsInOrder(snap.bills, today).filter((b) => b.state === 'overdue' || b.state === 'today').length;
  const t = debtTotals(snap.debts);
  const overBudget = budgetRows(snap.transactions, monthOf(today), snap.settings).filter((r) => r.state !== 'ok').length;
  const items: [PlanView, string, ReactNode, number][] = [
    ['budgets', tr("Budgets"), <PiggyBank key="i" size={17} aria-hidden />, overBudget],
    ['utang', tr("Utang"), <HandCoins key="i" size={17} aria-hidden />, t.peopleOwing + t.peopleOwed],
    ['bills', tr("Bills"), <Receipt key="i" size={17} aria-hidden />, due],
    ['goals', tr("Goals"), <Target key="i" size={17} aria-hidden />, 0],
    ['report', tr("Report"), <FileText key="i" size={17} aria-hidden />, 0]
  ];
  return (
    <div className="mp-row" role="group" aria-label={tr("Money tools")}>
      {items.map(([v, label, icon, n]) => (
        <button key={v} type="button" className="mp-tile" onClick={() => onOpen(v)}>
          <span className="mp-tile-icon">{icon}</span>
          <span>{label}</span>
          {n > 0 && <span className={`mp-badge ${v === 'bills' || v === 'budgets' ? 'warn' : ''}`}>{n}</span>}
        </button>
      ))}
    </div>
  );
}

export function PlanDialogs({ view, snap, onClose, onChanged, onOpenBudget }: { view: PlanView; snap: VaultSnapshot; onClose: () => void; onChanged: () => Promise<void>; onOpenBudget: () => void }) {
  if (view === 'budgets') return <Budgets snap={snap} onClose={onClose} onChanged={onChanged} onTotal={onOpenBudget} />;
  if (view === 'utang') return <Utang snap={snap} onClose={onClose} onChanged={onChanged} />;
  if (view === 'bills') return <Bills snap={snap} onClose={onClose} onChanged={onChanged} />;
  if (view === 'goals') return <Goals snap={snap} onClose={onClose} onChanged={onChanged} />;
  return <Report snap={snap} onClose={onClose} />;
}

// ------------------------------------------------------------- budgets --

function Budgets({ snap, onClose, onChanged, onTotal }: { snap: VaultSnapshot; onClose: () => void; onChanged: () => Promise<void>; onTotal: () => void }) {
  const money = useMoney(snap);
  const toast = useToast();
  const today = new Date();
  const month = monthOf(dayKey(today));
  const rows = budgetRows(snap.transactions, month, snap.settings);
  const [editing, setEditing] = useState<{ category: string; amount: string } | null>(null);
  const { monthlyBudget } = snap.settings;
  const spent = snap.transactions.filter((t) => t.kind === 'expense' && monthOf(t.date) === month).reduce((a, t) => a + t.amount, 0);
  const daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate() + 1;
  const left = monthlyBudget - spent;

  const save = async (category: string, amount: number) => {
    try {
      if (category === 'coffee') await unwrap(api.vault.updateSettings({ coffeeBudget: amount }));
      else {
        const next = { ...snap.settings.categoryBudgets };
        if (amount > 0) next[category] = amount;
        else delete next[category];
        await unwrap(api.vault.updateSettings({ categoryBudgets: next }));
      }
      await onChanged();
      setEditing(null);
      toast(amount > 0 ? tr("{0} budget: {1} a month.", [moneyCategory(category).name, money(amount)]) : tr("{0} budget removed.", [moneyCategory(category).name]));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const cats = allMoneyCategories().filter((c) => c.kind === 'expense');
  return (
    <Dialog placement="center" size="wide" title={tr("Budgets")} subtitle={parseDay(`${month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} onClose={onClose}>
      <button type="button" className="mp-card mp-total" onClick={onTotal}>
        <span className="label">
          {parseDay(`${month}-01`).toLocaleDateString(undefined, { month: 'long' })} · {daysLeft} {tr("day")}{daysLeft === 1 ? '' : 's'} {tr("left")}
        </span>
        {monthlyBudget > 0 ? (
          <>
            <span className="mp-big">
              {money(Math.max(0, left))} <span className="dim small">{left >= 0 ? tr("left of {0}", [money(monthlyBudget)]) : tr("over {0} by {1}", [money(monthlyBudget), money(-left)])}</span>
            </span>
            <Bar used={spent / monthlyBudget} state={left < 0 ? 'over' : spent / monthlyBudget >= 0.8 ? 'near' : 'ok'} />
            {left > 0 && <span className="dim small">{tr("About")} {money(Math.floor(left / daysLeft / 100) * 100)} {tr("a day for the rest of the month")}</span>}
          </>
        ) : (
          <span className="dim">{tr("Set a total monthly budget (tap here)")}</span>
        )}
      </button>
      {rows.length === 0 && <p className="dim small" style={{ margin: '12px 2px' }}>{tr("Add a budget for a category, like Food ₱3,000 or Games ₱500. You get a heads-up at 80% and when you go over.")}</p>}
      <ul className="mp-list">
        {rows.map((r) => (
          <li key={r.category}>
            <button type="button" className="mp-card mp-budget" onClick={() => setEditing({ category: r.category, amount: fromMinor(r.budget) })}>
              <span className="mp-line">
                <span className="mp-ico">
                  <MoneyIconFor category={r.category} size={16} />
                </span>
                <b className="grow">{moneyCategory(r.category).name}</b>
                <span className="small">
                  <b>{money(r.spent)}</b> <span className="dim">/ {money(r.budget)}</span>
                </span>
              </span>
              <Bar used={r.used} state={r.state} />
              {r.state !== 'ok' && <span className={`small mp-state ${r.state}`}>{r.state === 'over' ? tr("{0} over", [money(r.spent - r.budget)]) : tr("{0}% used · {1} left", [Math.round(r.used * 100), money(r.budget - r.spent)])}</span>}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn block" onClick={() => setEditing({ category: '', amount: '' })}>
        <Plus size={15} aria-hidden /> {tr("Add a budget")}
      </button>
      {editing && (
        <Dialog
          placement="center"
          size="narrow"
          title={editing.category ? tr("{0} budget", [moneyCategory(editing.category).name]) : tr("Add a budget")}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.category && rows.some((r) => r.category === editing.category) && (
                <button type="button" className="btn danger left" onClick={() => void save(editing.category, 0)}>
                  {tr("Remove")}
                </button>
              )}
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                {tr("Cancel")}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!editing.category || toMinor(editing.amount) === null}
                onClick={() => void save(editing.category, toMinor(editing.amount)!)}
              >
                {tr("Save")}
              </button>
            </>
          }
        >
          {!rows.some((r) => r.category === editing.category) && (
            <div className="field">
              <span className="label">{tr("Category")}</span>
              <div className="mp-chips">
                {cats
                  .filter((c) => !rows.some((r) => r.category === c.id))
                  .map((c) => (
                    <button key={c.id} type="button" className="vl-pill mp-pick" aria-checked={editing.category === c.id} role="radio" onClick={() => setEditing({ ...editing, category: c.id })}>
                      <MoneyIconFor category={c.id} size={13} /> {c.name}
                    </button>
                  ))}
              </div>
            </div>
          )}
          {amountField('mp-budget', tr("Per month"), editing.amount, (v) => setEditing({ ...editing, amount: v }), { placeholder: '3,000', autofocus: true })}
        </Dialog>
      )}
    </Dialog>
  );
}

// --------------------------------------------------------------- utang --

function Utang({ snap, onClose, onChanged }: { snap: VaultSnapshot; onClose: () => void; onChanged: () => Promise<void> }) {
  const money = useMoney(snap);
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'owedToMe' | 'iOwe' | 'paid'>('all');
  const [editing, setEditing] = useState<Partial<Debt> | null>(null);
  const [paying, setPaying] = useState<Debt | null>(null);
  const [deleting, setDeleting] = useState<Debt | null>(null);
  const totals = debtTotals(snap.debts);
  const list = snap.debts
    .filter((d) => (filter === 'paid' ? debtSettled(d) : !debtSettled(d) && (filter === 'all' || d.direction === filter)))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.createdAt.localeCompare(a.createdAt));

  return (
    <Dialog placement="center" size="wide" title={tr("Utang")} subtitle={tr("Who owes who")} onClose={onClose}>
      <div className="mp-two">
        <div className="mp-card">
          <span className="label">{tr("Owed to you")}</span>
          <span className="mp-big pos">{money(totals.owedToMe)}</span>
          <span className="dim small">
            {totals.peopleOwing} {totals.peopleOwing === 1 ? 'person' : 'people'}
          </span>
        </div>
        <div className="mp-card">
          <span className="label">{tr("You owe")}</span>
          <span className="mp-big neg">{money(totals.iOwe)}</span>
          <span className="dim small">
            {totals.peopleOwed} {totals.peopleOwed === 1 ? 'person' : 'people'}
          </span>
        </div>
      </div>
      <div className="segmented mp-seg" role="group" aria-label={tr("Show")}>
        {(
          [
            ['all', tr("All")],
            ['owedToMe', tr("Owed to me")],
            ['iOwe', tr("I owe")],
            ['paid', tr("Paid")]
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="dim small" style={{ margin: '10px 2px' }}>
          {filter === 'paid' ? tr("Nothing paid back yet.") : tr("Nobody owes anything. Add one when you lend or borrow money.")}
        </p>
      ) : (
        <ul className="mp-list">
          {list.map((d) => {
            const left = debtLeft(d);
            const paid = debtPaid(d);
            return (
              <li key={d.id}>
                <div className="mp-card mp-debt">
                  <button type="button" className="mp-debt-main" onClick={() => setEditing(d)}>
                    <span className="mp-av">{d.person.charAt(0).toUpperCase()}</span>
                    <span className="grow">
                      <b>{d.person}</b>
                      <span className="dim small">
                        {[d.note, paid > 0 && !debtSettled(d) ? `${money(paid)} paid` : '', d.due && !debtSettled(d) ? `due ${shortDay(d.due)}` : '', debtSettled(d) ? 'paid back' : ''].filter(Boolean).join(' · ') || (d.direction === 'owedToMe' ? tr("owes you") : tr("you owe"))}
                      </span>
                    </span>
                    <b className={d.direction === 'owedToMe' ? 'pos' : 'neg'}>{money(debtSettled(d) ? d.amount : left)}</b>
                  </button>
                  {!debtSettled(d) ? (
                    <button type="button" className="btn sm" onClick={() => setPaying(d)}>
                      <Check size={14} aria-hidden /> {d.direction === 'owedToMe' ? tr("Paid me") : tr("I paid")}
                    </button>
                  ) : (
                    <button type="button" className="icon-btn" aria-label={tr("Delete {0}", [d.person])} onClick={() => setDeleting(d)}>
                      <Trash size={15} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="btn primary block" onClick={() => setEditing({ direction: 'owedToMe' })}>
        <Plus size={15} aria-hidden /> {tr("Add utang")}
      </button>
      {editing && <DebtEditor snap={snap} initial={editing} onClose={() => setEditing(null)} onChanged={onChanged} onDelete={(d) => setDeleting(d)} />}
      {paying && <PayDebt snap={snap} debt={paying} onClose={() => setPaying(null)} onChanged={onChanged} />}
      {deleting && (
        <ConfirmDialog
          placement="center"
          title={tr("Delete utang with {0}?", [deleting.person])}
          danger
          confirmLabel={tr("Delete")}
          message={tr("Records already added to Expenses stay.")}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await unwrap(api.plans.deleteDebt(deleting.id));
              await onChanged();
              setDeleting(null);
              setEditing(null);
              toast(tr("Utang deleted."));
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
    </Dialog>
  );
}

function DebtEditor({ snap, initial, onClose, onChanged, onDelete }: { snap: VaultSnapshot; initial: Partial<Debt>; onClose: () => void; onChanged: () => Promise<void>; onDelete: (d: Debt) => void }) {
  const toast = useToast();
  const [direction, setDirection] = useState(initial.direction ?? 'owedToMe');
  const [person, setPerson] = useState(initial.person ?? '');
  const [amount, setAmount] = useState(fromMinor(initial.amount ?? 0));
  const [note, setNote] = useState(initial.note ?? '');
  const [due, setDue] = useState(initial.due ?? '');
  const [busy, setBusy] = useState(false);
  const people = useMemo(() => [...new Set(snap.debts.map((d) => d.person))].slice(0, 8), [snap.debts]);
  const save = async () => {
    const minor = toMinor(amount);
    if (!person.trim() || minor === null) return toast(!person.trim() ? tr("Who is it with?") : tr("Enter an amount."), 'error');
    setBusy(true);
    try {
      await unwrap(api.plans.saveDebt({ ...(initial.id ? { id: initial.id } : {}), person, direction, amount: minor, note, date: initial.date ?? dayKey(new Date()), due }));
      await onChanged();
      toast(initial.id ? tr("Saved.") : direction === 'owedToMe' ? tr("{0} owes you {1}.", [person.trim(), formatMoney(minor, snap.settings.currency)]) : tr("You owe {0} {1}.", [person.trim(), formatMoney(minor, snap.settings.currency)]));
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      placement="center"
      size="narrow"
      title={initial.id ? tr("Edit utang") : tr("Add utang")}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {initial.id && (
            <button type="button" className="btn danger left" onClick={() => onDelete(initial as Debt)}>
              {tr("Delete")}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {tr("Cancel")}
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
            {tr("Save")}
          </button>
        </>
      }
    >
      <div className="segmented mp-seg" role="group" aria-label={tr("Who owes")}>
        <button type="button" aria-pressed={direction === 'owedToMe'} onClick={() => setDirection('owedToMe')}>
          {tr("They owe me")}
        </button>
        <button type="button" aria-pressed={direction === 'iOwe'} onClick={() => setDirection('iOwe')}>
          {tr("I owe them")}
        </button>
      </div>
      <div className="field">
        <label htmlFor="mp-person">{tr("Person")}</label>
        <input id="mp-person" className="input" value={person} onChange={(e) => setPerson(e.target.value)} placeholder={tr("Ana")} maxLength={60} autoComplete="off" data-autofocus />
        {!initial.id && people.length > 0 && (
          <div className="mp-chips" style={{ marginTop: 6 }}>
            {people.map((p) => (
              <button key={p} type="button" className="vl-pill" onClick={() => setPerson(p)}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
      {amountField('mp-debt-amount', tr("Amount"), amount, setAmount, { placeholder: '500' })}
      <div className="field">
        <label htmlFor="mp-debt-note">{tr("What for (optional)")}</label>
        <input id="mp-debt-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Lunch at SM")} maxLength={120} autoComplete="off" />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="mp-debt-due">{direction === 'owedToMe' ? tr("Remind me to collect on") : tr("Remind me to pay on")}</label>
        <input id="mp-debt-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
        <span className="help-text">{tr("A reminder rings at 9:00 AM that day. Leave empty for none.")}</span>
      </div>
    </Dialog>
  );
}

function PayDebt({ snap, debt, onClose, onChanged }: { snap: VaultSnapshot; debt: Debt; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const money = useMoney(snap);
  const left = debtLeft(debt);
  const [part, setPart] = useState(false);
  const [amount, setAmount] = useState(fromMinor(left));
  const [account, setAccount] = useState(snap.accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    const minor = part ? toMinor(amount) : left;
    if (minor === null || minor <= 0 || minor > left) return toast(tr("Enter up to {0}.", [money(left)]), 'error');
    setBusy(true);
    try {
      await unwrap(api.plans.payDebt(debt.id, { amount: minor, date: dayKey(new Date()), ...(account ? { accountId: account } : {}) }));
      api.app.haptic('success');
      await onChanged();
      toast(minor === left ? (debt.direction === 'owedToMe' ? tr("{0} paid you back.", [debt.person]) : tr("You paid {0} back.", [debt.person])) : tr("{0} paid · {1} left.", [money(minor), money(left - minor)]));
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      placement="center"
      size="narrow"
      title={debt.direction === 'owedToMe' ? tr("{0} paid you back?", [debt.person]) : tr("Paid {0} back?", [debt.person])}
      subtitle={`${money(left)}${debt.note ? ` · ${debt.note}` : ''}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={() => setPart((p) => !p)}>
            {part ? tr("All of it") : tr("Part only")}
          </button>
          <button type="button" className="btn primary" onClick={() => void pay()} disabled={busy}>
            {part ? tr("Save") : tr("Mark {0} paid", [money(left)])}
          </button>
        </>
      }
    >
      {part && amountField('mp-pay', tr("How much"), amount, setAmount, { autofocus: true })}
      <div className="field" style={{ marginBottom: 0 }}>
        <span className="label">{debt.direction === 'owedToMe' ? tr("Put the money in") : tr("Paid from")}</span>
        <AccountPick accounts={snap.accounts} value={account} onChange={setAccount} none={tr("Don't add")} />
        <span className="help-text">{tr("With an account it also goes into Expenses (as money")} {debt.direction === 'owedToMe' ? 'in' : 'out'}).</span>
      </div>
    </Dialog>
  );
}

// --------------------------------------------------------------- bills --

const STATE_TEXT: Record<BillStatus['state'], (s: BillStatus, money: (v: number) => string) => string> = {
  overdue: (s, m) => `Overdue since ${shortDay(s.due)}${s.bill.amount ? ` · about ${m(s.bill.amount)}` : ''}`,
  today: (s, m) => `Due today${s.bill.amount ? ` · about ${m(s.bill.amount)}` : ''}`,
  soon: (s, m) => `Due ${shortDay(s.due)} · in ${s.days} day${s.days === 1 ? '' : 's'}${s.bill.amount ? ` · ${m(s.bill.amount)}` : ''}`,
  later: (s, m) => `${shortDay(s.due)}${s.bill.amount ? ` · ${m(s.bill.amount)}` : ''}`,
  paid: (s, m) => `Paid ${shortDay(s.paid!.date)} · ${m(s.paid!.amount)}`
};

function Bills({ snap, onClose, onChanged }: { snap: VaultSnapshot; onClose: () => void; onChanged: () => Promise<void> }) {
  const money = useMoney(snap);
  const toast = useToast();
  const today = dayKey(new Date());
  const list = billsInOrder(snap.bills, today);
  const month = billsMonth(snap.bills, today);
  const [editing, setEditing] = useState<Partial<Bill> | null>(null);
  const [paying, setPaying] = useState<BillStatus | null>(null);
  return (
    <Dialog placement="center" size="wide" title={tr("Bills")} subtitle={tr("Monthly and yearly bills")} onClose={onClose}>
      <div className="mp-card">
        <span className="label">{tr("Bills this month")}</span>
        <span className="mp-big">
          {money(month.total)} {month.left > 0 && <span className="dim small">· {money(month.left)} {tr("still to pay")}</span>}
        </span>
      </div>
      {list.length === 0 && <p className="dim small" style={{ margin: '12px 2px' }}>{tr("Add Meralco, water, internet, rent or subscriptions. You get a reminder the day before and on the day, then add the real amount to Expenses in one tap.")}</p>}
      <ul className="mp-list">
        {list.map((s) => (
          <li key={s.bill.id}>
            <div className={`mp-card mp-bill ${s.state}`}>
              <button type="button" className="mp-debt-main" onClick={() => setEditing(s.bill)}>
                <span className="mp-ico">{s.state === 'paid' ? <Check size={16} aria-hidden /> : <MoneyIconFor category={s.bill.category} size={16} />}</span>
                <span className="grow">
                  <b>{s.bill.name}</b>
                  <span className={`small mp-state ${s.state === 'overdue' ? 'over' : s.state === 'today' ? 'near' : 'dim'}`}>{STATE_TEXT[s.state](s, money)}</span>
                </span>
              </button>
              {s.state === 'paid' ? (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={tr("Undo paid")}
                  title={tr("Undo paid")}
                  onClick={async () => {
                    try {
                      await unwrap(api.plans.unpayBill(s.bill.id, s.period));
                      await onChanged();
                      toast(tr("Marked as not paid. The Expenses record was removed."));
                    } catch (e) {
                      toast(errorMessage(e), 'error');
                    }
                  }}
                >
                  <Undo2 size={15} />
                </button>
              ) : (
                <button type="button" className={`btn sm ${s.state === 'overdue' || s.state === 'today' ? 'primary' : ''}`} onClick={() => setPaying(s)}>
                  {tr("Pay")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn primary block" onClick={() => setEditing({ freq: 'monthly', day: Number(today.slice(8, 10)), category: 'bills', remind: true })}>
        <Plus size={15} aria-hidden /> {tr("Add a bill")}
      </button>
      {editing && <BillEditor snap={snap} initial={editing} onClose={() => setEditing(null)} onChanged={onChanged} />}
      {paying && <PayBill snap={snap} status={paying} onClose={() => setPaying(null)} onChanged={onChanged} />}
    </Dialog>
  );
}

function BillEditor({ snap, initial, onClose, onChanged }: { snap: VaultSnapshot; initial: Partial<Bill>; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(initial.name ?? '');
  const [amount, setAmount] = useState(fromMinor(initial.amount ?? 0));
  const [freq, setFreq] = useState(initial.freq ?? 'monthly');
  const [day, setDay] = useState(String(initial.day ?? 1));
  const [month, setMonth] = useState(String(initial.month ?? new Date().getMonth() + 1));
  const [category, setCategory] = useState(initial.category ?? 'bills');
  const [account, setAccount] = useState(initial.accountId ?? '');
  const [remind, setRemind] = useState(initial.remind ?? true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cats = allMoneyCategories().filter((c) => c.kind === 'expense');
  const save = async () => {
    const minor = amount.trim() ? toMinor(amount, true) : 0;
    if (minor === null) return toast(tr("Enter the usual amount, or leave it empty if it changes."), 'error');
    setBusy(true);
    try {
      await unwrap(
        api.plans.saveBill({
          ...(initial.id ? { id: initial.id } : {}),
          name,
          amount: minor,
          category,
          ...(account ? { accountId: account } : {}),
          freq,
          day: Number(day),
          ...(freq === 'yearly' ? { month: Number(month) } : {}),
          remind
        })
      );
      await onChanged();
      toast(initial.id ? tr("Bill saved.") : tr("{0} added. You'll get a reminder before it's due.", [name.trim()]));
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      placement="center"
      size="narrow"
      title={initial.id ? tr("Edit {0}", [initial.name]) : tr("Add a bill")}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {initial.id && (
            <button type="button" className="btn danger left" onClick={() => setConfirmDelete(true)}>
              {tr("Delete")}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {tr("Cancel")}
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            {tr("Save")}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="mp-bill-name">{tr("Name")}</label>
        <input id="mp-bill-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Meralco, PLDT, Rent, Netflix…")} maxLength={60} autoComplete="off" data-autofocus />
      </div>
      {amountField('mp-bill-amount', tr("Usual amount"), amount, setAmount, { placeholder: tr("Leave empty if it changes"), help: tr("You confirm the real amount each time.") })}
      <div className="segmented mp-seg" role="group" aria-label={tr("How often")}>
        <button type="button" aria-pressed={freq === 'monthly'} onClick={() => setFreq('monthly')}>
          {tr("Every month")}
        </button>
        <button type="button" aria-pressed={freq === 'yearly'} onClick={() => setFreq('yearly')}>
          {tr("Every year")}
        </button>
      </div>
      <div className="grid-2">
        {freq === 'yearly' && (
          <div className="field">
            <label htmlFor="mp-bill-month">{tr("Month")}</label>
            <select id="mp-bill-month" className="select" value={month} onChange={(e) => setMonth(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {new Date(2026, i, 1).toLocaleDateString(undefined, { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="mp-bill-day">{tr("Due on day")}</label>
          <select id="mp-bill-day" className="select" value={day} onChange={(e) => setDay(e.target.value)}>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <span className="label">{tr("Category in Expenses")}</span>
        <div className="mp-chips">
          {cats.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={category === c.id} className="vl-pill mp-pick" onClick={() => setCategory(c.id)}>
              <MoneyIconFor category={c.id} size={13} /> {c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">{tr("Usually paid from")}</span>
        <AccountPick accounts={snap.accounts} value={account} onChange={setAccount} />
      </div>
      <label className="mp-toggle">
        <CalendarClock size={16} aria-hidden />
        <span className="grow">{tr("Remind me the day before and on the day (9:00 AM)")}</span>
        <input type="checkbox" className="switch" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
      </label>
      {confirmDelete && (
        <ConfirmDialog
          placement="center"
          title={tr("Delete {0}?", [initial.name])}
          danger
          confirmLabel={tr("Delete")}
          message={tr("Records already added to Expenses stay.")}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              await unwrap(api.plans.deleteBill(initial.id!));
              await onChanged();
              toast(tr("Bill deleted."));
              onClose();
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
    </Dialog>
  );
}

function PayBill({ snap, status, onClose, onChanged }: { snap: VaultSnapshot; status: BillStatus; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const money = useMoney(snap);
  const b = status.bill;
  const last = billLastAmount(b);
  const [amount, setAmount] = useState(fromMinor(last));
  const [account, setAccount] = useState(b.accountId ?? snap.accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    const minor = toMinor(amount, true);
    if (minor === null) return toast(tr("Enter the amount you paid."), 'error');
    setBusy(true);
    try {
      await unwrap(api.plans.payBill(b.id, { period: status.period, amount: minor, date: dayKey(new Date()), ...(account ? { accountId: account } : {}) }));
      api.app.haptic('success');
      await onChanged();
      toast(minor ? tr("{0} paid · {1} added to Expenses.", [b.name, money(minor)]) : tr("{0} marked paid.", [b.name]));
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      placement="center"
      size="narrow"
      title={status.state === 'today' ? tr("{0} is due today", [b.name]) : status.state === 'overdue' ? tr("{0} is overdue", [b.name]) : tr("Pay {0}", [b.name])}
      subtitle={last ? tr("Last time {0}. Check this bill:", [money(last)]) : tr("How much is this bill?")}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {tr("Later")}
          </button>
          <button type="button" className="btn primary" onClick={() => void pay()} disabled={busy}>
            {tr("Paid · add to Expenses")}
          </button>
        </>
      }
    >
      {amountField('mp-bill-pay', tr("Amount"), amount, setAmount, { autofocus: true })}
      <div className="field" style={{ marginBottom: 0 }}>
        <span className="label">{tr("Paid from")}</span>
        <AccountPick accounts={snap.accounts} value={account} onChange={setAccount} />
      </div>
    </Dialog>
  );
}

// --------------------------------------------------------------- goals --

function Goals({ snap, onClose, onChanged }: { snap: VaultSnapshot; onClose: () => void; onChanged: () => Promise<void> }) {
  const money = useMoney(snap);
  const today = dayKey(new Date());
  const [open, setOpen] = useState<string | null>(snap.goals.length === 1 ? snap.goals[0]!.id : null);
  const [editing, setEditing] = useState<Partial<Goal> | null>(null);
  const goal = snap.goals.find((g) => g.id === open);
  if (goal) return <GoalPage snap={snap} goal={goal} onBack={snap.goals.length > 1 ? () => setOpen(null) : undefined} onClose={onClose} onChanged={onChanged} onEdit={() => setEditing(goal)} editing={editing} setEditing={setEditing} />;
  return (
    <Dialog placement="center" size="wide" title={tr("Savings goals")} onClose={onClose}>
      {snap.goals.length === 0 && <p className="dim small" style={{ margin: '4px 2px 12px' }}>{tr("Save for something, like a new phone ₱25,000 by March. VaultLocks tells you how much to put aside each week.")}</p>}
      <ul className="mp-list">
        {snap.goals.map((g) => {
          const p = goalPlan(g, today);
          return (
            <li key={g.id}>
              <button type="button" className="mp-card mp-budget" onClick={() => setOpen(g.id)}>
                <span className="mp-line">
                  <span className="mp-ico">
                    <Target size={16} aria-hidden />
                  </span>
                  <b className="grow">{g.name}</b>
                  <span className="small">
                    <b>{money(p.saved)}</b> <span className="dim">/ {money(g.target)}</span>
                  </span>
                </span>
                <Bar used={p.pct} />
                <span className="dim small">{p.state === 'done' ? tr("Done!") : p.perWeek ? tr("Save {0} a week", [money(p.perWeek)]) : g.by ? tr("The date has passed") : `${money(p.left)} to go`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn primary block" onClick={() => setEditing({})}>
        <Plus size={15} aria-hidden /> {tr("New goal")}
      </button>
      {editing && <GoalEditor snap={snap} initial={editing} onClose={() => setEditing(null)} onChanged={onChanged} onSaved={(g) => setOpen(g.id)} />}
    </Dialog>
  );
}

function GoalPage({
  snap,
  goal,
  onBack,
  onClose,
  onChanged,
  onEdit,
  editing,
  setEditing
}: {
  snap: VaultSnapshot;
  goal: Goal;
  onBack?: () => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onEdit: () => void;
  editing: Partial<Goal> | null;
  setEditing: (g: Partial<Goal> | null) => void;
}) {
  const money = useMoney(snap);
  const toast = useToast();
  const today = dayKey(new Date());
  const p = goalPlan(goal, today);
  const [moving, setMoving] = useState<'in' | 'out' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deg = Math.round(p.pct * 360);
  return (
    <Dialog
      placement="center"
      size="wide"
      title={goal.name}
      subtitle={goal.by ? tr("Goal · by {0}", [parseDay(goal.by).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })]) : tr("Goal")}
      onClose={onClose}
      footer={
        <>
          {onBack && (
            <button type="button" className="btn left" onClick={onBack}>
              {tr("All goals")}
            </button>
          )}
          <button type="button" className="btn" onClick={onEdit}>
            {tr("Edit")}
          </button>
          <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>
            {tr("Delete")}
          </button>
        </>
      }
    >
      <div className="mp-ring" style={{ ['--deg' as string]: `${deg}deg` }} role="img" aria-label={tr("{0}% saved", [Math.round(p.pct * 100)])}>
        <div>
          <b className="mp-ring-pct">{Math.round(p.pct * 100)}%</b>
          <span className="dim small">
            {money(p.saved)} {tr("of")} {money(goal.target)}
          </span>
        </div>
      </div>
      <div className="mp-card mp-line" style={{ marginBottom: 12 }}>
        <span className="mp-ico">
          <Target size={16} aria-hidden />
        </span>
        <span className="grow">
          <b>{p.state === 'done' ? tr("You reached your goal!") : p.perWeek ? tr("Save {0} a week", [money(p.perWeek)]) : p.state === 'late' ? tr("{0} still to go", [money(p.left)]) : `${money(p.left)} to go`}</b>
          <span className="dim small" style={{ display: 'block' }}>
            {p.state === 'done' ? tr("Nice work.") : p.weeksLeft ? tr("{0} week{1} left · {2}", [p.weeksLeft, p.weeksLeft === 1 ? '' : 's', p.state === 'onTrack' ? "you're on track" : 'a little behind']) : p.state === 'late' ? tr("The date has passed — edit it to set a new one.") : tr("No deadline")}
          </span>
        </span>
      </div>
      <div className="mp-two">
        <button type="button" className="btn primary" onClick={() => setMoving('in')}>
          <Plus size={15} aria-hidden /> {tr("Add money")}
        </button>
        <button type="button" className="btn" onClick={() => setMoving('out')} disabled={p.saved === 0}>
          {tr("Take out")}
        </button>
      </div>
      {goal.moves.length > 0 && (
        <>
          <div className="label" style={{ margin: '16px 0 4px' }}>
            {tr("History")}
          </div>
          <ul className="mp-history">
            {[...goal.moves].reverse().slice(0, 40).map((m, i) => (
              <li key={i}>
                <span className="grow">
                  {shortDay(m.date)}
                  {m.accountId ? ` · ${m.amount > 0 ? 'from' : 'to'} ${snap.accounts.find((a) => a.id === m.accountId)?.name ?? 'account'}` : ''}
                  {m.note ? ` · ${m.note}` : ''}
                </span>
                <b className={m.amount > 0 ? 'pos' : 'neg'}>
                  {m.amount > 0 ? '+' : '−'}
                  {money(Math.abs(m.amount))}
                </b>
              </li>
            ))}
          </ul>
        </>
      )}
      {moving && <MoveGoal snap={snap} goal={goal} out={moving === 'out'} onClose={() => setMoving(null)} onChanged={onChanged} />}
      {editing && <GoalEditor snap={snap} initial={editing} onClose={() => setEditing(null)} onChanged={onChanged} />}
      {confirmDelete && (
        <ConfirmDialog
          placement="center"
          title={tr("Delete “{0}”?", [goal.name])}
          danger
          confirmLabel={tr("Delete")}
          message={tr("Money in it goes back to the accounts it came from.")}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              await unwrap(api.plans.deleteGoal(goal.id));
              await onChanged();
              toast(tr("Goal deleted."));
              onClose();
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
    </Dialog>
  );
}

function GoalEditor({ snap, initial, onClose, onChanged, onSaved }: { snap: VaultSnapshot; initial: Partial<Goal>; onClose: () => void; onChanged: () => Promise<void>; onSaved?: (g: Goal) => void }) {
  const toast = useToast();
  const [name, setName] = useState(initial.name ?? '');
  const [target, setTarget] = useState(fromMinor(initial.target ?? 0));
  const [by, setBy] = useState(initial.by ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const minor = toMinor(target);
    if (minor === null) return toast(tr("Enter how much you want to save."), 'error');
    setBusy(true);
    try {
      const g = await unwrap(api.plans.saveGoal({ ...(initial.id ? { id: initial.id } : {}), name, target: minor, by }));
      await onChanged();
      toast(initial.id ? tr("Goal saved.") : tr("Goal “{0}” added.", [g.name]));
      onClose();
      onSaved?.(g);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      placement="center"
      size="narrow"
      title={initial.id ? tr("Edit goal") : tr("New goal")}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {tr("Cancel")}
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            {tr("Save")}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="mp-goal-name">{tr("Saving for")}</label>
        <input id="mp-goal-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("New phone")} maxLength={60} autoComplete="off" data-autofocus />
      </div>
      {amountField('mp-goal-target', tr("Target"), target, setTarget, { placeholder: '25,000' })}
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="mp-goal-by">{tr("By (optional)")}</label>
        <input id="mp-goal-by" type="date" className="input" value={by} min={dayKey(new Date())} onChange={(e) => setBy(e.target.value)} />
        <span className="help-text">{tr("With a date, VaultLocks works out how much to save each week.")}</span>
      </div>
      {snap.goals.length >= 100 && <span className="error-text">{tr("You have the most goals allowed.")}</span>}
    </Dialog>
  );
}

function MoveGoal({ snap, goal, out, onClose, onChanged }: { snap: VaultSnapshot; goal: Goal; out: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const money = useMoney(snap);
  const p = goalPlan(goal, dayKey(new Date()));
  const [amount, setAmount] = useState(out ? '' : fromMinor(p.perWeek ?? 0));
  const [account, setAccount] = useState(snap.accounts[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const minor = toMinor(amount);
    if (minor === null) return toast(tr("Enter an amount."), 'error');
    setBusy(true);
    try {
      await unwrap(api.plans.moveGoal(goal.id, { amount: out ? -minor : minor, date: dayKey(new Date()), note, ...(account ? { accountId: account } : {}) }));
      api.app.haptic('success');
      await onChanged();
      toast(out ? tr("{0} taken out of {1}.", [money(minor), goal.name]) : tr("{0} added to {1}.", [money(minor), goal.name]));
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      placement="center"
      size="narrow"
      title={out ? tr("Take out of {0}", [goal.name]) : tr("Add to {0}", [goal.name])}
      subtitle={tr("{0} saved", [money(p.saved)])}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {tr("Cancel")}
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
            {out ? tr("Take out") : tr("Add")}
          </button>
        </>
      }
    >
      {amountField('mp-move', tr("Amount"), amount, setAmount, { autofocus: true })}
      <div className="field">
        <span className="label">{out ? tr("Put it back in") : tr("From")}</span>
        <AccountPick accounts={snap.accounts} value={account} onChange={setAccount} none={tr("Not from an account")} />
        <span className="help-text">{tr("The account's balance goes")} {out ? 'up' : 'down'}{tr(". It doesn't count as spending.")}</span>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="mp-move-note">{tr("Note (optional)")}</label>
        <input id="mp-move-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={out ? tr("Bought the case") : tr("Salary")} maxLength={80} autoComplete="off" />
      </div>
    </Dialog>
  );
}

// -------------------------------------------------------------- report --

function Report({ snap, onClose }: { snap: VaultSnapshot; onClose: () => void }) {
  const money = useMoney(snap);
  const toast = useToast();
  const [month, setMonth] = useState(monthOf(dayKey(new Date())));
  const r = useMemo(() => monthReport(snap.transactions, month), [snap.transactions, month]);
  const [busy, setBusy] = useState(false);
  const months = useMemo(() => {
    const set = new Set(snap.transactions.map((t) => monthOf(t.date)));
    set.add(monthOf(dayKey(new Date())));
    return [...set].sort().reverse().slice(0, 36);
  }, [snap.transactions]);
  const max = Math.max(1, ...r.byCategory.map((c) => c.amount));
  const smax = Math.max(1, ...r.sixMonths.map((m) => m.spent));
  const diff = r.spent - r.prevSpent;
  const savePdf = async () => {
    setBusy(true);
    try {
      const bytes = reportPdf(r, snap.settings.currency);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const where = await unwrap(api.files.save(`VaultLocks report ${month}.pdf`, btoa(bin), 'application/pdf'));
      if (where) toast(tr("Report saved."));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      placement="center"
      size="wide"
      title={tr("Monthly report")}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn primary" onClick={() => void savePdf()} disabled={busy}>
            <FileText size={15} aria-hidden /> {tr("Save as PDF")}
          </button>
        </>
      }
    >
      <select className="select mp-month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={tr("Month")}>
        {months.map((m) => (
          <option key={m} value={m}>
            {parseDay(`${m}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </option>
        ))}
      </select>
      <div className="mp-paper">
        <div className="mp-paper-kicker">{tr("VaultLocks · Monthly report")}</div>
        <h2 className="mp-paper-title">{r.label}</h2>
        <div className="mp-three">
          <div>
            <span className="dim small">{tr("Spent")}</span>
            <b>{money(r.spent)}</b>
            {r.prevSpent > 0 && <span className={`small ${diff <= 0 ? 'pos' : 'neg'}`}>{diff <= 0 ? '↓' : '↑'} {money(Math.abs(diff))} {tr("vs last month")}</span>}
          </div>
          <div>
            <span className="dim small">{tr("Income")}</span>
            <b>{money(r.income)}</b>
          </div>
          <div>
            <span className="dim small">{tr("Saved")}</span>
            <b>{money(r.saved)}</b>
            {r.income > 0 && <span className="dim small">{Math.round((Math.max(0, r.saved) / r.income) * 100)}{tr("% of income")}</span>}
          </div>
        </div>
        <div className="mp-paper-h">{tr("By category")}</div>
        {r.byCategory.length === 0 && <p className="dim small">{tr("No expenses this month.")}</p>}
        {r.byCategory.slice(0, 10).map((c) => (
          <div key={c.category} className="mp-prow">
            <span className="mp-pname">{c.name}</span>
            <span className="mp-pbar">
              <span style={{ width: `${(c.amount / max) * 100}%` }} />
            </span>
            <b>{money(c.amount)}</b>
          </div>
        ))}
        <div className="mp-paper-h">{tr("Last 6 months")}</div>
        <div className="mp-cols" role="img" aria-label={tr("Spending, last 6 months")}>
          {r.sixMonths.map((m) => (
            <div key={m.month} className="mp-col">
              <span className={`mp-colbar ${m.month === month ? 'cur' : ''}`} style={{ height: `${(m.spent / smax) * 100}%` }} title={money(m.spent)} />
              <span className="dim small">{m.label}</span>
            </div>
          ))}
        </div>
        <div className="mp-paper-h">{tr("Biggest expenses")}</div>
        {r.biggest.map((b, i) => (
          <div key={i} className="mp-prow">
            <span className="grow">
              {b.note} · {shortDay(b.date)}
            </span>
            <b>{money(b.amount)}</b>
          </div>
        ))}
        <p className="dim small" style={{ marginTop: 14 }}>
          {tr("Made on this device. Amounts and categories only — no passwords or account numbers.")}
        </p>
      </div>
    </Dialog>
  );
}
