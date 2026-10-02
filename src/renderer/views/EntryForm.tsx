import { CircleAlert, Info, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { EntryView, FieldDef, VaultSnapshot } from '../../shared/types';
import { Dialog } from '../components/Dialog';
import { PasswordInput } from '../components/PasswordInput';
import { TagInput } from '../components/TagInput';
import { ApiError, api, errorMessage, unwrap } from '../lib/api';
import type { EditorState } from './VaultApp';

interface Props {
  state: NonNullable<EditorState>;
  snap: VaultSnapshot;
  onClose: () => void;
  onSaved: (view: EntryView) => void | Promise<void>;
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
  const [tags, setTags] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    };
  }, [state]);

  const category = snap.categories.find((c) => c.id === categoryId);

  const duplicate = useMemo(() => {
    const t = title.trim().toLowerCase();
    if (!t) return false;
    return snap.entries.some((e) => e.categoryId === categoryId && e.title.trim().toLowerCase() === t && (state.mode === 'new' || e.id !== state.id));
  }, [title, categoryId, snap.entries, state]);

  const setField = (key: string, v: string) => setFields((f) => ({ ...f, [key]: v }));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || loading) return;
    const errs: Record<string, string> = {};
    let finalTitle = title.trim();
    if (!finalTitle && TITLE_SOURCE[categoryId] && fields[TITLE_SOURCE[categoryId]!]?.trim()) {
      finalTitle = fields[TITLE_SOURCE[categoryId]!]!.trim();
    }
    if (!finalTitle) errs.title = 'Give this item a title.';
    for (const def of category?.fields ?? []) {
      const v = fields[def.key] ?? '';
      if (def.type === 'email' && v && !/^[^\s@]+@[^\s@]+$/.test(v)) errs[def.key] = 'Enter a valid email address.';
      if (def.type === 'url' && v && /^\s*(javascript|data|vbscript|file):/i.test(v)) errs[def.key] = 'This URL scheme is not allowed.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    // Only send fields defined on the selected category.
    const payload: Record<string, string> = {};
    for (const def of category?.fields ?? []) if (fields[def.key]) payload[def.key] = fields[def.key]!;

    setBusy(true);
    try {
      const view = await unwrap(
        api.vault.saveEntry({ id: state.mode === 'edit' ? state.id : undefined, categoryId, title: finalTitle, fields: payload, tags, favorite })
      );
      setFields({});
      await onSaved(view);
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
    </Dialog>
  );
}
