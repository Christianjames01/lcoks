import { Copy, Eye, EyeOff, Nfc, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cardTheme } from '../../shared/cards';
import type { EntryView } from '../../shared/types';
import { api, errorMessage, unwrap } from '../lib/api';
import { useTimeout } from '../lib/hooks';
import { useToast } from './Toast';

const NETWORK_LABEL: Record<string, string> = {
  visa: 'VISA',
  mastercard: 'Mastercard',
  amex: 'AMEX',
  jcb: 'JCB',
  discover: 'DISCOVER',
  unionpay: 'UnionPay'
};

function groups(digits: string): string {
  const d = digits.replace(/\s+/g, '');
  if (/^3[47]\d{13}$/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 10)} ${d.slice(10)}`; // Amex 4-6-5
  return d.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Bank-card visual for Banking and Cards items, in the bank's colours.
 * The number shows only its last 4 digits until the user taps "Show" (fetched on
 * demand and auto-hidden). Tapping the card flips it to the CVV side.
 */
export function BankCard({ entry, revealSeconds }: { entry: EntryView; revealSeconds: number }) {
  const isCard = entry.categoryId === 'cards';
  const numberKey = isCard ? 'cardNumber' : 'accountNumber';
  const meta = entry.secrets[numberKey];
  const theme = cardTheme(entry.fields.bankName, entry.title);
  const holder = (entry.fields.cardholder ?? entry.fields.accountName ?? '').toUpperCase();
  const last4 = meta?.preview?.replace(/\D/g, '').slice(-4) ?? '';
  const hasCvv = isCard && entry.secrets.cvv?.set;

  const [number, setNumber] = useState<string | null>(null);
  const [cvv, setCvv] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const toast = useToast();

  useTimeout(number !== null, revealSeconds * 1000, () => setNumber(null));
  useTimeout(cvv !== null, revealSeconds * 1000, () => setCvv(null));
  useEffect(
    () => () => {
      setNumber(null);
      setCvv(null);
    },
    []
  );

  const reveal = async (key: string, set: (v: string | null) => void, current: string | null) => {
    if (current !== null) return set(null);
    try {
      set(await unwrap(api.vault.reveal(entry.id, key)));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const copy = async () => {
    try {
      const { seconds } = await unwrap(api.vault.copyField(entry.id, numberKey));
      toast(`${isCard ? 'Card' : 'Account'} number copied. Clipboard clears in ${seconds}s.`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const maskedNumber = last4 ? `•••• •••• •••• ${last4}` : meta?.set ? '•••• •••• •••• ••••' : isCard ? 'No card number' : 'No account number';
  const faceStyle = { background: theme.background, color: theme.color };
  const label = `${theme.label} ${meta?.network ? NETWORK_LABEL[meta.network] : ''} ${isCard ? 'card' : 'account'}${last4 ? ` ending ${last4}` : ''}`;

  return (
    <div className="bank-card-block">
      <div
        className={`bank-card ${flipped ? 'flipped' : ''}`}
        role="img"
        aria-label={label.replace(/\s+/g, ' ').trim()}
        onClick={() => hasCvv && setFlipped((f) => !f)}
        style={{ cursor: hasCvv ? 'pointer' : 'default' }}
      >
        <div className="face front" style={faceStyle}>
          <div className="card-top">
            <span className="card-bank">{theme.label}</span>
            <span className="card-type">{entry.fields.cardType ?? ''}</span>
          </div>
          <div className="card-mid">
            <span className="chip" aria-hidden />
            <Nfc size={22} strokeWidth={1.6} aria-hidden style={{ opacity: 0.85 }} />
          </div>
          <div className="card-number selectable">{number !== null ? groups(number) : maskedNumber}</div>
          <div className="card-bottom">
            <div className="card-holder">
              <span className="card-caption">{isCard ? 'Cardholder' : 'Account name'}</span>
              <span>{holder || '—'}</span>
            </div>
            {entry.fields.expiry && (
              <div className="card-expiry">
                <span className="card-caption">Valid thru</span>
                <span>{entry.fields.expiry}</span>
              </div>
            )}
            {meta?.network && <span className={`card-network ${meta.network}`}>{NETWORK_LABEL[meta.network]}</span>}
          </div>
        </div>
        {hasCvv && (
          <div className="face back" style={faceStyle}>
            <div className="stripe" aria-hidden />
            <div className="sig-row">
              <div className="signature" aria-hidden />
              <div className="cvv-box">{cvv ?? '•••'}</div>
            </div>
            <div className="card-caption" style={{ marginTop: 10 }}>
              CVV / CVC · tap the card to turn it back
            </div>
          </div>
        )}
      </div>

      <div className="card-actions">
        {meta?.set && (
          <>
            <button type="button" className="btn sm" onClick={() => void reveal(numberKey, setNumber, number)} aria-pressed={number !== null}>
              {number !== null ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} {number !== null ? 'Hide number' : 'Show number'}
            </button>
            <button type="button" className="btn sm" onClick={copy}>
              <Copy size={14} aria-hidden /> Copy
            </button>
          </>
        )}
        {hasCvv && (
          <>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setFlipped(true);
                void reveal('cvv', setCvv, cvv);
              }}
              aria-pressed={cvv !== null}
            >
              {cvv !== null ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} {cvv !== null ? 'Hide CVV' : 'Show CVV'}
            </button>
            <button type="button" className="btn sm ghost" onClick={() => setFlipped((f) => !f)} aria-label="Flip card">
              <RotateCw size={14} aria-hidden /> Flip
            </button>
          </>
        )}
      </div>
    </div>
  );
}
