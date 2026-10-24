import { Clock, Gift, Minus, ShoppingBag } from 'lucide-react';
import { useMemo, useState } from 'react';
import { usualCoffee } from '../../shared/coffee';
import { GIFT_CATEGORY, amountText, daysToExpiry, giftExpenseCategory, parseAmountText, parseHistory } from '../../shared/giftcards';
import { dayKey, formatMoney, moneyCategory } from '../../shared/money';
import type { EntryView, VaultSnapshot } from '../../shared/types';
import { api, errorMessage, unwrap } from '../lib/api';
import { MoneyIconFor } from '../views/Money';
import { Dialog } from './Dialog';
import { useToast } from './Toast';

const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Gift card item: "Use balance", expiry warning and the use history. */
export function GiftCardPanel({ entry, snap, onChanged }: { entry: EntryView; snap: VaultSnapshot; onChanged: () => Promise<void> }) {
  const [using, setUsing] = useState(false);
  if (entry.categoryId !== GIFT_CATEGORY) return null;
  const currency = snap.settings.currency;
  const balance = parseAmountText(entry.fields.balance);
  const days = daysToExpiry(entry.fields.expiryDate);
  const history = parseHistory(entry.fields.history);
  return (
    <section className="gift-panel" aria-label="Gift card balance">
      <div className="gift-actions">
        <button type="button" className="btn primary" onClick={() => setUsing(true)} disabled={!balance}>
          <Minus size={16} aria-hidden /> Use balance
        </button>
        {days !== null && days <= 30 && (
          <span className={`vl-pill ${days < 0 ? 'danger' : 'warn'}`}>
            <Clock size={13} aria-hidden /> {days < 0 ? 'Expired' : days === 0 ? 'Expires today' : `${days} day${days === 1 ? '' : 's'} left`}
          </span>
        )}
      </div>
      {balance === null && <p className="dim small">Add the balance left (Edit) to keep track as you use the card.</p>}
      {history.length > 0 && (
        <>
          <div className="label" style={{ margin: '14px 0 4px' }}>
            History
          </div>
          <ul className="gift-history">
            {history.slice(0, 12).map((h, i) => (
              <li key={i}>
                <span className="gift-h-icon" aria-hidden>
                  {h.amount > 0 ? <MoneyIconFor category={giftExpenseCategory(entry.fields.brand ?? '', entry.title)} size={15} /> : <Gift size={15} />}
                </span>
                <span className="grow">
                  <span className="gift-h-note">{h.note || 'Used'}</span>
                  {h.date && <span className="dim small">{shortDay(h.date)}</span>}
                </span>
                {h.amount > 0 && <strong className="gift-h-amt">−{formatMoney(h.amount, currency)}</strong>}
              </li>
            ))}
          </ul>
        </>
      )}
      {using && balance !== null && (
        <UseGiftCard entry={entry} snap={snap} balance={balance} onClose={() => setUsing(false)} onChanged={onChanged} />
      )}
    </section>
  );
}

function UseGiftCard({ entry, snap, balance, onClose, onChanged }: { entry: EntryView; snap: VaultSnapshot; balance: number; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const currency = snap.settings.currency;
  const money = (v: number) => formatMoney(v, currency);
  const category = giftExpenseCategory(entry.fields.brand ?? '', entry.title);
  const usual = useMemo(() => usualCoffee(snap.transactions), [snap.transactions]);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [toExpenses, setToExpenses] = useState(true);
  const [busy, setBusy] = useState(false);
  const amount = parseAmountText(text);
  const valid = amount !== null && amount > 0 && amount <= balance;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const r = await unwrap(api.vault.useGiftCard(entry.id, { amount: amount!, note: note.trim(), date: dayKey(new Date()), ...(toExpenses ? { expense: { category } } : {}) }));
      api.app.haptic('success');
      await onChanged();
      toast(`${money(amount!)} used · ${money(r.balance)} left${r.transaction ? ' · added to Expenses' : ''}.`);
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };

  const chips: [string, number][] = [
    ...(category === 'coffee' && usual.amount <= balance ? ([[`${money(usual.amount)} usual coffee`, usual.amount]] as [string, number][]) : []),
    ['Whole balance', balance]
  ];
  return (
    <Dialog
      placement="center"
      size="narrow"
      title={`Use ${entry.title}`}
      subtitle={`${money(balance)} left on the card`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={!valid || busy}>
            {busy && <span className="spinner" aria-hidden />}
            {valid ? `Use ${money(amount!)}` : 'Use'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="gc-amount">Amount</label>
        <input
          id="gc-amount"
          className="input gift-amount"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="0"
          autoComplete="off"
          data-autofocus
          aria-invalid={text.trim() !== '' && !valid ? true : undefined}
        />
        {text.trim() !== '' && amount !== null && amount > balance && <span className="error-text">That is more than the {money(balance)} left.</span>}
        <div className="gift-chips">
          {chips.map(([label, v]) => (
            <button key={label} type="button" className="vl-pill" onClick={() => setText(amountText(v))}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="gc-note">What for (optional)</label>
        <input id="gc-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={category === 'coffee' ? 'Caramel macchiato' : 'e.g. shoes'} maxLength={120} autoComplete="off" />
      </div>
      <label className="gift-toggle">
        <span className="gift-h-icon" aria-hidden>
          {category === 'shopping' ? <ShoppingBag size={15} /> : <MoneyIconFor category={category} size={15} />}
        </span>
        <span className="grow">
          <span style={{ display: 'block', fontWeight: 600 }}>Also add to Expenses</span>
          <span className="dim small">
            As {moneyCategory(category).name}
            {category === 'coffee' ? ' · counts toward your coffee budget' : ''}
          </span>
        </span>
        <input type="checkbox" className="switch" checked={toExpenses} onChange={(e) => setToExpenses(e.target.checked)} />
      </label>
      {valid && (
        <p className="dim small" style={{ marginTop: 10 }}>
          After this: <strong style={{ color: 'var(--fg)' }}>{money(balance - amount!)} left</strong>
        </p>
      )}
    </Dialog>
  );
}
