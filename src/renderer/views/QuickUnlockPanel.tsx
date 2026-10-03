import { CircleAlert, Fingerprint, KeyRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuickUnlockStatus } from '../../shared/api';
import { api } from '../lib/api';

/**
 * Fingerprint / PIN unlock shown on the lock screen when enabled (Android).
 *
 * The app locks itself (and reloads this screen) while it is in the background,
 * where Android refuses to show the fingerprint prompt. So the prompt is only
 * opened once the screen is actually visible, and the PIN box never waits on it.
 */
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
  const [bioBusy, setBioBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompted = useRef(false);
  const bioPending = useRef(false);
  const pinRef = useRef<HTMLInputElement>(null);

  const fingerprint = useCallback(async (mode: 'biometric' | 'credential' = 'biometric') => {
    if (bioPending.current) return;
    bioPending.current = true;
    setBioBusy(true);
    setError(null);
    const r = await api.quick.unlockBiometric(mode);
    bioPending.current = false;
    setBioBusy(false);
    if (r.ok) return onUnlocked();
    if (r.code === 'NOT_VISIBLE') {
      prompted.current = false; // try again when the app comes back to the front
      return;
    }
    if (r.code !== 'CANCELED') setError(r.message);
    if (r.code === 'INVALIDATED' || r.code === 'QUICK_STALE') onStatusChanged();
  }, [onUnlocked, onStatusChanged]);

  // Open the fingerprint prompt once, as soon as the lock screen is visible.
  useEffect(() => {
    const maybePrompt = () => {
      if (document.visibilityState !== 'visible') return;
      if (status.biometric && !prompted.current) {
        prompted.current = true;
        // Small delay lets Android finish bringing the app to the foreground.
        setTimeout(() => void fingerprint(), 300);
      } else if (status.pin && !status.biometric) {
        pinRef.current?.focus();
      }
    };
    maybePrompt();
    document.addEventListener('visibilitychange', maybePrompt);
    return () => document.removeEventListener('visibilitychange', maybePrompt);
  }, [status.biometric, status.pin, fingerprint]);

  const submitPin = async (value: string) => {
    setPinBusy(true);
    setError(null);
    const r = await api.quick.unlockPin(value);
    if (r.ok) return onUnlocked();
    setPinBusy(false);
    setPin('');
    setError(r.message);
    if (r.code !== 'WRONG_PIN') onStatusChanged();
    requestAnimationFrame(() => pinRef.current?.focus());
  };

  return (
    <div className="stack" style={{ gap: 16, alignItems: 'stretch' }}>
      {status.biometric && (
        <div className="quick-buttons">
          <button type="button" className="btn primary block" onClick={() => void fingerprint('biometric')} disabled={bioBusy}>
            <Fingerprint size={20} aria-hidden /> {bioBusy ? 'Waiting…' : 'Use Face / Fingerprint'}
          </button>
          {status.deviceCredential && (
            <button type="button" className="btn block" onClick={() => void fingerprint('credential')} disabled={bioBusy}>
              <KeyRound size={18} aria-hidden /> Use Device Passcode
            </button>
          )}
        </div>
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
            disabled={pinBusy}
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
      {pinBusy && (
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
