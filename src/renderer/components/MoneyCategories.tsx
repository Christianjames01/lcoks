import { Pencil, Plus, RotateCcw, Trash } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CUSTOM_MONEY_ICONS, MONEY_CATEGORIES, isBuiltinCategory, isDefaultCategory, type MoneyCategory, type MoneyCategoryEdit, type MoneyIcon, type TxKind } from '../../shared/money';
import type { ActionItem } from './HoldActions';
import { api, errorMessage, unwrap } from '../lib/api';
import { MoneyIconOf } from '../views/Money';
import { ConfirmDialog, Dialog } from './Dialog';
import { useToast } from './Toast';

/** Add or edit one of the user's own Expenses categories. */
export function MoneyCategoryEditor({
  initial,
  kind,
  onClose,
  onSaved
}: {
  initial?: MoneyCategory;
  kind: TxKind;
  onClose: () => void;
  onSaved: (c: MoneyCategory) => void | Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState<MoneyIcon>(initial?.icon ?? 'tag');
  const [words, setWords] = useState(initial?.words.join(', ') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const k = initial?.kind ?? kind;
  const builtin = initial && isBuiltinCategory(initial.id) ? MONEY_CATEGORIES.find((c) => c.id === initial.id) : undefined;
  // A built-in keeps its own icon among the choices.
  const icons: MoneyIcon[] = builtin && !CUSTOM_MONEY_ICONS.includes(builtin.icon) ? [builtin.icon, ...CUSTOM_MONEY_ICONS] : [...CUSTOM_MONEY_ICONS];

  const save = async () => {
    if (!name.trim()) return setError('Give the category a name.');
    setBusy(true);
    try {
      const c = await unwrap(
        api.vault.saveMoneyCategory({
          ...(initial ? { id: initial.id } : {}),
          name: name.trim(),
          kind: k,
          icon,
          words: words.split(/[,\n]/).map((w) => w.trim()).filter(Boolean)
        })
      );
      toast(initial ? 'Category saved.' : `Category “${c.name}” added.`);
      await onSaved(c);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      placement="center"
      size="narrow"
      title={initial ? `Edit ${initial.name}` : k === 'income' ? 'New income category' : 'New expense category'}
      subtitle={builtin && builtin.name !== initial?.name ? `Built-in: ${builtin.name}` : undefined}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy && <span className="spinner" aria-hidden />}
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="mc-name">Name</label>
        <input
          id="mc-name"
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder={k === 'income' ? 'e.g. Tutoring' : 'e.g. Games, GCash cash out'}
          maxLength={30}
          autoComplete="off"
          data-autofocus
          aria-invalid={!!error}
        />
        {error && <span className="error-text">{error}</span>}
      </div>
      <div className="field">
        <span className="label">Icon</span>
        <div className="mc-icons" role="radiogroup" aria-label="Icon">
          {icons.map((i) => (
            <button key={i} type="button" role="radio" aria-checked={icon === i} className="mc-icon" onClick={() => setIcon(i)} aria-label={i}>
              <MoneyIconOf icon={i} size={18} />
            </button>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="mc-words">Quick-entry words (optional)</label>
        <input id="mc-words" className="input" value={words} onChange={(e) => setWords(e.target.value)} placeholder="e.g. ml, mobile legends, steam" maxLength={300} autoComplete="off" />
        <span className="help-text">Typing one of these in the quick box (“ml 200”) picks this category. Separate with commas.</span>
      </div>
    </Dialog>
  );
}

/** The user's categories in Budget & categories: add, edit, delete. */
export function MoneyCategoryList({ list, onChanged }: { list: readonly MoneyCategory[]; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [editing, setEditing] = useState<{ c?: MoneyCategory; kind: TxKind } | null>(null);
  const [deleting, setDeleting] = useState<MoneyCategory | null>(null);
  return (
    <div className="mc-list-wrap">
      <span className="label">Your categories</span>
      {list.length === 0 ? (
        <p className="help-text" style={{ margin: '4px 0 8px' }}>
          Add your own, like Games or GCash cash out. They show up when you add an expense.
        </p>
      ) : (
        <ul className="mc-list">
          {list.map((c) => (
            <li key={c.id}>
              <span className="bd-icon">
                <MoneyIconOf icon={c.icon} size={16} />
              </span>
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 600 }}>{c.name}</span>
                <span className="dim small">
                  {c.kind === 'income' ? 'Income' : 'Expense'}
                  {c.words.length ? ` · ${c.words.join(', ')}` : ''}
                </span>
              </span>
              <button type="button" className="icon-btn" onClick={() => setEditing({ c, kind: c.kind })} aria-label={`Edit ${c.name}`}>
                <Pencil size={15} />
              </button>
              <button type="button" className="icon-btn" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}>
                <Trash size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn sm" onClick={() => setEditing({ kind: 'expense' })}>
          <Plus size={14} aria-hidden /> Expense category
        </button>
        <button type="button" className="btn sm" onClick={() => setEditing({ kind: 'income' })}>
          <Plus size={14} aria-hidden /> Income category
        </button>
      </div>
      {editing && <MoneyCategoryEditor initial={editing.c} kind={editing.kind} onClose={() => setEditing(null)} onSaved={onChanged} />}
      {deleting && (
        <ConfirmDialog
          placement="center"
          title={`Delete “${deleting.name}”?`}
          danger
          confirmLabel="Delete"
          message={`Records in it move to ${deleting.kind === 'income' ? 'Other income' : 'Other'}. Nothing else is deleted.`}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              const moved = await unwrap(api.vault.deleteMoneyCategory(deleting.id));
              await onChanged();
              setDeleting(null);
              toast(moved ? `Category deleted. ${moved} record${moved === 1 ? '' : 's'} moved to Other.` : 'Category deleted.');
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Edit / Delete for any category (built-in or the user's own), e.g. from a long
 * press on its chip. Deleting moves its records to Other; "Other" itself stays.
 */
export function useCategoryActions(onChanged: () => Promise<void>, onDeleted?: (c: MoneyCategory) => void) {
  const toast = useToast();
  const [editing, setEditing] = useState<MoneyCategory | null>(null);
  const [deleting, setDeleting] = useState<MoneyCategory | null>(null);
  const itemsFor = (c: MoneyCategory): ActionItem[] => [
    { key: 'edit', label: `Edit ${c.name}`, icon: <Pencil size={16} aria-hidden />, run: () => setEditing(c) },
    ...(isDefaultCategory(c.id) ? [] : [{ key: 'delete', label: `Delete ${c.name}`, icon: <Trash size={16} aria-hidden />, danger: true, run: () => setDeleting(c) }])
  ];
  const dialogs: ReactNode = (
    <>
      {editing && <MoneyCategoryEditor initial={editing} kind={editing.kind} onClose={() => setEditing(null)} onSaved={onChanged} />}
      {deleting && (
        <ConfirmDialog
          placement="center"
          title={`Delete “${deleting.name}”?`}
          danger
          confirmLabel="Delete"
          message={
            isBuiltinCategory(deleting.id)
              ? `It is hidden from your categories and its records move to ${deleting.kind === 'income' ? 'Other income' : 'Other'}. You can bring it back in Budget & categories.`
              : `Records in it move to ${deleting.kind === 'income' ? 'Other income' : 'Other'}. Nothing else is deleted.`
          }
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              const c = deleting;
              const moved = await unwrap(api.vault.deleteMoneyCategory(c.id));
              await onChanged();
              setDeleting(null);
              onDeleted?.(c);
              toast(moved ? `${c.name} deleted. ${moved} record${moved === 1 ? '' : 's'} moved to Other.` : `${c.name} deleted.`);
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
    </>
  );
  return { itemsFor, dialogs };
}

/** Built-in categories the user renamed or deleted, with Restore. */
export function EditedBuiltins({ edits, onChanged }: { edits: Readonly<Record<string, MoneyCategoryEdit>>; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const changed = MONEY_CATEGORIES.filter((c) => edits[c.id]);
  if (!changed.length) return null;
  return (
    <div className="mc-list-wrap">
      <span className="label">Changed built-in categories</span>
      <ul className="mc-list">
        {changed.map((c) => {
          const e = edits[c.id]!;
          return (
            <li key={c.id}>
              <span className="bd-icon">
                <MoneyIconOf icon={e.icon ?? c.icon} size={16} />
              </span>
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 600 }}>{e.name ?? c.name}</span>
                <span className="dim small">{e.hidden ? 'Deleted' : e.name && e.name !== c.name ? `Was ${c.name}` : 'Changed'}</span>
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={async () => {
                  try {
                    await unwrap(api.vault.restoreMoneyCategory(c.id));
                    await onChanged();
                    toast(`${c.name} restored.`);
                  } catch (err) {
                    toast(errorMessage(err), 'error');
                  }
                }}
              >
                <RotateCcw size={14} aria-hidden /> Restore
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
