import { CircleAlert, ClipboardPaste, EyeOff, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { classifyNote, splitNotes, type ImportedNote, type SplitMode } from '../../shared/noteImport';
import { isSecretType, type VaultSnapshot } from '../../shared/types';
import { Dialog } from '../components/Dialog';
import { CategoryIcon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';

import { tr } from '../../shared/i18n';
interface Row extends ImportedNote {
  include: boolean;
}

/**
 * Paste many notes at once → preview → import every note as its own encrypted
 * item in the right category. The pasted text lives only in this dialog's state
 * and is discarded when it closes.
 */
export function ImportNotesDialog({
  snap,
  onClose,
  onImported,
  initialText
}: {
  snap: VaultSnapshot;
  onClose: () => void;
  onImported: () => Promise<void>;
  /** Text shared from another app: go straight to the preview. */
  initialText?: string;
}) {
  const [text, setText] = useState(initialText ?? '');
  const [mode, setMode] = useState<SplitMode>('auto');
  const [rows, setRows] = useState<Row[] | null>(() =>
    initialText ? splitNotes(initialText, 'auto').map((p, i) => ({ ...classifyNote(p, snap.categories, i), include: true })) : null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const categories = useMemo(() => snap.categories.filter((c) => c.builtin), [snap.categories]);

  const preview = () => {
    const parts = splitNotes(text, mode);
    if (parts.length === 0) return setError(tr("Paste your notes first."));
    setError(null);
    setRows(parts.map((p, i) => ({ ...classifyNote(p, snap.categories, i), include: true })));
  };

  const pasteFromClipboard = async () => {
    const r = await api.app.readClipboardText();
    if (r.ok && r.value.trim()) {
      setError(null);
      setText((cur) => (cur ? cur + '\n\n' : '') + r.value);
    } else {
      setError(r.ok ? tr("The clipboard is empty — copy your notes first.") : tr("Could not read the clipboard. Long-press the box and choose Paste instead."));
    }
  };

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r!.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const changeCategory = (i: number, categoryId: string) =>
    setRows((r) =>
      r!.map((row, j) => (j === i ? { ...classifyNote(row.source, snap.categories, j, categoryId), title: row.title, include: row.include } : row))
    );

  const selected = rows?.filter((r) => r.include) ?? [];

  const doImport = async () => {
    if (!selected.length) return;
    if (selected.some((r) => !r.title.trim())) return setError(tr("Every item needs a title."));
    setBusy(true);
    setError(null);
    try {
      const { count } = await unwrap(
        api.vault.importEntries(selected.map((r) => ({ categoryId: r.categoryId, title: r.title.trim(), fields: r.fields, tags: r.tags, favorite: false })))
      );
      setText('');
      setRows(null);
      toast(tr("{0} item{1} imported and encrypted.", [count, count === 1 ? '' : 's']));
      await onImported();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const close = () => {
    setText('');
    setRows(null);
    onClose();
  };

  return (
    <Dialog placement="center"
      title={tr("Import notes")}
      subtitle={rows ? tr("{0} of {1} notes selected", [selected.length, rows.length]) : tr("Paste all your notes at once — each one becomes its own encrypted item.")}
      onClose={close}
      size="wide"
      busy={busy}
      footer={
        rows ? (
          <>
            <button type="button" className="btn left" onClick={() => setRows(null)} disabled={busy}>
              {tr("Back")}
            </button>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              {tr("Cancel")}
            </button>
            <button type="button" className="btn primary" onClick={doImport} disabled={busy || selected.length === 0}>
              {busy && <span className="spinner" aria-hidden />} {tr("Import")} {selected.length} {tr("item")}{selected.length === 1 ? '' : 's'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={close}>
              {tr("Cancel")}
            </button>
            <button type="button" className="btn primary" onClick={preview} disabled={!text.trim()}>
              {tr("Preview")}
            </button>
          </>
        )
      }
    >
      {!rows ? (
        <>
          <div className="notice" style={{ marginBottom: 14 }}>
            <Info size={15} aria-hidden />
            <span>
              {tr("Tip: in your Notes app you can also select text and tap")} <strong style={{ color: 'var(--fg)' }}>{tr("Share → VaultLocks")}</strong>{tr(". Or copy each note and paste it here,")} <strong style={{ color: 'var(--fg)' }}>{tr("leaving an empty line between notes")}</strong> {tr("(or a line with")} <span className="mono">---</span>{tr("). Lines like")} <span className="mono">{tr("Password: …")}</span>, <span className="mono">{tr("PIN: …")}</span> {tr("or")}{' '}
              <span className="mono">{tr("Username: …")}</span> {tr("go into the right fields automatically.")}
            </span>
          </div>
          <div className="field">
            <div className="row-flex" style={{ justifyContent: 'space-between' }}>
              <label htmlFor="imp-text">{tr("Your notes")}</label>
              <button type="button" className="btn sm" onClick={pasteFromClipboard}>
                <ClipboardPaste size={14} aria-hidden /> {tr("Paste")}
              </button>
            </div>
            <textarea
              id="imp-text"
              className="textarea"
              style={{ minHeight: 260, fontFamily: 'var(--mono)', fontSize: 13 }}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={tr("BPI Savings\nAccount number: 1234 5678\nPassword: ••••••\nPIN: ••••\n\nHome Wi-Fi\nSSID: MyNetwork\nPassword: ••••••")}
              spellCheck={false}
              autoComplete="off"
            />
            <span className="help-text">{splitNotes(text, mode).length} {tr("note(s) detected")}</span>
          </div>
          <div className="field">
            <label htmlFor="imp-mode">{tr("Notes are separated by")}</label>
            <select id="imp-mode" className="select" value={mode} onChange={(e) => setMode(e.target.value as SplitMode)}>
              <option value="auto">{tr("Automatic")}</option>
              <option value="blank">{tr("One empty line")}</option>
              <option value="blank2">{tr("Two empty lines (notes contain empty lines)")}</option>
              <option value="separator">{tr("A line with --- or ===")}</option>
            </select>
          </div>
        </>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {rows.map((r, i) => {
            const cat = snap.categories.find((c) => c.id === r.categoryId);
            const secrets = (cat?.fields ?? []).filter((f) => isSecretType(f.type) && r.fields[f.key]).map((f) => f.label);
            const plain = (cat?.fields ?? []).filter((f) => !isSecretType(f.type) && r.fields[f.key]).map((f) => f.label);
            return (
              <div key={i} className="card" style={{ padding: 12, opacity: r.include ? 1 : 0.5 }}>
                <div className="row-flex" style={{ alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={r.include}
                    onChange={(e) => update(i, { include: e.target.checked })}
                    aria-label={tr("Import note {0}", [i + 1])}
                    style={{ marginTop: 9 }}
                  />
                  <span className="row-icon" style={{ marginTop: 2 }}>
                    <CategoryIcon icon={cat?.icon} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }} className="stack">
                    <div className="grid-2" style={{ gap: 8 }}>
                      <input
                        className="input"
                        aria-label={tr("Title of note {0}", [i + 1])}
                        value={r.title}
                        maxLength={200}
                        onChange={(e) => update(i, { title: e.target.value })}
                      />
                      <select className="select" aria-label={tr("Category of note {0}", [i + 1])} value={r.categoryId} onChange={(e) => changeCategory(i, e.target.value)}>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="small muted" style={{ marginTop: -6 }}>
                      {secrets.length > 0 && (
                        <span className="row-flex" style={{ gap: 6, display: 'inline-flex', marginRight: 10 }}>
                          <EyeOff size={12} aria-hidden /> {tr("hidden:")} {secrets.join(', ')}
                        </span>
                      )}
                      {plain.length > 0 && <span>{tr("fields:")} {plain.join(', ')}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="notice">
            <Info size={15} aria-hidden />
            <span>
              {tr("After importing, delete the original notes from your Notes app — they are not encrypted there. Unclear notes are saved as")}{' '}
              <strong style={{ color: 'var(--fg)' }}>{tr("Secure Notes")}</strong> {tr("so nothing sensitive is left visible.")}
            </span>
          </div>
        </div>
      )}
      {error && (
        <div className="error-text" role="alert" style={{ marginTop: 12 }}>
          <CircleAlert size={14} aria-hidden /> {error}
        </div>
      )}
    </Dialog>
  );
}
