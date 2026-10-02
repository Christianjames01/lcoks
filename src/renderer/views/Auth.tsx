import { ArrowLeft, CircleAlert, FolderOpen, Info, Lock, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { QuickUnlockStatus } from '../../shared/api';
import { estimateStrength } from '../../shared/strength';
import { Dialog } from '../components/Dialog';
import { PasswordInput } from '../components/PasswordInput';
import { ApiError, api, errorMessage, unwrap } from '../lib/api';
import { QuickUnlockPanel } from './QuickUnlockPanel';

function Logo() {
  return (
    <div className="auth-logo" aria-hidden>
      <Lock size={28} strokeWidth={1.6} />
    </div>
  );
}

// ------------------------------------------------------------------ welcome --

export function Welcome({ onCreate, onRestored }: { onCreate: () => void; onRestored: () => void }) {
  const [restoring, setRestoring] = useState(false);
  return (
    <main className="auth">
      <div className="auth-card">
        <Logo />
        <h1 className="auth-title">WELCOME TO VAULT</h1>
        <p className="auth-sub">
          A private password manager that
          <br />
          stores your data locally.
        </p>
        <button type="button" className="btn primary wide block" onClick={onCreate} autoFocus>
          Create new vault
        </button>
        <button type="button" className="btn block" style={{ marginTop: 10 }} onClick={() => setRestoring(true)}>
          <FolderOpen size={15} aria-hidden /> Restore from encrypted backup
        </button>
        <div className="auth-note">
          Works fully offline. No account, no cloud, no tracking.
          <br />
          Everything is encrypted with Argon2id + AES-256-GCM.
        </div>
      </div>
      {restoring && <RestoreLockedDialog vaultExists={false} onClose={() => setRestoring(false)} onRestored={onRestored} />}
    </main>
  );
}

// -------------------------------------------------------------------- setup --

export function Setup({ onBack, onCreated }: { onBack: () => void; onCreated: () => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [hint, setHint] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const strength = estimateStrength(pw);
  // Clear a field's error as soon as the user edits it.
  const edit = (key: string, set: (v: string) => void) => (v: string) => {
    set(v);
    if (errors[key] || errors.form) setErrors(({ [key]: _drop, form: _f, ...rest }) => rest);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if ([...pw].length < 8) errs.password = 'Use at least 8 characters (16+ recommended).';
    else if (strength.score < 2) errs.password = 'This password is too weak for a master password. Make it longer or less predictable.';
    if (confirm !== pw) errs.confirm = 'Passwords do not match.';
    if (hint && pw && hint.toLowerCase().includes(pw.toLowerCase())) errs.hint = 'The hint must not contain your master password.';
    if (!ack) errs.ack = 'Please confirm you understand there is no password recovery.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await unwrap(api.auth.create(pw, hint.trim() || null));
      setPw('');
      setConfirm('');
      onCreated();
    } catch (err) {
      const field = err instanceof ApiError ? err.field : null;
      setErrors({ [field ?? 'form']: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <form className="auth-card wide" onSubmit={submit} noValidate>
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start', marginBottom: 12 }} onClick={onBack} disabled={busy}>
          <ArrowLeft size={14} aria-hidden /> Back
        </button>
        <h1 className="auth-title" style={{ textAlign: 'left', paddingLeft: 0, letterSpacing: '0.28em' }}>
          CREATE MASTER PASSWORD
        </h1>
        <p className="muted" style={{ margin: '0 0 24px' }}>
          This password encrypts your vault. It is never stored and cannot be recovered.
        </p>

        <div className="field">
          <label htmlFor="setup-pw">Master password</label>
          <PasswordInput
            id="setup-pw"
            value={pw}
            onChange={edit('password', setPw)}
            autoFocus
            showStrength
            showFeedback
            allowGenerate
            invalid={!!errors.password}
            describedBy={errors.password ? 'setup-pw-err' : undefined}
            autoComplete="new-password"
          />
          {errors.password && (
            <span id="setup-pw-err" className="error-text" role="alert">
              <CircleAlert size={14} aria-hidden /> {errors.password}
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="setup-confirm">Confirm password</label>
          <PasswordInput
            id="setup-confirm"
            value={confirm}
            onChange={edit('confirm', setConfirm)}
            invalid={!!errors.confirm}
            describedBy={errors.confirm ? 'setup-confirm-err' : undefined}
            autoComplete="new-password"
          />
          {errors.confirm && (
            <span id="setup-confirm-err" className="error-text" role="alert">
              <CircleAlert size={14} aria-hidden /> {errors.confirm}
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="setup-hint">Password hint (optional)</label>
          <input
            id="setup-hint"
            className="input"
            value={hint}
            maxLength={200}
            onChange={(e) => edit('hint', setHint)(e.target.value)}
            aria-invalid={!!errors.hint || undefined}
            aria-describedby="setup-hint-help"
            autoComplete="off"
          />
          <span id="setup-hint-help" className="help-text">
            The hint is stored <strong>unencrypted</strong> and shown on the unlock screen. Never put your password, or part of it, in the hint.
          </span>
          {errors.hint && (
            <span className="error-text" role="alert">
              <CircleAlert size={14} aria-hidden /> {errors.hint}
            </span>
          )}
        </div>

        <label className="checkbox" style={{ margin: '6px 0 6px' }}>
          <input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); edit('ack', () => undefined)(''); }} aria-invalid={!!errors.ack || undefined} />
          <span>I understand that losing my master password may make my vault permanently inaccessible.</span>
        </label>
        {errors.ack && (
          <span className="error-text" role="alert" style={{ marginBottom: 6 }}>
            <CircleAlert size={14} aria-hidden /> {errors.ack}
          </span>
        )}
        {errors.form && (
          <div className="notice strong" role="alert" style={{ marginTop: 10 }}>
            <CircleAlert size={16} aria-hidden /> {errors.form}
          </div>
        )}

        <button type="submit" className="btn primary wide block" style={{ marginTop: 22 }} disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden /> Deriving encryption key…
            </>
          ) : (
            'Create vault'
          )}
        </button>
      </form>
    </main>
  );
}

// ------------------------------------------------------------------- unlock --

export function Unlock({ hasHint, onUnlocked }: { hasHint: boolean; onUnlocked: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  // Fingerprint / PIN (Android) — shown instead of the password field when enabled.
  const [quick, setQuick] = useState<QuickUnlockStatus | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const loadQuick = useCallback(async () => {
    try {
      setQuick(await api.quick.status());
    } catch {
      setQuick({ supported: false, biometricAvailable: false, biometric: false, pin: false, pinAttemptsLeft: 0 });
    }
  }, []);
  useEffect(() => {
    void loadQuick();
  }, [loadQuick]);
  const showQuick = !usePassword && !!quick && (quick.biometric || quick.pin);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw || busy || wait > 0) return;
    setBusy(true);
    setError(null);
    const r = await api.auth.unlock(pw);
    if (r.ok) {
      setPw('');
      onUnlocked();
      return;
    }
    setBusy(false);
    setPw('');
    setError(r.message);
    if (r.code === 'THROTTLED') {
      const m = /(\d+)/.exec(r.message);
      setWait(m ? Number(m[1]) : 5);
    }
  };

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <Logo />
        <h1 className="auth-title">VAULT</h1>
        <p className="auth-sub">Your data stays on this device.</p>

        {quick === null ? (
          <div className="row-flex" style={{ justifyContent: 'center' }}>
            <span className="spinner" aria-label="Loading" />
          </div>
        ) : showQuick ? (
          <QuickUnlockPanel status={quick} onUnlocked={onUnlocked} onUsePassword={() => setUsePassword(true)} onStatusChanged={loadQuick} />
        ) : (
        <>
        <label htmlFor="unlock-pw" className="sr-only">
          Master password
        </label>
        <PasswordInput
          id="unlock-pw"
          value={pw}
          onChange={setPw}
          placeholder="Master password"
          autoFocus
          mono={false}
          invalid={!!error}
          describedBy={error ? 'unlock-err' : undefined}
          autoComplete="current-password"
        />
        {error && (
          <div id="unlock-err" className="error-text" role="alert" style={{ marginTop: 10, alignItems: 'flex-start' }}>
            <CircleAlert size={14} aria-hidden style={{ marginTop: 3, flex: 'none' }} />
            <span>{wait > 0 ? `Too many attempts. Try again in ${wait} seconds.` : error}</span>
          </div>
        )}

        <button type="submit" className="btn primary wide block" style={{ marginTop: 16 }} disabled={busy || !pw || wait > 0}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden /> Unlocking…
            </>
          ) : (
            'Unlock'
          )}
        </button>
        </>
        )}

        <div className="row-flex" style={{ justifyContent: 'center', gap: 18, marginTop: 18 }}>
          {hasHint && (
            <button
              type="button"
              className="linkish"
              onClick={async () => {
                const r = await api.app.getHint();
                setHint(r.ok ? (r.value ?? '(no hint)') : '(unavailable)');
              }}
            >
              Show hint
            </button>
          )}
          <button type="button" className="linkish" onClick={() => setShowForgot((v) => !v)} aria-expanded={showForgot}>
            Forgot your password?
          </button>
          <button type="button" className="linkish" onClick={() => setRestoring(true)}>
            Restore backup
          </button>
        </div>

        {hint && (
          <div className="notice" style={{ marginTop: 16 }} role="status">
            <Info size={15} aria-hidden />
            <span>
              <strong style={{ color: 'var(--fg)' }}>Hint:</strong> <span className="selectable">{hint}</span>
            </span>
          </div>
        )}

        {showForgot && (
          <div className="auth-note" role="note">
            There is no password recovery mechanism because the vault is designed to remain private. Your master password is never stored
            anywhere, so nobody — including the developers — can unlock your vault without it.
          </div>
        )}
      </form>
      {restoring && <RestoreLockedDialog vaultExists onClose={() => setRestoring(false)} onRestored={onUnlocked} />}
    </main>
  );
}

// ------------------------------------------------------- restore (locked) --

export function RestoreLockedDialog({ vaultExists, onClose, onRestored }: { vaultExists: boolean; onClose: () => void; onRestored: () => void }) {
  const [file, setFile] = useState<{ token: string; fileName: string } | null>(null);
  const [pw, setPw] = useState('');
  const [confirmReplace, setConfirmReplace] = useState(!vaultExists);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (file) void api.backup.discard(file.token);
    onClose();
  };

  const pick = async () => {
    setError(null);
    try {
      const f = await unwrap(api.backup.pickFile());
      if (f) setFile(f);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const restore = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!file || !pw || !confirmReplace) return;
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.backup.restoreWhileLocked(file.token, pw));
      setPw('');
      onRestored();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Restore encrypted backup"
      onClose={close}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!file || !pw || !confirmReplace || busy} onClick={() => void restore()}>
            {busy && <span className="spinner" aria-hidden />} Verify &amp; restore
          </button>
        </>
      }
    >
      <form onSubmit={restore}>
        <div className="field">
          <span className="label">Backup file</span>
          <div className="row-flex">
            <button type="button" className="btn" onClick={pick} disabled={busy}>
              <FolderOpen size={15} aria-hidden /> Choose file…
            </button>
            <span className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file ? file.fileName : 'No file selected'}
            </span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="restore-pw">Backup password</label>
          <PasswordInput id="restore-pw" value={pw} onChange={setPw} mono={false} />
          <span className="help-text">The master password that was in use when the backup was created. It becomes your master password.</span>
        </div>
        {vaultExists && (
          <>
            <div className="notice strong" style={{ marginBottom: 12 }}>
              <TriangleAlert size={16} aria-hidden />
              <span>The vault currently on this device will be replaced by the backup. This cannot be undone.</span>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
              <span>Replace the existing vault on this device</span>
            </label>
          </>
        )}
        {error && (
          <div className="error-text" role="alert" style={{ marginTop: 12 }}>
            <CircleAlert size={14} aria-hidden /> {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}
