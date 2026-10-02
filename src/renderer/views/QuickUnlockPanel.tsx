import { CircleAlert, Fingerprint } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { QuickUnlockStatus } from '../../shared/api';
import { api } from '../lib/api';

/** Fingerprint / PIN unlock shown on the lock screen when enabled (Android). */
export function QuickUnlockPanel({
  status,
  onUnlocked,
  onUsePassword,
  onStatusChanged
}: {
  status: QuickUnlockStatus;
  onUnlocked: () => void;
  onUsePassword: () => void;
  onStatusChanged: () => void;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoPrompted = useRef(false);
  const pinRef = useRef<HTMLInputElement>(null);

  const fingerprint = async () => {
    setBusy(true);
    setError(null);
    const r = await api.quick.unlockBiometric();
    if (r.ok) return onUnlocked();
    setBusy(false);
    if (r.code !== 'CANCELED') setError(r.message);
    if (r.code === 'INVALIDATED' || r.code === 'QUICK_STALE') onStatusChanged();
  };

  // Open the fingerprint prompt automatically once when the lock screen appears.
  useEffect(() => {
    if (status.biometric && !autoPrompted.current) {
      autoPrompted.current = true;
      void fingerprint();
    } else if (status.pin) {
      pinRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitPin = async (value: string) => {
    setBusy(true);
    setError(null);
    const r = await api.quick.unlockPin(value);
    if (r.ok) return onUnlocked();
    setBusy(false);
    setPin('');
    setError(r.message);
    if (r.code !== 'WRONG_PIN') onStatusChanged();
    requestAnimationFrame(() => pinRef.current?.focus());
  };

  return (
    <div className="stack" style={{ gap: 16, alignItems: 'stretch' }}>
      {status.biometric && (
        <button type="button" className="btn primary wide block" onClick={fingerprint} disabled={busy} style={{ height: 52 }}>
          <Fingerprint size={20} aria-hidden /> Unlock with fingerprint
        </button>
      )}
      {status.pin && (
        <div className="field" style={{ marginBottom: 0, alignItems: 'center' }}>
          <label htmlFor="quick-pin">{status.biometric ? 'Or enter your PIN' : 'Enter your PIN'}</label>
          <input
            ref={pinRef}
            id="quick-pin"
            className="input mono"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={4}
            disabled={busy}
            value={pin}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? 'quick-err' : undefined}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 4);
              setPin(v);
              if (v.length === 4) void submitPin(v);
            }}
            style={{ letterSpacing: '0.8em', fontSize: 26, textAlign: 'center', maxWidth: 220, height: 56, paddingLeft: '0.8em' }}
          />
        </div>
      )}
      {busy && (
        <div className="row-flex muted small" style={{ justifyContent: 'center' }}>
          <span className="spinner" aria-hidden /> Unlocking…
        </div>
      )}
      {error && (
        <div id="quick-err" className="error-text" role="alert" style={{ justifyContent: 'center', textAlign: 'center' }}>
          <CircleAlert size={14} aria-hidden /> {error}
        </div>
      )}
      <button type="button" className="linkish" style={{ alignSelf: 'center' }} onClick={onUsePassword}>
        Use master password instead
      </button>
    </div>
  );
}
