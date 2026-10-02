import {
  CircleAlert,
  CircleCheck,
  Database,
  Download,
  FolderOpen,
  Info,
  KeyRound,
  Layers,
  Paintbrush,
  Pencil,
  Plus,
  Shield,
  Trash,
  TriangleAlert,
  Upload,
  X
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { PLAINTEXT_CONFIRM_PHRASE } from '../../shared/api';
import { estimateStrength } from '../../shared/strength';
import type { BackupSummary, CategoryDef, CategoryIcon as IconName, DatabaseInfo, FieldDef, FieldType, VaultSettings, VaultSnapshot } from '../../shared/types';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { CATEGORY_ICONS, CategoryIcon } from '../components/Icon';
import { PasswordInput } from '../components/PasswordInput';
import { useToast } from '../components/Toast';
import { ApiError, api, errorMessage, unwrap } from '../lib/api';
import { daysSince, formatBytes, formatDateTime } from '../lib/format';

type Tab = 'security' | 'appearance' | 'vault' | 'categories' | 'about';

interface Props {
  snap: VaultSnapshot;
  version: string;
  initialTab?: string;
  onChanged: () => Promise<void>;
  onSnapshot: (fn: (s: VaultSnapshot | null) => VaultSnapshot | null) => void;
}

export function SettingsView({ snap, version, initialTab, onChanged, onSnapshot }: Props) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? 'security');
  const toast = useToast();

  const update = async (patch: Partial<VaultSettings>) => {
    try {
      const settings = await unwrap(api.vault.updateSettings(patch));
      onSnapshot((s) => (s ? { ...s, settings } : s));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'security', label: 'Security', icon: <Shield size={16} strokeWidth={1.75} aria-hidden /> },
    { id: 'appearance', label: 'Appearance', icon: <Paintbrush size={16} strokeWidth={1.75} aria-hidden /> },
    { id: 'vault', label: 'Vault & Backup', icon: <Database size={16} strokeWidth={1.75} aria-hidden /> },
    { id: 'categories', label: 'Categories', icon: <Layers size={16} strokeWidth={1.75} aria-hidden /> },
    { id: 'about', label: 'About', icon: <Info size={16} strokeWidth={1.75} aria-hidden /> }
  ];

  return (
    <div className="page">
      <div className="page-narrow">
        <h1 className="h1" style={{ marginBottom: 24 }}>
          Settings
        </h1>
        <div className="settings-layout">
          <div className="settings-tabs" role="tablist" aria-label="Settings sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                className="nav-item"
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.icon}
                <span className="nav-text">{t.label}</span>
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'security' && <SecurityTab settings={snap.settings} update={update} />}
            {tab === 'appearance' && <AppearanceTab settings={snap.settings} update={update} />}
            {tab === 'vault' && <VaultTab snap={snap} update={update} onChanged={onChanged} />}
            {tab === 'categories' && <CategoriesTab snap={snap} onChanged={onChanged} />}
            {tab === 'about' && <AboutTab version={version} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- primitives --

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="setting-group" aria-label={title}>
      <span className="label">{title}</span>
      <div className="card">{children}</div>
    </section>
  );
}

function Setting({ title, desc, children, htmlFor }: { title: string; desc?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="setting">
      <div className="grow">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="title" style={{ display: 'block', cursor: 'pointer' }}>
            {title}
          </label>
        ) : (
          <div className="title">{title}</div>
        )}
        {desc && <div className="desc">{desc}</div>}
      </div>
      {children}
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

// --------------------------------------------------------------- security --

function SecurityTab({ settings, update }: { settings: VaultSettings; update: (p: Partial<VaultSettings>) => Promise<void> }) {
  const [changing, setChanging] = useState(false);
  return (
    <>
      <Group title="Master password">
        <Setting title="Change master password" desc="Re-encrypts the entire vault with a new key and a new random salt.">
          <button type="button" className="btn sm" onClick={() => setChanging(true)}>
            <KeyRound size={14} aria-hidden /> Change…
          </button>
        </Setting>
      </Group>

      <Group title="Locking">
        <Setting title="Auto-lock" desc="Lock the vault after a period of inactivity.">
          <Segmented
            label="Auto-lock timer"
            value={settings.autoLockMinutes}
            options={[
              [1, '1m'],
              [5, '5m'],
              [10, '10m'],
              [15, '15m'],
              [30, '30m'],
              [0, 'Never']
            ]}
            onChange={(v) => update({ autoLockMinutes: v })}
          />
        </Setting>
        <Setting title="Lock when minimized" desc="Also applies when hidden to the system tray." htmlFor="s-min">
          <input id="s-min" type="checkbox" className="switch" checked={settings.lockOnMinimize} onChange={(e) => update({ lockOnMinimize: e.target.checked })} />
        </Setting>
        <Setting title="Lock when computer locks or sleeps" htmlFor="s-sys">
          <input id="s-sys" type="checkbox" className="switch" checked={settings.lockOnSystemLock} onChange={(e) => update({ lockOnSystemLock: e.target.checked })} />
        </Setting>
        <Setting title="Keep running in system tray when closed" desc="Only while unlocked. Use Quit from the tray menu to exit." htmlFor="s-tray">
          <input id="s-tray" type="checkbox" className="switch" checked={settings.closeToTray} onChange={(e) => update({ closeToTray: e.target.checked })} />
        </Setting>
      </Group>

      <Group title="Clipboard & visibility">
        <Setting title="Clear clipboard after" desc="Copied values are removed from the clipboard automatically." htmlFor="s-clip">
          <select
            id="s-clip"
            className="select"
            style={{ width: 140 }}
            value={settings.clipboardClearSeconds}
            onChange={(e) => update({ clipboardClearSeconds: Number(e.target.value) })}
          >
            {[15, 30, 45, 60, 90].map((s) => (
              <option key={s} value={s}>
                {s} seconds
              </option>
            ))}
          </select>
        </Setting>
        <Setting title="Hide revealed values after" desc="Sensitive fields are always hidden by default." htmlFor="s-reveal">
          <select
            id="s-reveal"
            className="select"
            style={{ width: 140 }}
            value={settings.revealTimeoutSeconds}
            onChange={(e) => update({ revealTimeoutSeconds: Number(e.target.value) })}
          >
            {[
              [10, '10 seconds'],
              [30, '30 seconds'],
              [60, '1 minute'],
              [0, 'Manually']
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Setting>
      </Group>
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
    </>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toast = useToast();

  useEffect(() => {
    void api.app.getHint().then((r) => r.ok && r.value && setHint(r.value));
  }, []);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const errs: Record<string, string> = {};
    if (!current) errs.current = 'Enter your current master password.';
    if ([...next].length < 8) errs.next = 'Use at least 8 characters (16+ recommended).';
    else if (estimateStrength(next).score < 2) errs.next = 'This password is too weak for a master password.';
    else if (next === current) errs.next = 'Choose a different password.';
    if (confirm !== next) errs.confirm = 'Passwords do not match.';
    if (hint && next && hint.toLowerCase().includes(next.toLowerCase())) errs.hint = 'The hint must not contain your master password.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await unwrap(api.auth.changePassword(current, next, hint.trim() || null));
      toast('Master password changed. Vault re-encrypted.');
      onClose();
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

  return (
    <Dialog
      title="Change master password"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden /> Re-encrypting…
              </>
            ) : (
              'Change password'
            )}
          </button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="cp-cur">1. Current master password</label>
          <PasswordInput id="cp-cur" value={current} onChange={setCurrent} mono={false} invalid={!!errors.current} autoComplete="current-password" />
          {err('current')}
        </div>
        <div className="field">
          <label htmlFor="cp-new">2. New master password</label>
          <PasswordInput id="cp-new" value={next} onChange={setNext} showStrength showFeedback allowGenerate invalid={!!errors.next} autoComplete="new-password" />
          {err('next')}
        </div>
        <div className="field">
          <label htmlFor="cp-confirm">3. Confirm new password</label>
          <PasswordInput id="cp-confirm" value={confirm} onChange={setConfirm} invalid={!!errors.confirm} autoComplete="new-password" />
          {err('confirm')}
        </div>
        <div className="field">
          <label htmlFor="cp-hint">Hint (optional, stored unencrypted)</label>
          <input id="cp-hint" className="input" value={hint} maxLength={200} onChange={(e) => setHint(e.target.value)} autoComplete="off" />
          {err('hint')}
        </div>
        {errors.form && (
          <div className="notice strong" role="alert">
            <CircleAlert size={16} aria-hidden /> {errors.form}
          </div>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------- appearance --

function AppearanceTab({ settings, update }: { settings: VaultSettings; update: (p: Partial<VaultSettings>) => Promise<void> }) {
  return (
    <Group title="Appearance">
      <Setting title="Theme" desc="A strict monochrome theme designed for focus and privacy.">
        <Segmented label="Theme" value="bw" options={[['bw', 'Black & White']]} onChange={() => undefined} />
      </Setting>
      <Setting title="Spacing">
        <Segmented
          label="Spacing"
          value={settings.density}
          options={[
            ['comfortable', 'Comfortable'],
            ['compact', 'Compact']
          ]}
          onChange={(v) => update({ density: v })}
        />
      </Setting>
      <Setting title="Sidebar" desc="Auto collapses the sidebar on smaller windows.">
        <Segmented
          label="Sidebar"
          value={settings.sidebar}
          options={[
            ['auto', 'Auto'],
            ['expanded', 'Expanded'],
            ['collapsed', 'Collapsed']
          ]}
          onChange={(v) => update({ sidebar: v })}
        />
      </Setting>
      <Setting title="Sort favorites">
        <Segmented
          label="Sort favorites"
          value={settings.favoriteSort}
          options={[
            ['manual', 'Manual'],
            ['name', 'Name'],
            ['updated', 'Recent']
          ]}
          onChange={(v) => update({ favoriteSort: v })}
        />
      </Setting>
    </Group>
  );
}

// ------------------------------------------------------------ vault/backup --

function VaultTab({ snap, update, onChanged }: { snap: VaultSnapshot; update: (p: Partial<VaultSettings>) => Promise<void>; onChanged: () => Promise<void> }) {
  const [info, setInfo] = useState<DatabaseInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<null | 'restore' | 'verify'>(null);
  const [plaintext, setPlaintext] = useState(false);
  const toast = useToast();
  const { settings, meta } = snap;

  const loadInfo = async () => {
    const r = await api.vault.databaseInfo();
    if (r.ok) setInfo(r.value);
  };
  useEffect(() => {
    void loadInfo();
  }, [snap]);

  const backup = async () => {
    setBusy(true);
    try {
      const r = await unwrap(api.backup.create());
      if (r) {
        toast(r.verified ? 'Encrypted backup created and verified.' : 'Backup created.');
        await onChanged();
      }
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const overdue = settings.backupReminderDays > 0 && daysSince(meta.lastBackupAt) > settings.backupReminderDays;

  return (
    <>
      <div className="notice strong" style={{ marginBottom: 24 }}>
        <TriangleAlert size={16} aria-hidden />
        <span>
          Your vault is stored locally. Losing both your device and your backup may permanently remove access to your stored information.
        </span>
      </div>

      <Group title="Backup">
        <Setting
          title="Create encrypted backup"
          desc={
            <>
              Last backup: {meta.lastBackupAt ? formatDateTime(meta.lastBackupAt) : 'never'}
              {meta.lastBackupAt && (meta.lastBackupVerified ? ' · verified' : ' · not verified')}
              {overdue && ' · reminder due'}
            </>
          }
        >
          <button type="button" className="btn sm primary" onClick={backup} disabled={busy}>
            {busy ? <span className="spinner" aria-hidden /> : <Download size={14} aria-hidden />} Back up now
          </button>
        </Setting>
        <Setting title="Backup location" desc={<span className="selectable">{settings.backupDirectory ?? 'Documents folder (default)'}</span>}>
          <button
            type="button"
            className="btn sm"
            onClick={async () => {
              try {
                const dir = await unwrap(api.backup.chooseDirectory());
                if (dir) await onChanged();
              } catch (e) {
                toast(errorMessage(e), 'error');
              }
            }}
          >
            <FolderOpen size={14} aria-hidden /> Choose…
          </button>
        </Setting>
        <Setting title="Backup reminder" htmlFor="s-remind">
          <select
            id="s-remind"
            className="select"
            style={{ width: 150 }}
            value={settings.backupReminderDays}
            onChange={(e) => update({ backupReminderDays: Number(e.target.value) })}
          >
            {[
              [7, 'Every week'],
              [14, 'Every 2 weeks'],
              [30, 'Every month'],
              [90, 'Every 3 months'],
              [0, 'Off']
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Setting>
        <Setting title="Verify a backup" desc="Check that a backup file is intact and opens with its password. Nothing is changed.">
          <button type="button" className="btn sm" onClick={() => setRestoring('verify')}>
            <CircleCheck size={14} aria-hidden /> Verify…
          </button>
        </Setting>
      </Group>

      <Group title="Restore & import">
        <Setting title="Restore or import encrypted backup" desc="Replace this vault with a backup, or merge items from a backup into it.">
          <button type="button" className="btn sm" onClick={() => setRestoring('restore')}>
            <Upload size={14} aria-hidden /> Restore…
          </button>
        </Setting>
        <Setting title="Export plaintext (unsafe)" desc="Writes every password unencrypted to a file. Requires your master password.">
          <button type="button" className="btn sm danger" onClick={() => setPlaintext(true)}>
            <TriangleAlert size={14} aria-hidden /> Export…
          </button>
        </Setting>
      </Group>

      <Group title="Database information">
        {info ? (
          <dl className="kv">
            <dt>Location</dt>
            <dd>{info.path}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(info.sizeBytes)}</dd>
            <dt>Items</dt>
            <dd>{info.itemCount}</dd>
            <dt>Encryption</dt>
            <dd>{info.cipher}</dd>
            <dt>Key derivation</dt>
            <dd>{info.kdf}</dd>
            <dt>Format version</dt>
            <dd>{info.formatVersion}</dd>
            <dt>Created</dt>
            <dd>{formatDateTime(info.createdAt)}</dd>
            <dt>Last modified</dt>
            <dd>{formatDateTime(info.modifiedAt)}</dd>
          </dl>
        ) : (
          <div className="card-pad muted">Loading…</div>
        )}
        <div className="setting" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="grow desc">The vault file contains only encrypted data and the parameters needed to decrypt it.</div>
          <button type="button" className="btn sm" onClick={() => void api.vault.showVaultFolder()}>
            <FolderOpen size={14} aria-hidden /> Show in folder
          </button>
        </div>
      </Group>

      {restoring && (
        <RestoreDialog
          verifyOnly={restoring === 'verify'}
          onClose={() => setRestoring(null)}
          onRestored={async () => {
            setRestoring(null);
            await onChanged();
          }}
        />
      )}
      {plaintext && <PlaintextExportDialog onClose={() => setPlaintext(false)} />}
    </>
  );
}

function RestoreDialog({ verifyOnly, onClose, onRestored }: { verifyOnly: boolean; onClose: () => void; onRestored: () => Promise<void> }) {
  const [file, setFile] = useState<{ token: string; fileName: string } | null>(null);
  const [pw, setPw] = useState('');
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const close = () => {
    if (file) void api.backup.discard(file.token);
    onClose();
  };

  const pick = async () => {
    setError(null);
    setSummary(null);
    try {
      const f = await unwrap(api.backup.pickFile());
      if (f) {
        if (file) void api.backup.discard(file.token);
        setFile(f);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const open = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!file || !pw) return;
    setBusy(true);
    setError(null);
    try {
      setSummary(await unwrap(api.backup.open(file.token, pw)));
      setPw('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!summary) return;
    try {
      await unwrap(api.backup.apply(summary.token, mode));
      toast(mode === 'replace' ? 'Vault restored from backup.' : 'Backup items imported.');
      await onRestored();
    } catch (e) {
      setConfirming(false);
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <Dialog
        title={verifyOnly ? 'Verify backup' : 'Restore or import backup'}
        onClose={close}
        busy={busy}
        footer={
          <>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              {summary && verifyOnly ? 'Done' : 'Cancel'}
            </button>
            {!summary && (
              <button type="button" className="btn primary" disabled={!file || !pw || busy} onClick={() => void open()}>
                {busy && <span className="spinner" aria-hidden />} Verify backup
              </button>
            )}
            {summary && !verifyOnly && (
              <button type="button" className={`btn ${mode === 'replace' ? 'danger' : 'primary'}`} onClick={() => setConfirming(true)}>
                {mode === 'replace' ? 'Replace vault…' : 'Import items…'}
              </button>
            )}
          </>
        }
      >
        {!summary ? (
          <form onSubmit={open}>
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
              <label htmlFor="rb-pw">Backup password</label>
              <PasswordInput id="rb-pw" value={pw} onChange={setPw} mono={false} />
              <span className="help-text">The master password that was in use when the backup was created.</span>
            </div>
          </form>
        ) : (
          <>
            <div className="notice" style={{ marginBottom: 16 }}>
              <CircleCheck size={16} aria-hidden />
              <span>
                <strong style={{ color: 'var(--fg)' }}>Backup verified.</strong> Encryption and integrity checks passed.
              </span>
            </div>
            <dl className="kv card" style={{ marginBottom: 16 }}>
              <dt>File</dt>
              <dd>{summary.fileName}</dd>
              <dt>Items</dt>
              <dd>{summary.itemCount}</dd>
              <dt>Custom categories</dt>
              <dd>{summary.categoryCount}</dd>
              <dt>Vault created</dt>
              <dd>{formatDateTime(summary.createdAt)}</dd>
            </dl>
            {!verifyOnly && (
              <div className="field">
                <span className="label">How should it be restored?</span>
                <div className="stack" role="radiogroup" aria-label="Restore mode" style={{ gap: 8 }}>
                  {(
                    [
                      ['merge', 'Import (merge)', 'Add items from the backup that are not already in this vault.'],
                      ['replace', 'Replace', "Delete all current items and use the backup's items instead."]
                    ] as const
                  ).map(([m, t, d]) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={mode === m}
                      className="row"
                      style={{ border: `1px solid ${mode === m ? 'var(--fg)' : 'var(--border-strong)'}` }}
                      onClick={() => setMode(m)}
                    >
                      <span aria-hidden className="mono">{mode === m ? '◉' : '○'}</span>
                      <span className="row-main">
                        <strong>{t}</strong>
                        <span className="row-sub" style={{ display: 'block', whiteSpace: 'normal' }}>{d}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <span className="help-text">Your current master password and settings are kept.</span>
              </div>
            )}
          </>
        )}
        {error && (
          <div className="error-text" role="alert" style={{ marginTop: 12 }}>
            <CircleAlert size={14} aria-hidden /> {error}
          </div>
        )}
      </Dialog>
      {confirming && summary && (
        <ConfirmDialog
          title={mode === 'replace' ? 'Replace vault?' : 'Import items?'}
          danger={mode === 'replace'}
          confirmLabel={mode === 'replace' ? 'Replace vault' : 'Import'}
          message={
            mode === 'replace' ? (
              <>All items currently in your vault will be replaced by the {summary.itemCount} item(s) from the backup. This cannot be undone.</>
            ) : (
              <>Items from the backup that are not already in your vault will be added.</>
            )
          }
          onCancel={() => setConfirming(false)}
          onConfirm={apply}
        />
      )}
    </>
  );
}

function PlaintextExportDialog({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const path = await unwrap(api.backup.exportPlaintext(pw, phrase));
      if (path) {
        toast('Plaintext export written. Delete it securely when done.');
        onClose();
      }
    } catch (e) {
      const f = e instanceof ApiError ? e.field : null;
      setErrors({ [f ?? 'form']: errorMessage(e) });
    } finally {
      setBusy(false);
      setPw('');
    }
  };

  return (
    <Dialog
      title="Export plaintext — security warning"
      onClose={onClose}
      busy={busy}
      role="alertdialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-autofocus>
            Cancel
          </button>
          <button type="button" className="btn danger" disabled={!pw || phrase !== PLAINTEXT_CONFIRM_PHRASE || busy} onClick={submit}>
            {busy && <span className="spinner" aria-hidden />} Export unencrypted file
          </button>
        </>
      }
    >
      <div className="notice strong" style={{ marginBottom: 16 }}>
        <TriangleAlert size={16} aria-hidden />
        <span>
          This creates a file containing <strong>all of your passwords, PINs and notes in readable plain text</strong>. Anyone or any program that can
          read the file can read your secrets. Prefer the encrypted backup unless you are migrating to another password manager.
        </span>
      </div>
      <div className="field">
        <label htmlFor="pt-pw">Re-enter master password</label>
        <PasswordInput id="pt-pw" value={pw} onChange={setPw} mono={false} invalid={!!errors.password} autoComplete="current-password" />
        {errors.password && (
          <span className="error-text" role="alert">
            <CircleAlert size={14} aria-hidden /> {errors.password}
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="pt-phrase">
          Type <span className="mono" style={{ color: 'var(--fg)' }}>{PLAINTEXT_CONFIRM_PHRASE}</span> to confirm
        </label>
        <input id="pt-phrase" className="input mono" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      {errors.form && (
        <div className="error-text" role="alert">
          <CircleAlert size={14} aria-hidden /> {errors.form}
        </div>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------- categories --

function CategoriesTab({ snap, onChanged }: { snap: VaultSnapshot; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<CategoryDef | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CategoryDef | null>(null);
  const toast = useToast();
  const custom = snap.categories.filter((c) => !c.builtin);
  const builtin = snap.categories.filter((c) => c.builtin);
  const count = (id: string) => snap.entries.filter((e) => e.categoryId === id).length;

  return (
    <>
      <section className="setting-group">
        <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <span className="label">Custom categories</span>
          <button type="button" className="btn sm" onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden /> New category
          </button>
        </div>
        <div className="card">
          {custom.length === 0 && <div className="card-pad muted">No custom categories yet. Create one with your own fields.</div>}
          {custom.map((c) => (
            <div key={c.id} className="setting">
              <span className="row-icon">
                <CategoryIcon icon={c.icon} />
              </span>
              <div className="grow">
                <div className="title">{c.name}</div>
                <div className="desc">
                  {c.fields.length} field(s) · {count(c.id)} item(s)
                </div>
              </div>
              <button type="button" className="icon-btn" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`} title="Edit">
                <Pencil size={15} />
              </button>
              <button type="button" className="icon-btn" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`} title="Delete">
                <Trash size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>
      <Group title="Built-in categories">
        {builtin.map((c) => (
          <div key={c.id} className="setting">
            <span className="row-icon">
              <CategoryIcon icon={c.icon} />
            </span>
            <div className="grow">
              <div className="title">{c.name}</div>
              <div className="desc">{c.fields.map((f) => f.label).join(' · ')}</div>
            </div>
            <span className="dim small">{count(c.id)}</span>
          </div>
        ))}
      </Group>
      {editing && (
        <CategoryEditor
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
            toast('Category saved.');
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete category?"
          danger
          confirmLabel="Delete category"
          message={
            <>
              Delete the category <strong style={{ color: 'var(--fg)' }}>{deleting.name}</strong>? Categories that still contain items cannot be deleted.
            </>
          }
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await unwrap(api.vault.deleteCategory(deleting.id));
              setDeleting(null);
              await onChanged();
              toast('Category deleted.');
            } catch (e) {
              setDeleting(null);
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
    </>
  );
}

const FIELD_TYPE_LABELS: [FieldType, string][] = [
  ['text', 'Text'],
  ['username', 'Username'],
  ['email', 'Email'],
  ['password', 'Password (secret)'],
  ['pin', 'PIN (secret)'],
  ['secret', 'Hidden text (secret)'],
  ['url', 'Website'],
  ['phone', 'Phone'],
  ['date', 'Date'],
  ['textarea', 'Notes'],
  ['secretTextarea', 'Secure note (secret)']
];

function CategoryEditor({ category, onClose, onSaved }: { category: CategoryDef | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState<IconName>(category?.icon ?? 'folder');
  const [fields, setFields] = useState<FieldDef[]>(
    category?.fields ?? [
      { key: '', label: 'Username', type: 'username' },
      { key: '', label: 'Password', type: 'password' },
      { key: '', label: 'Notes', type: 'textarea' }
    ]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return setError('Give the category a name.');
    if (fields.length === 0 || fields.some((f) => !f.label.trim())) return setError('Every field needs a label.');
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.vault.saveCategory({ id: category?.id, name, icon, fields }));
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={category ? 'Edit category' : 'New category'}
      onClose={onClose}
      busy={busy}
      size="wide"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy && <span className="spinner" aria-hidden />} Save category
          </button>
        </>
      }
    >
      <form onSubmit={save}>
        <div className="field">
          <label htmlFor="cat-name">Name</label>
          <input id="cat-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <span className="label">Icon</span>
          <div className="row-flex" role="radiogroup" aria-label="Icon" style={{ flexWrap: 'wrap', gap: 6 }}>
            {(Object.keys(CATEGORY_ICONS) as IconName[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={icon === k}
                aria-label={k}
                title={k}
                className="icon-btn"
                style={icon === k ? { background: 'var(--fg)', color: 'var(--bg)' } : { border: '1px solid var(--border)' }}
                onClick={() => setIcon(k)}
              >
                <CategoryIcon icon={k} />
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">Fields</span>
          {fields.map((f, i) => (
            <div key={i} className="field-editor-row">
              <input
                className="input"
                aria-label={`Field ${i + 1} label`}
                value={f.label}
                maxLength={60}
                onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="Field label"
              />
              <select
                className="select"
                aria-label={`Field ${i + 1} type`}
                value={f.type}
                onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, type: e.target.value as FieldType } : x)))}
              >
                {FIELD_TYPE_LABELS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove field ${f.label || i + 1}`}
                title="Remove field"
                onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="btn sm"
              disabled={fields.length >= 30}
              onClick={() => setFields((fs) => [...fs, { key: '', label: '', type: 'text' }])}
            >
              <Plus size={14} aria-hidden /> Add field
            </button>
          </div>
          {category && <span className="help-text">Removing a field permanently deletes its values from items in this category.</span>}
        </div>
        {error && (
          <div className="error-text" role="alert">
            <CircleAlert size={14} aria-hidden /> {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ about --

function AboutTab({ version }: { version: string }) {
  return (
    <>
      <Group title="Application">
        <dl className="kv">
          <dt>Application</dt>
          <dd>VaultLocks</dd>
          <dt>Version</dt>
          <dd>{version}</dd>
          <dt>Network access</dt>
          <dd>None — all network requests are blocked. No accounts, sync, analytics or telemetry.</dd>
        </dl>
      </Group>
      <Group title="Security">
        <dl className="kv">
          <dt>Encryption</dt>
          <dd>AES-256-GCM authenticated encryption with a fresh random 96-bit nonce on every save.</dd>
          <dt>Key derivation</dt>
          <dd>Argon2id (RFC 9106) — 64 MiB memory, 3 passes, 4 lanes, 256-bit random salt.</dd>
          <dt>Integrity</dt>
          <dd>All file metadata is authenticated; any modification is detected and rejected.</dd>
          <dt>Master password</dt>
          <dd>Never stored, logged or displayed. There is no recovery or bypass.</dd>
          <dt>Keyboard shortcuts</dt>
          <dd>Ctrl+K search · Ctrl+N new item · Ctrl+L lock · Ctrl+G generator · Ctrl+, settings · Esc close</dd>
        </dl>
      </Group>
      <Group title="Open-source licenses">
        <dl className="kv">
          <dt>Electron / Chromium</dt>
          <dd>MIT / BSD-style (see LICENSES.chromium.html in the install folder)</dd>
          <dt>React</dt>
          <dd>MIT</dd>
          <dt>hash-wasm (Argon2id)</dt>
          <dd>MIT</dd>
          <dt>Lucide icons</dt>
          <dd>ISC</dd>
          <dt>EFF Large Wordlist</dt>
          <dd>CC BY 3.0 US — Electronic Frontier Foundation</dd>
        </dl>
      </Group>
    </>
  );
}
