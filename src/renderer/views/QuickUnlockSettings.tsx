import { CircleAlert, Fingerprint, KeyRound } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { QuickUnlockStatus } from '../../shared/api';
import { Dialog } from '../components/Dialog';
import { PasswordInput } from '../components/PasswordInput';
import { useToast } from '../components/Toast';
import { ApiError, api, errorMessage, unwrap } from '../lib/api';

/** Settings rows for fingerprint and 4-digit PIN unlock (Android only). */
export function QuickUnlockSettings() {
  const [status, setStatus] = useState<QuickUnlockStatus | null>(null);
  const [enrolling, setEnrolling] = useState<'biometric' | 'pin' | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => setStatus(await api.quick.status()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!status?.supported) return null;

  const disable = async (kind: 'biometric' | 'pin') => {
    try {
      await unwrap(api.quick.disable(kind));
      toast(kind === 'biometric' ? 'Fingerprint unlock turned off.' : 'PIN unlock turned off.');
      await refresh();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <section className="setting-group" aria-label="Quick unlock">
      <span className="label">Quick unlock</span>
      <div className="card">
        <div className="setting">
          <Fingerprint size={20} aria-hidden />
          <div className="grow">
            <label htmlFor="q-bio" className="title" style={{ display: 'block' }}>
              Fingerprint unlock
            </label>
            <div className="desc">
              {status.biometricAvailable
                ? 'Your vault key is sealed in the phone’s secure hardware and released only by your fingerprint.'
                : 'Add a fingerprint in Android Settings → Security to use this.'}
            </div>
          </div>
          <input
            id="q-bio"
            type="checkbox"
            className="switch"
            checked={status.biometric}
            disabled={!status.biometricAvailable && !status.biometric}
            onChange={(e) => (e.target.checked ? setEnrolling('biometric') : void disable('biometric'))}
          />
        </div>
        <div className="setting">
          <KeyRound size={20} aria-hidden />
          <div className="grow">
            <label htmlFor="q-pin" className="title" style={{ display: 'block' }}>
              4-digit PIN unlock
            </label>
            <div className="desc">
              Works only on this phone. 5 wrong PINs turn it off and your master password is required.
              {status.pin && ` (${status.pinAttemptsLeft} attempts left)`}
            </div>
          </div>
          <input
            id="q-pin"
            type="checkbox"
            className="switch"
            checked={status.pin}
            onChange={(e) => (e.target.checked ? setEnrolling('pin') : void disable('pin'))}
          />
        </div>
        <div className="setting">
          <div className="grow desc">
            Changing your master password or restoring a backup turns quick unlock off. Your master password always works.
          </div>
        </div>
      </div>
      {enrolling && (
        <EnrollDialog
          kind={enrolling}
          onClose={() => setEnrolling(null)}
          onDone={async () => {
            setEnrolling(null);
            toast(enrolling === 'biometric' ? 'Fingerprint unlock is on.' : 'PIN unlock is on.');
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function EnrollDialog({ kind, onClose, onDone }: { kind: 'biometric' | 'pin'; onClose: () => void; onDone: () => Promise<void> }) {
  const [master, setMaster] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const errs: Record<string, string> = {};
    if (!master) errs.master = 'Enter your master password.';
    if (kind === 'pin') {
      if (!/^\d{4}$/.test(pin)) errs.pin = 'Enter exactly 4 digits.';
      else if (pin !== pin2) errs.pin2 = 'PINs do not match.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await unwrap(kind === 'biometric' ? api.quick.enableBiometric(master) : api.quick.enablePin(master, pin));
      setMaster('');
      setPin('');
      setPin2('');
      await onDone();
    } catch (err) {
      const f = err instanceof ApiError ? err.field : null;
      setErrors({ [f ?? 'form']: errorMessage(err) });
      setBusy(false);
    }
  };

  const err = (k: string) =>
    errors[k] && (
      <span className="error-text" role="alert">
        <CircleAlert size={14} aria-hidden /> {errors[k]}
      </span>
    );

  const pinInput = (id: string, value: string, set: (v: string) => void, label: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input mono"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        autoComplete="off"
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 4))}
        style={{ letterSpacing: '0.6em', fontSize: 22, textAlign: 'center', maxWidth: 200 }}
      />
      {err(id === 'q-pin1' ? 'pin' : 'pin2')}
    </div>
  );

  return (
    <Dialog
      title={kind === 'biometric' ? 'Turn on fingerprint unlock' : 'Set a 4-digit PIN'}
      onClose={onClose}
      busy={busy}
      size="narrow"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy}>
            {busy && <span className="spinner" aria-hidden />} {kind === 'biometric' ? 'Continue' : 'Set PIN'}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="q-master">Master password</label>
          <PasswordInput id="q-master" value={master} onChange={setMaster} mono={false} autoComplete="current-password" invalid={!!errors.master} />
          {err('master')}
        </div>
        {kind === 'pin' && (
          <>
            {pinInput('q-pin1', pin, setPin, 'New PIN')}
            {pinInput('q-pin2', pin2, setPin2, 'Repeat PIN')}
          </>
        )}
        {kind === 'biometric' && <p className="help-text">After this, Android will ask for your fingerprint to finish setup.</p>}
        {err('form')}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
