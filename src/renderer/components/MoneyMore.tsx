import { ArrowRight, ArrowRightLeft, Camera, Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MAX_AMOUNT, allMoneyCategories, balances, dayKey, formatMoney, moneyCategory, monthOf, parseDay, type Transaction } from '../../shared/money';
import { accountMoves, equalShares, type Transfer } from '../../shared/plans';
import { itemsMismatch, readReceipt, type ReceiptDetails } from '../../shared/receipt';
import { parseReceipt, type ReceiptResult } from '../../shared/scan';
import type { VaultSnapshot } from '../../shared/types';
import { api, errorMessage, unwrap } from '../lib/api';
import { MoneyIconFor } from '../views/Money';
import { ConfirmDialog, Dialog } from './Dialog';
import { takePhoto } from './ScanButton';
import { useToast } from './Toast';

function toMinor(text: string): number | null {
  const t = text.replace(/[^\d.]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [i, f = ''] = t.split('.');
  const v = Number(i) * 100 + Number(f.padEnd(2, '0') || 0);
  return v > 0 && v <= MAX_AMOUNT ? v : null;
}
const fromMinor = (v: number) => (v ? (v % 100 === 0 ? String(v / 100) : (v / 100).toFixed(2)) : '');
const shortDay = (d: string) => parseDay(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// -------------------------------------------------------- receipt scan --

/** Photograph a receipt and read it on the phone; null when cancelled or unreadable (a message was shown). */
export function useReceiptScan(snap: VaultSnapshot) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const scan = async (): Promise<(ReceiptResult & { details?: ReceiptDetails }) | null> => {
    if (busy) return null;
    setBusy(true);
    try {
      const photo = await takePhoto('camera');
      if (!photo) return null;
      const lines = await unwrap(api.app.recognizeText(photo.jpeg));
      const r = parseReceipt(lines, snap.accounts);
      const d = readReceipt(lines);
      const details = d.items.length || d.total ? d : undefined;
      if (r.amount === null && details?.total) r.amount = details.total;
      if (!r.store && details?.store) r.store = details.store;
      if (details && !details.total && r.amount) details.total = r.amount;
      if (r.amount === null && !r.store) {
        toast('No total found. Try again with the whole receipt flat, in good light.', 'error');
        return null;
      }
      api.app.haptic('success');
      return { ...r, ...(details ? { details } : {}) };
    } catch (e) {
      toast(errorMessage(e), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { scan, busy };
}

/** What the receipt said: every item with quantity, price and amount, then VAT, total, cash and change. */
export function ReceiptCard({ r, currency, onRemove }: { r: ReceiptDetails; currency: string; onRemove?: () => void }) {
  const m = (v: number) => formatMoney(v, currency);
  const rows: [string, number, string?][] = [
    ['Subtotal', r.subtotal],
    ['Discount', r.discount ? -r.discount : 0],
    ['Service charge', r.serviceCharge],
    ['VATable sales', r.vatable],
    ['VAT (12%)', r.vat],
    ['VAT-exempt', r.vatExempt]
  ];
  return (
    <section className="receipt-card" aria-label="Receipt">
      <header className="receipt-head">
        <div>
          <strong>{r.store || 'Receipt'}</strong>
          {(r.branch || r.number) && <span className="dim">{[r.branch, r.number && `No. ${r.number}`].filter(Boolean).join(' · ')}</span>}
        </div>
        {onRemove && (
          <button type="button" className="icon-btn sm" onClick={onRemove} aria-label="Remove receipt details">
            <X size={15} aria-hidden />
          </button>
        )}
      </header>
      {r.items.length > 0 && (
        <table className="receipt-items">
          <thead>
            <tr>
              <th scope="col">Qty</th>
              <th scope="col">Item</th>
              <th scope="col">Price</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((it, i) => (
              <tr key={i}>
                <td>{it.qty}</td>
                <td>{it.name}</td>
                <td>{m(it.price)}</td>
                <td>{m(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <dl className="receipt-sums">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{m(v)}</dd>
          </div>
        ))}
        <div className="receipt-total">
          <dt>Total</dt>
          <dd>{m(r.total)}</dd>
        </div>
        {r.payment && (
          <div>
            <dt>Paid with</dt>
            <dd>{r.payment}{r.cash ? ` · ${m(r.cash)}` : ''}</dd>
          </div>
        )}
        {r.change > 0 && (
          <div>
            <dt>Change</dt>
            <dd>{m(r.change)}</dd>
          </div>
        )}
      </dl>
      {itemsMismatch(r) && <div className="notice">Some items may be missing or misread — the items don't add up to the subtotal.</div>}
    </section>
  );
}

export function ReceiptButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn primary block receipt-btn" onClick={onClick} disabled={busy}>
      {busy ? <span className="spinner" aria-hidden /> : <Camera size={16} aria-hidden />} {busy ? 'Reading the receipt…' : 'Scan a receipt'}
    </button>
  );
}

// ------------------------------------------------------------ transfer --

export function TransferEditor({ snap, initial, onClose, onChanged }: { snap: VaultSnapshot; initial?: Transfer; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const money = (v: number) => formatMoney(v, snap.settings.currency);
  const accs = snap.accounts;
  const [from, setFrom] = useState(initial?.from ?? accs[0]?.id ?? '');
  const [to, setTo] = useState(initial?.to ?? accs.find((a) => a.id !== (initial?.from ?? accs[0]?.id))?.id ?? '');
  const [amount, setAmount] = useState(fromMinor(initial?.amount ?? 0));
  const feeTx = initial?.feeTxId ? snap.transactions.find((t) => t.id === initial.feeTxId) : undefined;
  const [fee, setFee] = useState(fromMinor(feeTx?.amount ?? 0));
  const [note, setNote] = useState(initial?.note ?? '');
  const [date, setDate] = useState(initial?.date ?? dayKey(new Date()));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bal = useBalances(snap);
  const minor = toMinor(amount) ?? 0;
  const feeMinor = fee.trim() ? toMinor(fee) : 0;
  // Editing: the old transfer is already in the balances; show the change from without it.
  const base = (id: string) => (bal.get(id) ?? 0) - (initial ? (initial.to === id ? initial.amount : 0) - (initial.from === id ? initial.amount + (feeTx?.amount ?? 0) : 0) : 0);
  const name = (id: string) => accs.find((a) => a.id === id)?.name ?? '';
  const save = async () => {
    if (!minor) return toast('Enter an amount.', 'error');
    if (feeMinor === null) return toast('Enter the fee, or leave it empty.', 'error');
    setBusy(true);
    try {
      await unwrap(api.plans.saveTransfer({ ...(initial ? { id: initial.id } : {}), from, to, amount: minor, fee: feeMinor, note, date }));
      api.app.haptic('success');
      await onChanged();
      toast(`${money(minor)} moved: ${name(from)} → ${name(to)}.`);
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  const pick = (value: string, set: (id: string) => void, other: string, label: string) => (
    <div className="mp-chips" role="radiogroup" aria-label={label}>
      {accs.map((a) => (
        <button key={a.id} type="button" role="radio" aria-checked={value === a.id} disabled={a.id === other} className="vl-pill mp-pick" onClick={() => set(a.id)}>
          {a.name}
        </button>
      ))}
    </div>
  );
  return (
    <Dialog
      placement="center"
      size="narrow"
      title={initial ? 'Edit transfer' : 'Transfer'}
      subtitle="Move money between your accounts"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {initial && (
            <button type="button" className="btn danger left" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || !from || !to || from === to}>
            {minor ? `Move ${money(minor)}` : 'Move'}
          </button>
        </>
      }
    >
      {accs.length < 2 ? (
        <p className="dim">Add a second account (Expenses → Wallets) to move money between them.</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="tr-amount">Amount</label>
            <input id="tr-amount" className="input mp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoComplete="off" data-autofocus />
          </div>
          <div className="tr-pair">
            <div className="tr-side">
              <span className="label">From</span>
              <b>{name(from)}</b>
              <span className="dim small">
                {money(base(from))} → {money(base(from) - minor - (feeMinor ?? 0))}
              </span>
            </div>
            <span className="tr-arrow" aria-hidden>
              <ArrowRight size={16} />
            </span>
            <div className="tr-side">
              <span className="label">To</span>
              <b>{name(to)}</b>
              <span className="dim small">
                {money(base(to))} → {money(base(to) + minor)}
              </span>
            </div>
          </div>
          <div className="field">
            <span className="label">From</span>
            {pick(from, setFrom, to, 'From')}
          </div>
          <div className="field">
            <span className="label">To</span>
            {pick(to, setTo, from, 'To')}
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="tr-fee">Fee (optional)</label>
              <input id="tr-fee" className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="₱15" autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="tr-date">Date</label>
              <input id="tr-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="tr-note">Note (optional)</label>
            <input id="tr-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Savings" maxLength={120} autoComplete="off" />
            <span className="help-text">Not spending or income — only the two balances change. A fee counts as an expense.</span>
          </div>
        </>
      )}
      {confirmDelete && initial && (
        <ConfirmDialog
          placement="center"
          title="Delete this transfer?"
          danger
          confirmLabel="Delete"
          message="Both balances go back, and its fee record (if any) is removed."
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              await unwrap(api.plans.deleteTransfer(initial.id));
              await onChanged();
              toast('Transfer deleted.');
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

/** Account balances including goals, transfers and money lent. */
export function useBalances(snap: VaultSnapshot) {
  return useMemo(() => balances(snap.accounts, snap.transactions, accountMoves(snap)), [snap]);
}

/** A transfer in the day list. */
export function TransferRow({ t, snap, onOpen }: { t: Transfer; snap: VaultSnapshot; onOpen: () => void }) {
  const name = (id: string) => snap.accounts.find((a) => a.id === id)?.name ?? 'Account';
  return (
    <button type="button" className="tx-row tr-row" onClick={onOpen}>
      <span className="tx-icon">
        <ArrowRightLeft size={16} aria-hidden />
      </span>
      <span className="row-main">
        <span className="row-title" style={{ display: 'block' }}>
          {name(t.from)} → {name(t.to)}
        </span>
        <span className="row-sub" style={{ display: 'block' }}>
          Transfer{t.note ? ` · ${t.note}` : ''}
        </span>
      </span>
      <span className="tx-amount dim">{formatMoney(t.amount, snap.settings.currency)}</span>
    </button>
  );
}

// ---------------------------------------------------------- split bill --

export function SplitBill({
  snap,
  initial,
  onClose,
  onChanged
}: {
  snap: VaultSnapshot;
  initial?: { total?: number; note?: string; category?: string; accountId?: string; date?: string };
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const money = (v: number) => formatMoney(v, snap.settings.currency);
  const [total, setTotal] = useState(fromMinor(initial?.total ?? 0));
  const [note, setNote] = useState(initial?.note ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'food');
  const [account, setAccount] = useState(initial?.accountId ?? snap.accounts[0]?.id ?? '');
  const [mode, setMode] = useState<'equal' | 'amount'>('equal');
  const [people, setPeople] = useState<{ person: string; amount: string }[]>([{ person: '', amount: '' }]);
  const [mineText, setMineText] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => [...new Set(snap.debts.map((d) => d.person))].slice(0, 10), [snap.debts]);
  const totalMinor = toMinor(total) ?? 0;
  const named = people.filter((p) => p.person.trim());
  const shares = mode === 'equal' ? equalShares(totalMinor, named.length + 1) : [];
  const mine = mode === 'equal' ? (shares[0] ?? 0) : (toMinor(mineText) ?? 0);
  const theirs = named.map((p, i) => (mode === 'equal' ? (shares[i + 1] ?? 0) : (toMinor(p.amount) ?? 0)));
  const sum = mine + theirs.reduce((a, b) => a + b, 0);
  const ok = totalMinor > 0 && named.length > 0 && sum === totalMinor && theirs.every((v) => v > 0);
  const cats = allMoneyCategories().filter((c) => c.kind === 'expense');

  const save = async () => {
    if (!ok) return toast(sum !== totalMinor ? `The shares add up to ${money(sum)}, not ${money(totalMinor)}.` : 'Add the people you split with.', 'error');
    setBusy(true);
    try {
      await unwrap(
        api.plans.splitBill({
          total: totalMinor,
          note,
          date: initial?.date ?? dayKey(new Date()),
          category,
          ...(account ? { accountId: account } : {}),
          mine,
          people: named.map((p, i) => ({ person: p.person.trim(), amount: theirs[i]! })),
          due
        })
      );
      api.app.haptic('success');
      await onChanged();
      toast(`Split ${money(totalMinor)}: your ${money(mine)} in Expenses, ${money(totalMinor - mine)} in Utang.`);
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  const setPerson = (i: number, patch: Partial<{ person: string; amount: string }>) => setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <Dialog
      placement="center"
      size="narrow"
      title="Split a bill"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || !ok}>
            {totalMinor ? `Split ${money(totalMinor)}` : 'Split'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="sp-total">Total</label>
        <input id="sp-total" className="input mp-amount" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="1,800" autoComplete="off" data-autofocus={!initial?.total || undefined} />
      </div>
      <div className="field">
        <label htmlFor="sp-note">What for</label>
        <input id="sp-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Dinner at Vikings" maxLength={120} autoComplete="off" />
      </div>
      <div className="segmented mp-seg" role="group" aria-label="How to split">
        <button type="button" aria-pressed={mode === 'equal'} onClick={() => setMode('equal')}>
          Split equally
        </button>
        <button type="button" aria-pressed={mode === 'amount'} onClick={() => setMode('amount')}>
          By amount
        </button>
      </div>
      <div className="label">
        {named.length + 1} people{mode === 'equal' && totalMinor ? ` · ${money(shares[1] ?? shares[0] ?? 0)} each` : ''}
      </div>
      <ul className="sp-people">
        <li>
          <span className="mp-av me">Me</span>
          <span className="grow">
            <b>You</b>
            <span className="dim small">paid the whole bill</span>
          </span>
          {mode === 'equal' ? <b>{money(mine)}</b> : <input className="input sp-amt" inputMode="decimal" value={mineText} onChange={(e) => setMineText(e.target.value)} placeholder="0" aria-label="Your share" />}
        </li>
        {people.map((p, i) => (
          <li key={i}>
            <span className="mp-av">{(p.person.trim().charAt(0) || '?').toUpperCase()}</span>
            <input className="input grow" value={p.person} onChange={(e) => setPerson(i, { person: e.target.value })} placeholder="Name" maxLength={60} aria-label="Person" list="sp-known" />
            {mode === 'equal' ? (
              <b className="pos">{p.person.trim() ? money(theirs[named.indexOf(p)] ?? 0) : ''}</b>
            ) : (
              <input className="input sp-amt" inputMode="decimal" value={p.amount} onChange={(e) => setPerson(i, { amount: e.target.value })} placeholder="0" aria-label={`${p.person || 'Their'} share`} />
            )}
            {people.length > 1 && (
              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))}>
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <datalist id="sp-known">
        {known.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <button type="button" className="btn block" onClick={() => setPeople((ps) => [...ps, { person: '', amount: '' }])} style={{ marginBottom: 12 }}>
        <Plus size={15} aria-hidden /> Add person
      </button>
      {mode === 'amount' && totalMinor > 0 && sum !== totalMinor && <p className="error-text">Shares add up to {money(sum)} — {sum < totalMinor ? `${money(totalMinor - sum)} short` : `${money(sum - totalMinor)} too much`}.</p>}
      <div className="field">
        <span className="label">Your share counts as</span>
        <div className="mp-chips">
          {cats.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={category === c.id} className="vl-pill mp-pick" onClick={() => setCategory(c.id)}>
              <MoneyIconFor category={c.id} size={13} /> {c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">Paid from</span>
        <div className="mp-chips">
          {snap.accounts.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={account === a.id} className="vl-pill mp-pick" onClick={() => setAccount(a.id)}>
              {a.name}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={account === ''} className="vl-pill mp-pick" onClick={() => setAccount('')}>
            No account
          </button>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 6 }}>
        <label htmlFor="sp-due">Remind me to collect on (optional)</label>
        <input id="sp-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      {ok && (
        <p className="dim small sp-summary">
          {account ? `${money(totalMinor)} out of ${snap.accounts.find((a) => a.id === account)?.name}` : `${money(totalMinor)} total`} · your {money(mine)} counts as {moneyCategory(category).name} · {money(totalMinor - mine)} goes to Utang.
        </p>
      )}
    </Dialog>
  );
}

// -------------------------------------------------------------- search --

type Range = 'all' | 'month' | '3m' | 'year';

export function ExpenseSearch({ snap, onClose, onOpenTx }: { snap: VaultSnapshot; onClose: () => void; onOpenTx: (t: Transaction) => void }) {
  const money = (v: number) => formatMoney(v, snap.settings.currency);
  const [q, setQ] = useState('');
  const [range, setRange] = useState<Range>('all');
  const [category, setCategory] = useState('');
  const [account, setAccount] = useState('');
  const [kind, setKind] = useState<'' | 'expense' | 'income'>('');
  const [filters, setFilters] = useState(false);
  const [shown, setShown] = useState(60);
  const today = dayKey(new Date());
  const from = range === 'month' ? `${monthOf(today)}-01` : range === '3m' ? dayKey(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1)) : range === 'year' ? `${today.slice(0, 4)}-01-01` : '';
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const accName = (id?: string) => snap.accounts.find((a) => a.id === id)?.name ?? '';
  const results = useMemo(
    () =>
      snap.transactions
        .filter((t) => {
          if (from && t.date < from) return false;
          if (category && t.category !== category) return false;
          if (account && t.accountId !== account) return false;
          if (kind && t.kind !== kind) return false;
          if (!words.length) return true;
          const hay = `${t.note} ${moneyCategory(t.category).name} ${accName(t.accountId)} ${(t.amount / 100).toFixed(2)} ${t.amount / 100}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
        .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap.transactions, q, from, category, account, kind]
  );
  const spent = results.filter((t) => t.kind === 'expense').reduce((a, t) => a + t.amount, 0);
  const got = results.filter((t) => t.kind === 'income').reduce((a, t) => a + t.amount, 0);
  const groups: [string, Transaction[]][] = [];
  for (const t of results.slice(0, shown)) {
    const m = monthOf(t.date);
    const g = groups[groups.length - 1];
    if (g && g[0] === m) g[1].push(t);
    else groups.push([m, [t]]);
  }
  const searching = words.length > 0 || category || account || kind || range !== 'all';
  const cats = allMoneyCategories();
  return (
    <Dialog placement="center" size="wide" title="Search expenses" onClose={onClose}>
      <div className="evc-search-box sx-box" role="search">
        <Search size={16} aria-hidden />
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes, categories, accounts, amounts…" aria-label="Search records" autoComplete="off" data-autofocus />
      </div>
      <div className="mp-chips sx-chips">
        {(
          [
            ['all', 'All time'],
            ['month', 'This month'],
            ['3m', 'Last 3 months'],
            ['year', 'This year']
          ] as [Range, string][]
        ).map(([r, l]) => (
          <button key={r} type="button" className="vl-pill mp-pick" role="radio" aria-checked={range === r} onClick={() => setRange(r)}>
            {l}
          </button>
        ))}
        <button type="button" className="vl-pill" onClick={() => setFilters((v) => !v)} aria-expanded={filters}>
          {filters ? 'Hide filters' : '+ Filter'}
        </button>
      </div>
      {(category || account || kind) && (
        <div className="mp-chips sx-chips">
          {kind && (
            <button type="button" className="vl-pill mp-pick" aria-checked role="radio" onClick={() => setKind('')}>
              {kind === 'expense' ? 'Expenses' : 'Money in'} <X size={12} aria-hidden />
            </button>
          )}
          {category && (
            <button type="button" className="vl-pill mp-pick" aria-checked role="radio" onClick={() => setCategory('')}>
              <MoneyIconFor category={category} size={12} /> {moneyCategory(category).name} <X size={12} aria-hidden />
            </button>
          )}
          {account && (
            <button type="button" className="vl-pill mp-pick" aria-checked role="radio" onClick={() => setAccount('')}>
              {accName(account)} <X size={12} aria-hidden />
            </button>
          )}
        </div>
      )}
      {filters && (
        <div className="sx-filters">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as '' | 'expense' | 'income')} aria-label="Type">
            <option value="">Expenses and money in</option>
            <option value="expense">Expenses only</option>
            <option value="income">Money in only</option>
          </select>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="select" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
            <option value="">All accounts</option>
            {snap.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {searching && (
        <div className="mp-card sx-sum">
          <span className="grow">
            <span className="label">
              {results.length} record{results.length === 1 ? '' : 's'}
            </span>
            <span className="mp-big">{money(spent || got)}</span>
          </span>
          {results.length > 0 && spent > 0 && (
            <span className="dim small" style={{ textAlign: 'right' }}>
              avg {money(Math.round(spent / Math.max(1, results.filter((t) => t.kind === 'expense').length) / 100) * 100)}
              <br />
              since {parseDay(results[results.length - 1]!.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>
      )}
      {!searching ? (
        <p className="dim small" style={{ margin: '14px 2px' }}>Type a word like “jollibee”, a category or an amount, or pick filters. Searches every month.</p>
      ) : results.length === 0 ? (
        <p className="dim small" style={{ margin: '14px 2px' }}>Nothing found.</p>
      ) : (
        <>
          {groups.map(([m, items]) => (
            <div key={m} className="cd-group">
              <div className="cd-group-head">
                <span>{parseDay(`${m}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
              </div>
              <ul className="cd-list">
                {items.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="cd-row" onClick={() => onOpenTx(t)}>
                      <span className="mp-ico">
                        <MoneyIconFor category={t.category} size={15} />
                      </span>
                      <span className="grow">
                        <span className="cd-row-note">{t.note || moneyCategory(t.category).name}</span>
                        <span className="dim small">
                          {shortDay(t.date)}
                          {t.accountId ? ` · ${accName(t.accountId)}` : ''} · {moneyCategory(t.category).name}
                        </span>
                      </span>
                      <strong className={`cd-row-amt ${t.kind === 'income' ? 'pos' : ''}`}>
                        {t.kind === 'income' ? '+' : '−'}
                        {money(t.amount)}
                      </strong>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {results.length > shown && (
            <button type="button" className="btn block" onClick={() => setShown((v) => v + 60)}>
              Show more ({results.length - shown})
            </button>
          )}
        </>
      )}
    </Dialog>
  );
}

