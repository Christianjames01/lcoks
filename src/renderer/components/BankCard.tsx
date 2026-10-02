import { Copy, Eye, EyeOff, Nfc, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EntryView } from '../../shared/types';
import { api, errorMessage, unwrap } from '../lib/api';
import type { CardSpec } from '../lib/cardSpec';
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

/** Number of stacked layers that give the card its visible thickness. */
const EDGE_LAYERS = 9;

function groups(digits: string): string {
  // IDs like SSS 34-1234567-8 or passports keep their own formatting.
  if (/[^\d\s]/.test(digits)) return digits;
  const d = digits.replace(/\s+/g, '');
  if (/^3[47]\d{13}$/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 10)} ${d.slice(10)}`; // Amex 4-6-5
  return d.replace(/(.{4})/g, '$1 ').trim();
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 3D bank card for Banking and Cards items, in the bank's colours.
 *
 * Motion: a gentle idle float, tilt that follows your finger/mouse, and tilt
 * that follows the phone (gyroscope). Tilt values are written straight to CSS
 * variables (no React re-renders), so it stays smooth. Respects "reduce motion".
 *
 * The number shows only its last 4 digits until "Show number" (fetched on demand,
 * auto-hidden). Tapping the card flips it to the CVV side.
 */
export function BankCard({ entry, spec, revealSeconds }: { entry: EntryView; spec: CardSpec; revealSeconds: number }) {
  const { theme } = spec;
  const numberKey = spec.numberKey;
  const meta = numberKey ? entry.secrets[numberKey] : undefined;
  const holder = spec.holder.toUpperCase();
  const last4 = meta?.preview?.replace(/^[•\s]+/, '') ?? '';
  const hasCvv = Boolean(spec.backKey);
  const isCard = spec.kind === 'bank';

  const [number, setNumber] = useState<string | null>(null);
  const [cvv, setCvv] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const toast = useToast();
  const stageRef = useRef<HTMLDivElement>(null);
  const down = useRef<{ x: number; y: number } | null>(null);

  useTimeout(number !== null, revealSeconds * 1000, () => setNumber(null));
  useTimeout(cvv !== null, revealSeconds * 1000, () => setCvv(null));
  useEffect(
    () => () => {
      setNumber(null);
      setCvv(null);
    },
    []
  );

  // ---- motion: pointer tilt + gyroscope tilt, smoothed with requestAnimationFrame
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let target = { rx: 0, ry: 0 };
    const cur = { rx: 0, ry: 0 };
    let pointerActive = false;
    let base: { beta: number; gamma: number } | null = null;
    let raf = 0;

    const apply = () => {
      cur.rx += (target.rx - cur.rx) * 0.12;
      cur.ry += (target.ry - cur.ry) * 0.12;
      stage.style.setProperty('--rx', `${cur.rx.toFixed(2)}deg`);
      stage.style.setProperty('--ry', `${cur.ry.toFixed(2)}deg`);
      // Light reflection moves opposite to the tilt.
      stage.style.setProperty('--gx', `${(50 - cur.ry * 2.2).toFixed(1)}%`);
      stage.style.setProperty('--gy', `${(30 + cur.rx * 2.2).toFixed(1)}%`);
      raf = requestAnimationFrame(apply);
    };
    raf = requestAnimationFrame(apply);

    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      pointerActive = true;
      stage.classList.add('interacting');
      target = { rx: clamp(-y * 26, -16, 16), ry: clamp(x * 34, -20, 20) };
    };
    const onLeave = () => {
      pointerActive = false;
      stage.classList.remove('interacting');
      target = { rx: 0, ry: 0 };
    };
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (pointerActive || e.beta === null || e.gamma === null) return;
      if (!base) base = { beta: e.beta, gamma: e.gamma };
      // Slowly re-centre so the card returns to neutral wherever the phone is held.
      base.beta += (e.beta - base.beta) * 0.01;
      base.gamma += (e.gamma - base.gamma) * 0.01;
      target = { rx: clamp(-(e.beta - base.beta) * 0.6, -14, 14), ry: clamp((e.gamma - base.gamma) * 0.7, -18, 18) };
    };

    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);
    stage.addEventListener('pointercancel', onLeave);
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      cancelAnimationFrame(raf);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      stage.removeEventListener('pointercancel', onLeave);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, []);

  const reveal = async (key: string, set: (v: string | null) => void, current: string | null) => {
    if (current !== null) return set(null);
    try {
      set(await unwrap(api.vault.reveal(entry.id, key)));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const copy = async () => {
    if (!numberKey) return;
    try {
      const { seconds } = await unwrap(api.vault.copyField(entry.id, numberKey));
      toast(`Number copied. Clipboard clears in ${seconds}s.`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const maskedNumber = spec.mainText ?? (last4 ? (isCard ? `•••• •••• •••• ${last4}` : `•••• •••• ${last4}`) : meta?.set ? '•••• •••• ••••' : 'No number saved');
  const faceStyle = { background: theme.background, color: theme.color };
  const label = `${theme.label} ${spec.topRight} ${meta?.network ? NETWORK_LABEL[meta.network] : ''} card${last4 ? ` ending ${last4}` : ''}`;

  return (
    <div className="bank-card-block">
      <div
        ref={stageRef}
        className="card-stage"
        role="img"
        aria-label={label.replace(/\s+/g, ' ').trim()}
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onClick={(e) => {
          // A tap flips the card; a drag only tilts it.
          const d = down.current;
          if (hasCvv && (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8)) setFlipped((f) => !f);
        }}
        style={{ cursor: hasCvv ? 'pointer' : 'grab' }}
      >
        <div className="card-shadow" aria-hidden />
        <div className="card-float">
          <div className="bank-card">
            <div className={`card-flip ${flipped ? 'flipped' : ''}`}>
            {Array.from({ length: EDGE_LAYERS }, (_, i) => (
              <div
                key={i}
                className="card-edge"
                aria-hidden
                style={{ background: theme.background, transform: `translateZ(${((i - (EDGE_LAYERS - 1) / 2) * 0.95).toFixed(2)}px)` }}
              />
            ))}
            <div className="face front" style={faceStyle}>
              <div className="glare" aria-hidden />
              <div className="card-top">
                <span className="card-bank">{theme.label}</span>
                <span className="card-type">{spec.topRight}</span>
              </div>
              <div className="card-mid">
                <span className="chip" aria-hidden />
                <Nfc size={22} strokeWidth={1.6} aria-hidden style={{ opacity: 0.85 }} />
              </div>
              {spec.mainCaption && <span className="card-caption card-main-caption">{spec.mainCaption}</span>}
              <div className="card-number">{number !== null ? groups(number) : maskedNumber}</div>
              <div className="card-bottom">
                <div className="card-holder">
                  <span className="card-caption">{spec.holderCaption}</span>
                  <span>{holder || '—'}</span>
                </div>
                {spec.extra && (
                  <div className="card-expiry">
                    <span className="card-caption">{spec.extraCaption}</span>
                    <span>{spec.extra}</span>
                  </div>
                )}
                {spec.badge && <span className="card-badge">{spec.badge}</span>}
                {meta?.network && <span className={`card-network ${meta.network}`}>{NETWORK_LABEL[meta.network]}</span>}
              </div>
            </div>
            <div className="face back" style={faceStyle}>
              <div className="glare" aria-hidden />
              <div className="stripe" aria-hidden />
              {hasCvv ? (
                <>
                  <div className="sig-row">
                    <div className="signature" aria-hidden />
                    <div className="cvv-box">{cvv ?? '•••'}</div>
                  </div>
                  <div className="card-caption" style={{ marginTop: 10 }}>
                    CVV / CVC · tap the card to turn it back
                  </div>
                </>
              ) : (
                <div className="card-caption" style={{ margin: '18px 22px 0' }}>
                  {theme.label}
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card-actions">
        {meta?.set && (
          <>
            <button type="button" className="btn sm" onClick={() => void reveal(numberKey!, setNumber, number)} aria-pressed={number !== null}>
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
                void reveal(spec.backKey!, setCvv, cvv);
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
