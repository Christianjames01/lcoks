import { ArrowDown, ArrowLeft, ArrowUp, Copy, CopyPlus, ExternalLink, Eye, EyeOff, Pencil, Plus, Search, Star, Trash } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { subtitleFor } from '../../shared/categories';
import { isSecretType, type EntryView, type FavoriteSort, type FieldDef, type VaultSnapshot } from '../../shared/types';
import { BankCard } from '../components/BankCard';
import { BankIcon, isBankItem } from '../components/BankIcon';
import { CategoryIcon } from '../components/Icon';
import { StrengthMeter } from '../components/StrengthMeter';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { useTimeout } from '../lib/hooks';

interface Props {
  snap: VaultSnapshot;
  filter: string;
  query: string;
  entries: EntryView[];
  /** Phone layout: list and detail are separate screens. */
  mobile?: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (e: EntryView) => void;
  onChanged: () => Promise<void>;
}

function filterTitle(snap: VaultSnapshot, filter: string, query: string): string {
  if (query.trim()) return 'Search results';
  if (filter === 'all') return 'All items';
  if (filter === 'favorites') return 'Favorites';
  if (filter === 'weak') return 'Weak passwords';
  if (filter.startsWith('tag:')) return `#${filter.slice(4)}`;
  return snap.categories.find((c) => c.id === filter.slice(4))?.name ?? 'Items';
}

export function ItemsView({ snap, filter, query, entries, mobile, selectedId, onSelect, onNew, onEdit, onDelete, onChanged }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const toast = useToast();
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const manualFavorites = filter === 'favorites' && snap.settings.favoriteSort === 'manual' && !query.trim();

  // Keep a valid selection when the list changes.
  useEffect(() => {
    if (!mobile && !selected && entries.length > 0 && !query.trim()) onSelect(entries[0]!.id);
  }, [entries, selected, onSelect, query, mobile]);

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || entries.length === 0) return;
    e.preventDefault();
    const idx = entries.findIndex((x) => x.id === selectedId);
    let next = idx;
    if (e.key === 'ArrowDown') next = Math.min(entries.length - 1, idx + 1);
    if (e.key === 'ArrowUp') next = Math.max(0, idx - 1);
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = entries.length - 1;
    const id = entries[next]!.id;
    onSelect(id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus());
  };

  const move = async (id: string, dir: -1 | 1) => {
    const ids = entries.map((e) => e.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    try {
      await unwrap(api.vault.reorderFavorites(ids));
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const setSort = async (mode: FavoriteSort) => {
    await api.vault.updateSettings({ favoriteSort: mode });
    await onChanged();
  };

  return (
    <div className={`items-layout ${mobile ? (selected ? 'stack show-detail' : 'stack') : ''}`}>
      <section className="list-pane" aria-label={filterTitle(snap, filter, query)}>
        <div className="list-head">
          <div className="list-head-row">
            <h2 className="h3" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {filterTitle(snap, filter, query)}
            </h2>
            <span className="dim small">{entries.length}</span>
          </div>
          {filter === 'favorites' && !query.trim() && (
            <div className="segmented" role="group" aria-label="Sort favorites">
              {(['manual', 'name', 'updated'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={snap.settings.favoriteSort === m} onClick={() => setSort(m)}>
                  {m === 'manual' ? 'Manual' : m === 'name' ? 'Name' : 'Recent'}
                </button>
              ))}
            </div>
          )}
        </div>
        {entries.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">{query.trim() ? <Search size={20} aria-hidden /> : <Plus size={20} aria-hidden />}</div>
            <div className="h3">{query.trim() ? 'No matches' : 'Nothing here yet'}</div>
            <div className="muted small">
              {query.trim() ? 'Search covers titles, usernames, websites, categories, notes and tags.' : 'Add an item to get started.'}
            </div>
            {!query.trim() && filter !== 'favorites' && filter !== 'weak' && (
              <button type="button" className="btn sm" onClick={onNew}>
                <Plus size={14} aria-hidden /> New item
              </button>
            )}
          </div>
        ) : (
          <ul ref={listRef} className="list" role="listbox" aria-label="Items" onKeyDown={onListKey}>
            {entries.map((e, i) => {
              const cat = snap.categories.find((c) => c.id === e.categoryId);
              const isSel = e.id === selectedId;
              return (
                <li key={e.id} className="row-flex" style={{ gap: 2 }}>
                  <button
                    type="button"
                    className="row"
                    role="option"
                    aria-selected={isSel}
                    data-id={e.id}
                    tabIndex={isSel || (!selected && i === 0) ? 0 : -1}
                    onClick={() => onSelect(e.id)}
                  >
                    {isBankItem(e.categoryId) ? (
                      <BankIcon bankName={e.fields.bankName} title={e.title} />
                    ) : (
                      <span className="row-icon">
                        <CategoryIcon icon={cat?.icon} />
                      </span>
                    )}
                    <span className="row-main">
                      <span className="row-title" style={{ display: 'block' }}>
                        {e.title}
                      </span>
                      <span className="row-sub" style={{ display: 'block' }}>
                        {subtitleFor(cat, e.fields)}
                        {e.secrets.cardNumber?.preview ? ` · ${e.secrets.cardNumber.preview}` : ''}
                      </span>
                    </span>
                    {e.favorite && (
                      <span className="row-end">
                        <Star size={13} className="star" fill="currentColor" aria-label="Favorite" />
                      </span>
                    )}
                  </button>
                  {manualFavorites && (
                    <span className="stack" style={{ gap: 0 }}>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ height: 22 }}
                        disabled={i === 0}
                        onClick={() => move(e.id, -1)}
                        aria-label={`Move ${e.title} up`}
                        title="Move up"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ height: 22 }}
                        disabled={i === entries.length - 1}
                        onClick={() => move(e.id, 1)}
                        aria-label={`Move ${e.title} down`}
                        title="Move down"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="detail" aria-label="Item details">
        {selected ? (
          <EntryDetail
            key={selected.id}
            onBack={mobile ? () => onSelect(null) : undefined}
            entry={selected}
            snap={snap}
            onEdit={() => onEdit(selected.id)}
            onDelete={() => onDelete(selected)}
            onChanged={onChanged}
            onSelect={onSelect}
          />
        ) : (
          <div className="empty" style={{ height: '100%' }}>
            <div className="muted">Select an item to view its details.</div>
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ detail --

function EntryDetail({
  entry,
  snap,
  onEdit,
  onDelete,
  onChanged,
  onSelect,
  onBack
}: {
  onBack?: () => void;
  entry: EntryView;
  snap: VaultSnapshot;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => Promise<void>;
  onSelect: (id: string) => void;
}) {
  const toast = useToast();
  const category = snap.categories.find((c) => c.id === entry.categoryId);

  const toggleFavorite = async () => {
    try {
      await unwrap(api.vault.setFavorite(entry.id, !entry.favorite));
      await onChanged();
      toast(entry.favorite ? 'Removed from favorites.' : 'Added to favorites.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const duplicate = async () => {
    try {
      const copy = await unwrap(api.vault.duplicateEntry(entry.id));
      await onChanged();
      onSelect(copy.id);
      toast('Item duplicated.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <div className="detail-inner">
      {onBack && (
        <button type="button" className="btn ghost sm" style={{ marginBottom: 12, marginLeft: -10 }} onClick={onBack}>
          <ArrowLeft size={15} aria-hidden /> Back
        </button>
      )}
      <div className="detail-head">
        {isBankItem(entry.categoryId) ? (
          <BankIcon bankName={entry.fields.bankName} title={entry.title} size={48} radius={10} />
        ) : (
          <span className="row-icon">
            <CategoryIcon icon={category?.icon} size={22} />
          </span>
        )}
        <div className="grow">
          <div className="label">{category?.name ?? 'Item'}</div>
          <h1 className="h1 selectable" style={{ marginTop: 4 }}>
            {entry.title}
          </h1>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className={`icon-btn ${entry.favorite ? 'on' : ''}`}
            onClick={toggleFavorite}
            aria-pressed={entry.favorite}
            aria-label={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
            title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star size={17} fill={entry.favorite ? 'currentColor' : 'none'} />
          </button>
          <button type="button" className="icon-btn" onClick={duplicate} aria-label="Duplicate item" title="Duplicate">
            <CopyPlus size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={onEdit} aria-label="Edit item" title="Edit">
            <Pencil size={16} />
          </button>
        </div>
      </div>

      {(entry.categoryId === 'cards' || (entry.categoryId === 'banking' && (entry.secrets.accountNumber?.set || entry.fields.bankName))) && (
        <BankCard entry={entry} revealSeconds={snap.settings.revealTimeoutSeconds} />
      )}

      {(category?.fields ?? []).map((def) => (
        <DetailField key={def.key} entry={entry} def={def} snap={snap} />
      ))}

      {entry.tags.length > 0 && (
        <div className="dfield">
          <span className="label">Tags</span>
          <div className="tags">
            {entry.tags.map((t) => (
              <span key={t} className="tag" style={{ cursor: 'default' }}>
                #{t}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="dim small" style={{ marginTop: 14 }}>
        Created {formatDateTime(entry.createdAt)} · Updated {formatDateTime(entry.updatedAt)}
      </div>

      <div className="detail-foot">
        <button type="button" className="btn" onClick={onEdit}>
          <Pencil size={15} aria-hidden /> Edit
        </button>
        <button type="button" className="btn danger" onClick={onDelete}>
          <Trash size={15} aria-hidden /> Delete
        </button>
      </div>
    </div>
  );
}

function DetailField({ entry, def, snap }: { entry: EntryView; def: FieldDef; snap: VaultSnapshot }) {
  if (isSecretType(def.type)) return <SecretField entry={entry} def={def} revealSeconds={snap.settings.revealTimeoutSeconds} />;
  const value = entry.fields[def.key];
  if (!value) return null;
  return <PlainField def={def} value={value} />;
}

function PlainField({ def, value }: { def: FieldDef; value: string }) {
  const toast = useToast();
  const copyable = ['username', 'email', 'text', 'phone', 'url'].includes(def.type);
  const copy = async () => {
    try {
      const { seconds } = await unwrap(api.vault.copyText(value));
      toast(`${def.label} copied. Clipboard clears in ${seconds}s.`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  let content: React.ReactNode = value;
  if (def.type === 'url') {
    content = (
      <a
        href="#"
        onClick={async (e) => {
          e.preventDefault();
          const r = await api.app.openExternal(value);
          if (!r.ok) toast(r.message, 'error');
        }}
        title="Open in your browser"
      >
        {value} <ExternalLink size={12} aria-hidden style={{ verticalAlign: -1 }} />
      </a>
    );
  } else if (def.type === 'date') {
    content = formatDate(value);
  }
  return (
    <div className="dfield">
      <span className="label">{def.label}</span>
      <div className={`value ${def.type === 'textarea' ? 'pre' : ''}`}>{content}</div>
      {copyable && (
        <div className="tools">
          <button type="button" className="icon-btn" onClick={copy} aria-label={`Copy ${def.label}`} title={`Copy ${def.label}`}>
            <Copy size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Secret value: hidden by default. Reveal fetches the value from the main process
 * on demand and hides it again automatically after the configured timeout.
 * Copying never sends the value to the renderer at all.
 */
function SecretField({ entry, def, revealSeconds }: { entry: EntryView; def: FieldDef; revealSeconds: number }) {
  const meta = entry.secrets[def.key];
  const [revealed, setRevealed] = useState<string | null>(null);
  const toast = useToast();

  useTimeout(revealed !== null, revealSeconds * 1000, () => setRevealed(null));
  // Drop revealed value when unmounting.
  useEffect(() => () => setRevealed(null), []);

  if (!meta?.set) return null;

  const reveal = async () => {
    if (revealed !== null) return setRevealed(null);
    try {
      setRevealed(await unwrap(api.vault.reveal(entry.id, def.key)));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const copy = async () => {
    try {
      const { seconds } = await unwrap(api.vault.copyField(entry.id, def.key));
      toast(`${def.label} copied. Clipboard clears in ${seconds}s.`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const long = def.type === 'secretTextarea';
  const masked = meta.preview ?? (def.type === 'pin' ? '••••' : long ? '•••••••••••••••• (hidden)' : '••••••••••••••••');

  return (
    <div className="dfield">
      <span className="label">{def.label}</span>
      <div
        className={`value ${revealed === null ? 'masked' : long ? 'pre' : 'mono'}`}
        aria-label={revealed === null ? `${def.label} hidden` : undefined}
        aria-live="polite"
      >
        {revealed === null ? masked : revealed}
      </div>
      <div className="tools">
        <button
          type="button"
          className={`icon-btn ${revealed !== null ? 'on' : ''}`}
          onClick={reveal}
          aria-pressed={revealed !== null}
          aria-label={revealed !== null ? `Hide ${def.label}` : `Show ${def.label}`}
          title={revealed !== null ? 'Hide' : revealSeconds ? `Show (auto-hides after ${revealSeconds}s)` : 'Show'}
        >
          {revealed !== null ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button type="button" className="icon-btn" onClick={copy} aria-label={`Copy ${def.label}`} title={`Copy ${def.label}`}>
          <Copy size={15} />
        </button>
      </div>
      {def.type === 'password' && meta.strength !== undefined && (
        <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
          <StrengthMeter score={meta.strength} />
        </div>
      )}
    </div>
  );
}

