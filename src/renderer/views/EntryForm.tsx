import { CircleAlert, File as FileIcon, Info, Paperclip, Plus, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AttachmentInput, EntryView, FieldDef, VaultSnapshot } from '../../shared/types';
import { AddAttachmentSheet, readPicked } from '../components/Attachments';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { formatBytes } from '../lib/format';
import { isImage, pickFiles, type PickSource } from '../lib/files';
import { PasswordInput } from '../components/PasswordInput';
import { TagInput } from '../components/TagInput';
import { ApiError, api, errorMessage, unwrap } from '../lib/api';
import type { EditorState } from './VaultApp';

interface Props {
  state: NonNullable<EditorState>;
  snap: VaultSnapshot;
  onClose: () => void;
  /** attachmentsAdded: files attached to a NEW item while saving. */
  onSaved: (view: EntryView, attachmentsAdded: number) => void | Promise<void>;
}

/** Field checks that catch typos before saving (values stay on the device). */
export function validateField(def: FieldDef, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (def.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address.';
  if (def.type === 'url' && /^\s*(javascript|data|vbscript|file):/i.test(v)) return 'This URL scheme is not allowed.';
  if (def.type === 'phone' && !/^[+()\d\s.-]{5,25}$/.test(v)) return 'Enter a valid phone number (digits, spaces, +, -).';
  if (def.key === 'accountNumber' && !/^[A-Za-z0-9\s-]{4,40}$/.test(v)) return 'Account numbers contain only letters, digits, spaces or dashes.';
  if (def.key === 'cardNumber') {
    const d = v.replace(/[\s-]/g, '');
    if (!/^\d+$/.test(d)) return 'Card numbers contain only digits.';
    if (d.length < 12 || d.length > 19) return 'Card numbers have 12 to 19 digits.';
  }
  if (def.key === 'expiry') {
    const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(v);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return 'Use the format MM/YY, e.g. 08/28.';
  }
  if (def.key === 'cvv' && !/^\d{3,4}$/.test(v)) return 'CVV / CVC is 3 or 4 digits.';
  if (def.type === 'pin' && def.key !== 'cvv' && v.length > 64) return 'Too long.';
  return null;
}

/** Title suggestions come from the category's "name" field when the title is empty. */
const TITLE_SOURCE: Record<string, string> = {
  banking: 'bankName',
  email: 'service',
  social: 'platform',
  others: 'name',
  software: 'product'
};

export function EntryForm({ state, snap, onClose, onSaved }: Props) {
  const isEdit = state.mode === 'edit';
  const [loading, setLoading] = useState(isEdit);
  const [categoryId, setCategoryId] = useState(state.mode === 'new' ? (state.categoryId ?? 'personal') : '');
  const [title, setTitle] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  // Values as loaded: older values that don't pass the checks never block saving.
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // New items: files are read now and attached (encrypted) right after the item is saved.
  const [pending, setPending] = useState<AttachmentInput[]>([]);
  const [addingFile, setAddingFile] = useState(false);
  const [readingFiles, setReadingFiles] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const toast = useToast();

  // Edit: load the full entry (including secrets) only for the lifetime of this form.
  useEffect(() => {
    if (state.mode !== 'edit') return;
    let cancelled = false;
    void (async () => {
      try {
        const e = await unwrap(api.vault.getForEdit(state.id));
        if (cancelled) return;
        setCategoryId(e.categoryId);
        setTitle(e.title);
        setFields(e.fields);
        setOriginal(e.fields);
        setTags(e.tags);
        setFavorite(e.favorite);
      } catch (err) {
        setErrors({ form: errorMessage(err) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      setFields({}); // discard secrets from state when the form closes
      setOriginal({});
    };
  }, [state]);

  const category = snap.categories.find((c) => c.id === categoryId);

  const duplicate = useMemo(() => {
    const t = title.trim().toLowerCase();
    if (!t) return false;
    return snap.entries.some((e) => e.categoryId === categoryId && e.title.trim().toLowerCase() === t && (state.mode === 'new' || e.id !== state.id));
  }, [title, categoryId, snap.entries, state]);

  const setField = (key: string, v: string) => setFields((f) => ({ ...f, [key]: v }));

  const pickPending = async (source: PickSource) => {
    setAddingFile(false);
    const files = await pickFiles(source);
    if (!files.length) return;
    setReadingFiles(true);
    try {
      const inputs = await readPicked(
        files,
        (m) => toast(m, 'error'),
        () => toast('Large file — this may take a moment.')
      );
      setPending((p) => {
        const next = [...p];
        for (const i of inputs) if (!next.some((x) => x.name === i.name && x.data.length === i.data.length)) next.push(i);
        return next;
      });
    } finally {
      setReadingFiles(false);
    }
  };

  const submit = async (e?: FormEvent, allowDuplicate = false) => {
    e?.preventDefault();
    if (busy || loading) return;
    const errs: Record<string, string> = {};
    let finalTitle = title.trim();
    if (!finalTitle && TITLE_SOURCE[categoryId] && fields[TITLE_SOURCE[categoryId]!]?.trim()) {
      finalTitle = fields[TITLE_SOURCE[categoryId]!]!.trim();
    }
    if (!finalTitle) errs.title = 'Give this item a title.';
    if (!category) errs.form = 'Choose a category.';
    for (const def of category?.fields ?? []) {
      const value = fields[def.key] ?? '';
      const err = value === (original[def.key] ?? '') ? null : validateField(def, value);
      if (err) errs[def.key] = err;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('#entry-form [aria-invalid="true"]')?.focus());
      return;
    }
    // Same title in the same category: ask before creating a likely duplicate.
    if (duplicate && !allowDuplicate) return setConfirmDuplicate(true);

    // Only send fields defined on the selected category.
    const payload: Record<string, string> = {};
    for (const def of category?.fields ?? []) if (fields[def.key]) payload[def.key] = fields[def.key]!;

    setBusy(true);
    try {
      const view = await unwrap(
        api.vault.saveEntry({ id: state.mode === 'edit' ? state.id : undefined, categoryId, title: finalTitle, fields: payload, tags, favorite })
      );
      setFields({});
      let added = 0;
      for (const input of pending) {
        try {
          const r = await unwrap(api.attachments.add(view.id, { ...input, allowDuplicate: true }));
          if (r.status === 'added') added++;
        } catch (err) {
          toast(`${input.name}: ${errorMessage(err)}`, 'error');
        }
      }
      setPending([]);
      await onSaved(view, added);
    } catch (err) {
      const field = err instanceof ApiError ? err.field : null;
      setErrors({ [field ?? 'form']: errorMessage(err) });
      setBusy(false);
    }
  };

  const fieldError = (key: string) =>
    errors[key] ? (
      <span id={`f-${key}-err`} className="error-text" role="alert">
        <CircleAlert size={14} aria-hidden /> {errors[key]}
      </span>
    ) : null;

  const renderField = (def: FieldDef) => {
    const id = `f-${def.key}`;
    const value = fields[def.key] ?? '';
    const common = {
      id,
      'aria-invalid': errors[def.key] ? true : undefined,
      'aria-describedby': errors[def.key] ? `${id}-err` : undefined
    } as const;
    const wide = def.type === 'textarea' || def.type === 'secretTextarea';
    let control: React.ReactNode;
    switch (def.type) {
      case 'password':
        control = <PasswordInput id={id} value={value} onChange={(v) => setField(def.key, v)} showStrength allowGenerate allowCopy invalid={!!errors[def.key]} />;
        break;
      case 'pin':
        control = <PasswordInput id={id} value={value} onChange={(v) => setField(def.key, v)} inputMode="numeric" allowCopy />;
        break;
      case 'secret':
        control = <PasswordInput id={id} value={value} onChange={(v) => setField(def.key, v)} allowCopy />;
        break;
      case 'secretTextarea':
        control = (
          <>
            <textarea
              {...common}
              className="textarea"
              style={{ minHeight: 220, fontFamily: 'var(--mono)', fontSize: 13 }}
              value={value}
              onChange={(e) => setField(def.key, e.target.value)}
              spellCheck={false}
            />
            <span className="help-text row-flex" style={{ gap: 6 }}>
              <ShieldCheck size={13} aria-hidden /> Encrypted at rest and hidden by default when viewing.
            </span>
          </>
        );
        break;
      case 'secretImage':
        // Legacy photo fields: photos are attachments now (migrated on unlock).
        return null;
      case 'textarea':
        control = (
          <textarea {...common} className="textarea" value={value} onChange={(e) => setField(def.key, e.target.value)} autoCapitalize="sentences" autoCorrect="on" spellCheck />
        );
        break;
      case 'select':
        control = (
          <select {...common} className="select" value={value} onChange={(e) => setField(def.key, e.target.value)}>
            <option value="">—</option>
            {(def.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
        break;
      default:
        control = (
          <input
            {...common}
            className="input"
            type={def.type === 'date' ? 'date' : def.type === 'email' ? 'email' : def.type === 'phone' ? 'tel' : def.type === 'url' ? 'url' : 'text'}
            value={value}
            onChange={(e) => setField(def.key, e.target.value)}
            placeholder={def.placeholder ?? (def.type === 'url' ? 'https://' : undefined)}
            // Keyboard suggestions are allowed for ordinary (non-secret) fields only;
            // secret fields use PasswordInput, which keeps them off.
            spellCheck={def.type === 'text'}
            autoCorrect={def.type === 'text' ? 'on' : 'off'}
            autoCapitalize={def.type === 'text' ? 'sentences' : 'none'}
            autoComplete="off"
          />
        );
    }
    return (
      <div key={def.key} className={`field ${wide ? 'span-2' : ''}`}>
        <label htmlFor={id}>{def.label}</label>
        {control}
        {fieldError(def.key)}
      </div>
    );
  };

  return (
    <Dialog
      title={isEdit ? 'Edit item' : 'Add new item'}
      onClose={onClose}
      size="wide"
      busy={busy}
      footer={
        <>
          <span className="left help-text desktop-only">Enter to save · Esc to cancel</span>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="entry-form" className="btn primary" disabled={busy || loading}>
            {busy && <span className="spinner" aria-hidden />}
            {isEdit ? 'Save changes' : 'Save securely'}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="empty">
          <span className="spinner" aria-label="Loading" />
        </div>
      ) : (
        <form
          id="entry-form"
          onSubmit={submit}
          noValidate
          onKeyDown={(e) => {
            // Ctrl+Enter submits even from inside a multi-line note.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <div className="grid-2">
            <div className="field">
              <label htmlFor="f-category">Category</label>
              <select id="f-category" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {snap.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-title">Title</label>
              <input
                id="f-title"
                className="input"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={categoryId === 'banking' ? 'e.g. BPI Savings Account' : 'e.g. GitHub'}
                aria-invalid={!!errors.title || undefined}
                aria-describedby={errors.title ? 'f-title-err' : duplicate ? 'f-title-dup' : undefined}
                data-autofocus
                autoComplete="off"
                autoCapitalize="sentences"
                autoCorrect="on"
                spellCheck
              />
              {fieldError('title')}
              {duplicate && !errors.title && (
                <span id="f-title-dup" className="help-text row-flex" style={{ gap: 6 }}>
                  <Info size={13} aria-hidden /> An item with this title already exists in {category?.name}.
                </span>
              )}
            </div>
            {(category?.fields ?? []).map(renderField)}
            <div className="field span-2">
              <label htmlFor="f-tags">Tags</label>
              <TagInput id="f-tags" tags={tags} onChange={setTags} />
            </div>
            <label className="checkbox span-2" style={{ marginBottom: 8 }}>
              <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
              <span>Add to favorites</span>
            </label>
            {state.mode === 'new' ? (
              <div className="field span-2">
                <span className="label">
                  <Paperclip size={12} aria-hidden style={{ verticalAlign: -1 }} /> Attachments
                </span>
                {pending.length > 0 && (
                  <ul className="list card" style={{ padding: 4, flex: 'none' }}>
                    {pending.map((a, i) => (
                      <li key={i} className="row-flex" style={{ gap: 8, padding: '4px 8px' }}>
                        {a.thumb && isImage(a.mime) ? (
                          <img src={a.thumb} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }} />
                        ) : (
                          <span className="row-icon">
                            <FileIcon size={16} aria-hidden />
                          </span>
                        )}
                        <span className="row-main">
                          <span className="row-title" style={{ display: 'block' }}>
                            {a.name}
                          </span>
                          <span className="row-sub" style={{ display: 'block' }}>
                            {formatBytes(Math.floor((a.data.length * 3) / 4))}
                          </span>
                        </span>
                        <button type="button" className="icon-btn" aria-label={`Remove ${a.name}`} onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>
                          <X size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div>
                  <button type="button" className="btn sm" onClick={() => setAddingFile(true)} disabled={readingFiles}>
                    {readingFiles ? <span className="spinner" aria-hidden /> : <Plus size={14} aria-hidden />} Add attachment
                  </button>
                </div>
                <span className="help-text">Photos, PDFs and documents are encrypted and saved with the item.</span>
              </div>
            ) : (
              <span className="help-text span-2">Add or remove attachments on the item's screen.</span>
            )}
          </div>
          {errors.form && (
            <div className="notice strong" role="alert" style={{ marginTop: 8 }}>
              <CircleAlert size={16} aria-hidden /> {errors.form}
            </div>
          )}
          {/* Hidden submit so Enter in single-line inputs saves the form. */}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      )}
      {addingFile && <AddAttachmentSheet onPick={(s) => void pickPending(s)} onClose={() => setAddingFile(false)} />}
      {confirmDuplicate && (
        <ConfirmDialog
          title="Possible duplicate"
          confirmLabel="Save anyway"
          message={
            <>
              An item named <strong style={{ color: 'var(--fg)' }}>{title.trim()}</strong> already exists in {category?.name}. Save this one as well?
            </>
          }
          onCancel={() => setConfirmDuplicate(false)}
          onConfirm={async () => {
            setConfirmDuplicate(false);
            await submit(undefined, true);
          }}
        />
      )}
    </Dialog>
  );
}
