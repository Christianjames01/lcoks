import { GiftCardPanel } from '../components/GiftCardPanel';
import { WifiShare } from '../components/WifiShare';
import { GIFT_CATEGORY, daysToExpiry, parseAmountText } from '../../shared/giftcards';
import { formatMoney } from '../../shared/money';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, CopyPlus, ExternalLink, Eye, EyeOff, Lock, Maximize2, Paperclip, Pencil, Plus, Star, Trash } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { subtitleFor } from '../../shared/categories';
import { isSecretType, type EntryView, type FavoriteSort, type FieldDef, type VaultSnapshot } from '../../shared/types';
import { AttachmentsSection } from '../components/Attachments';
import { BankCard } from '../components/BankCard';
import { EmptyState } from '../components/EmptyState';
import { GestureRow } from '../components/EntryActions';
import { EntryIcon } from '../components/EntryIcon';
import { CountdownRing, LargeReveal } from '../components/LargeReveal';
import { cardSpec, isCardCategory } from '../lib/cardSpec';
import { StrengthMeter } from '../components/StrengthMeter';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { useTimeout } from '../lib/hooks';
import { morphOpen } from '../lib/motion';
import { markUsed, useRecentlyUsed } from '../lib/recent';
import type { Route } from './VaultApp';

import { tr } from '../../shared/i18n';
type ListSort = 'name' | 'used' | 'updated' | 'created' | 'category';
const SORTS: [ListSort, string][] = [
  ['name', tr("Name (A–Z)")],
  ['used', tr("Recently used")],
  ['updated', tr("Recently updated")],
  ['created', tr("Recently added")],
  ['category', tr("Category")]
];

const SORT_KEY = 'vaultlocks.sort';
function loadSort(): ListSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return SORTS.some(([k]) => k === v) ? (v as ListSort) : 'name';
  } catch {
    return 'name';
  }
}

/** A–Z grouping starts once a list is long enough to need it. */
const GROUP_MIN = 8;
const INDEX_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'];
const letterOf = (title: string) => {
  const c = title.trim().charAt(0).normalize('NFD').charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

interface Props {
  snap: VaultSnapshot;
  filter: string;
  query: string;
  entries: EntryView[];
  /** Phone layout: list and detail are separate screens. */
  mobile?: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Phone: leave the detail screen (Android Back behaves the same). */
  onBack: () => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (e: EntryView) => void;
  onChanged: () => Promise<void>;
  onNavigate: (r: Route) => void;
}

function filterTitle(snap: VaultSnapshot, filter: string, query: string): string {
  if (query.trim()) return 'Search results';
  if (filter === 'all') return 'All items';
  if (filter === 'favorites') return 'Favorites';
  if (filter === 'weak') return 'Weak passwords';
  if (filter === 'reused') return 'Reused passwords';
  if (filter === 'old') return 'Old passwords';
  if (filter.startsWith('tag:')) return `#${filter.slice(4)}`;
  return snap.categories.find((c) => c.id === filter.slice(4))?.name ?? 'Items';
}

export function ItemsView({ snap, filter, query, entries: input, mobile, selectedId, onSelect, onBack, onNew, onEdit, onDelete, onChanged }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const toast = useToast();
  const used = useRecentlyUsed();
  const [sort, setSortMode] = useState<ListSort>(loadSort);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const searching = query.trim().length > 0;
  const sortable = filter !== 'favorites' && !searching;

  // Tag chips: the tags used by items in this list, most used first.
  const tagChips = useMemo(() => {
    if (filter.startsWith('tag:')) return [];
    const counts = new Map<string, number>();
    for (const e of input) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20);
  }, [input, filter]);
  useEffect(() => setActiveTag(null), [filter]);
  const tag = activeTag && tagChips.some(([t]) => t === activeTag) ? activeTag : null;

  const entries = useMemo(() => {
    const list = tag ? input.filter((e) => e.tags.includes(tag)) : input;
    if (!sortable || sort === 'name') return list;
    const out = [...list];
    if (sort === 'used') out.sort((a, b) => (used[b.id] ?? 0) - (used[a.id] ?? 0));
    else if (sort === 'updated') out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    else if (sort === 'created') out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === 'category') {
      const order = new Map(snap.categories.map((c, i) => [c.id, i]));
      out.sort((a, b) => (order.get(a.categoryId) ?? 999) - (order.get(b.categoryId) ?? 999));
    }
    return out;
  }, [input, tag, sort, sortable, used, snap.categories]);

  // Section headers: letters for A–Z, category names for Category.
  const grouping: 'letter' | 'category' | null = !sortable ? null : sort === 'category' ? 'category' : sort === 'name' && entries.length >= GROUP_MIN ? 'letter' : null;
  const groupOf = (e: EntryView) =>
    grouping === 'letter' ? letterOf(e.title) : (snap.categories.find((c) => c.id === e.categoryId)?.name ?? 'Other');
  const letters = useMemo(() => new Set(grouping === 'letter' ? entries.map((e) => letterOf(e.title)) : []), [entries, grouping]);

  // An item opened from elsewhere (dashboard, search) may not be in this list.
  const selected = entries.find((e) => e.id === selectedId) ?? (mobile && selectedId ? (snap.entries.find((e) => e.id === selectedId) ?? null) : null);
  const manualFavorites = filter === 'favorites' && snap.settings.favoriteSort === 'manual' && !searching;

  // Keep a valid selection when the list changes.
  useEffect(() => {
    if (!mobile && !selected && entries.length > 0 && !searching) onSelect(entries[0]!.id);
  }, [entries, selected, onSelect, searching, mobile]);

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

  const open = (id: string, row: Element) => {
    markUsed(id);
    if (mobile) morphOpen(row, () => onSelect(id));
    else onSelect(id);
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

  const setFavSort = async (mode: FavoriteSort) => {
    await api.vault.updateSettings({ favoriteSort: mode });
    await onChanged();
  };

  const changeSort = (v: ListSort) => {
    setSortMode(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const empty = (() => {
    if (searching) return <EmptyState art="search" title={tr("No matches")} text={tr("Search covers titles, usernames, websites, categories, notes and tags.")} />;
    if (filter === 'favorites')
      return <EmptyState art="favorites" title={tr("No favorites yet")} text={tr("Open an item and tap the star (or long-press a row) to keep it here.")} />;
    if (filter === 'weak' || filter === 'reused' || filter === 'old')
      return <EmptyState art="secure" title={tr("Nothing to fix")} text={tr("None of your passwords are in this list. Nice work.")} />;
    return (
      <EmptyState
        art="category"
        title={tr("Nothing here yet")}
        text={filter.startsWith('tag:') ? tr("No items have this tag any more.") : tr("Add an item and it will show up here.")}
        action={
          !filter.startsWith('tag:') && (
            <button type="button" className="btn primary sm" onClick={onNew}>
              <Plus size={14} aria-hidden /> {tr("New item")}
            </button>
          )
        }
      />
    );
  })();

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
          {filter === `cat:${GIFT_CATEGORY}` && !searching && entries.length > 0 && (() => {
            const left = entries.reduce((sum, e) => sum + (parseAmountText(e.fields.balance) ?? 0), 0);
            const soon = entries.filter((e) => {
              const d = daysToExpiry(e.fields.expiryDate);
              return d !== null && d >= 0 && d <= 30 && (parseAmountText(e.fields.balance) ?? 1) > 0;
            }).length;
            return (
              <div className="gift-summary">
                <span className="grow">
                  <span className="label">{tr("Left on")} {entries.length} {tr("card")}{entries.length === 1 ? '' : 's'}</span>
                  <span className="gift-summary-total">{formatMoney(left, snap.settings.currency)}</span>
                </span>
                {soon > 0 && <span className="vl-pill warn">{soon} {tr("expire")}{soon === 1 ? 's' : ''} {tr("soon")}</span>}
              </div>
            );
          })()}
          {sortable && input.length > 1 && (
            <div className="list-tools">
              <label htmlFor="sort" className="sr-only">
                {tr("Sort items")}
              </label>
              <select id="sort" className="select" value={sort} onChange={(e) => changeSort(e.target.value as ListSort)}>
                {SORTS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {tr("Sort:")} {label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {filter === 'favorites' && !searching && (
            <div className="segmented" role="group" aria-label={tr("Sort favorites")}>
              {(['manual', 'name', 'updated'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={snap.settings.favoriteSort === m} onClick={() => setFavSort(m)}>
                  {m === 'manual' ? tr("Manual") : m === 'name' ? tr("Name") : tr("Recent")}
                </button>
              ))}
            </div>
          )}
          {tagChips.length > 0 && !searching && (
            <div className="tag-chips" role="group" aria-label={tr("Filter by tag")}>
              {tagChips.map(([t, n]) => (
                <button key={t} type="button" className="tchip" aria-pressed={tag === t} onClick={() => setActiveTag(tag === t ? null : t)}>
                  #{t} <span className="tchip-n">{n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {entries.length === 0 ? (
          empty
        ) : (
          <div className="list-wrap">
            <ul ref={listRef} className={`list ${grouping === 'letter' && mobile ? 'with-index' : ''}`} role="listbox" aria-label={tr("Items")} onKeyDown={onListKey}>
              {entries.map((e, i) => {
                const cat = snap.categories.find((c) => c.id === e.categoryId);
                const isSel = e.id === selectedId;
                const group = grouping ? groupOf(e) : null;
                const newGroup = group !== null && (i === 0 || groupOf(entries[i - 1]!) !== group);
                return (
                  <Fragment key={e.id}>
                    {newGroup && (
                      <li role="presentation" className="list-group-head" data-group={group}>
                        {group}
                      </li>
                    )}
                    <li className="row-flex" style={{ gap: 2 }}>
                      <GestureRow entry={e} swipe={!!mobile && !manualFavorites}>
                        <button
                          type="button"
                          className="row"
                          role="option"
                          aria-selected={isSel}
                          data-id={e.id}
                          tabIndex={isSel || (!selected && i === 0) ? 0 : -1}
                          onClick={(ev) => open(e.id, ev.currentTarget)}
                        >
                          <EntryIcon entry={e} category={cat} />
                          <span className="row-main">
                            <span className="row-title" data-vt="title" style={{ display: 'block' }}>
                              {e.title}
                            </span>
                            <span className="row-sub" style={{ display: 'block' }}>
                              {e.categoryId === 'notes' ? (
                                // The note body is a secret: show that it is locked, never a preview of it.
                                <>
                                  <Lock size={11} aria-hidden className="inline-lock" />
                                  {tr("Encrypted note ·")} {formatDate(e.updatedAt)}
                                </>
                              ) : (
                                e.categoryId === GIFT_CATEGORY && parseAmountText(e.fields.balance) !== null ? (
                                <>
                                  {formatMoney(parseAmountText(e.fields.balance)!, snap.settings.currency)} {tr("left")}
                                  {e.fields.expiryDate ? tr(" · until {0}", [formatDate(e.fields.expiryDate)]) : ''}
                                </>
                              ) : (
                                <>
                                  {subtitleFor(cat, e.fields)}
                                  {e.secrets.cardNumber?.preview ? ` · ${e.secrets.cardNumber.preview}` : ''}
                                </>
                              ))}
                            </span>
                          </span>
                          {(e.favorite || e.attachmentCount > 0) && (
                            <span className="row-end">
                              {e.attachmentCount > 0 && <Paperclip size={13} aria-label={tr("{0} attachment(s)", [e.attachmentCount])} />}
                              {e.favorite && <Star size={13} className="star" fill="currentColor" aria-label={tr("Favorite")} />}
                            </span>
                          )}
                        </button>
                      </GestureRow>
                      {manualFavorites && (
                        <span className="stack" style={{ gap: 0 }}>
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ height: 22 }}
                            disabled={i === 0}
                            onClick={() => move(e.id, -1)}
                            aria-label={tr("Move {0} up", [e.title])}
                            title={tr("Move up")}
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ height: 22 }}
                            disabled={i === entries.length - 1}
                            onClick={() => move(e.id, 1)}
                            aria-label={tr("Move {0} down", [e.title])}
                            title={tr("Move down")}
                          >
                            <ArrowDown size={13} />
                          </button>
                        </span>
                      )}
                    </li>
                  </Fragment>
                );
              })}
            </ul>
            {grouping === 'letter' && mobile && <LetterIndex present={letters} listRef={listRef} />}
          </div>
        )}
      </section>

      <section className="detail" aria-label={tr("Item details")}>
        {selected ? (
          <EntryDetail
            key={selected.id}
            onBack={mobile ? onBack : undefined}
            entry={selected}
            snap={snap}
            onEdit={() => onEdit(selected.id)}
            onDelete={() => onDelete(selected)}
            onChanged={onChanged}
            onSelect={onSelect}
          />
        ) : (
          <div className="empty" style={{ height: '100%' }}>
            <div className="muted">{tr("Select an item to view its details.")}</div>
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------ A–Z index --

/** Phone: letters down the right edge; tap or slide to jump to a section. */
function LetterIndex({ present, listRef }: { present: Set<string>; listRef: React.RefObject<HTMLUListElement | null> }) {
  const [active, setActive] = useState<string | null>(null);
  const last = useRef<string | null>(null);

  const jump = (letter: string) => {
    // Missing letter: go to the next one that exists, else the previous.
    const i = INDEX_LETTERS.indexOf(letter);
    const target = INDEX_LETTERS.slice(i).find((l) => present.has(l)) ?? [...INDEX_LETTERS.slice(0, i)].reverse().find((l) => present.has(l));
    if (!target) return;
    setActive(letter);
    if (last.current === target) return;
    last.current = target;
    api.app.haptic('tap');
    // Headers are sticky, so measure the first row under the header instead of the header itself.
    const list = listRef.current;
    const head = list?.querySelector<HTMLElement>(`[data-group="${CSS.escape(target)}"]`);
    const first = head?.nextElementSibling as HTMLElement | null | undefined;
    if (list && head && first) list.scrollTop += first.getBoundingClientRect().top - list.getBoundingClientRect().top - head.offsetHeight - 6;
  };
  const fromPoint = (e: PointerEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const l = el?.dataset.letter;
    if (l) jump(l);
  };
  const end = () => {
    setActive(null);
    last.current = null;
  };

  return (
    <div
      className="letter-index"
      aria-hidden
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        fromPoint(e);
      }}
      onPointerMove={(e) => e.buttons && fromPoint(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {INDEX_LETTERS.map((l) => (
        <span key={l} data-letter={l} className={present.has(l) ? '' : 'off'}>
          {l}
        </span>
      ))}
      {active && <span className="letter-bubble">{active}</span>}
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
      api.app.haptic('tap');
      await onChanged();
      toast(entry.favorite ? tr("Removed from favorites.") : tr("Added to favorites."));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const duplicate = async () => {
    try {
      const copy = await unwrap(api.vault.duplicateEntry(entry.id));
      await onChanged();
      onSelect(copy.id);
      toast(tr("Item duplicated."));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <div className="detail-inner">
      {onBack && (
        <button type="button" className="btn ghost sm" style={{ marginBottom: 12, marginLeft: -10 }} onClick={onBack}>
          <ArrowLeft size={15} aria-hidden /> {tr("Back")}
        </button>
      )}
      <div className="detail-head">
        <EntryIcon entry={entry} category={category} size={48} />
        <div className="grow">
          <div className="label">{category?.name ?? tr("Item")}</div>
          <h1 className="h1 selectable" data-vt="title" style={{ marginTop: 4 }}>
            {entry.title}
          </h1>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className={`icon-btn ${entry.favorite ? 'on' : ''}`}
            onClick={toggleFavorite}
            aria-pressed={entry.favorite}
            aria-label={entry.favorite ? tr("Remove from favorites") : tr("Add to favorites")}
            title={entry.favorite ? tr("Remove from favorites") : tr("Add to favorites")}
          >
            <Star size={17} fill={entry.favorite ? 'currentColor' : 'none'} />
          </button>
          <button type="button" className="icon-btn" onClick={duplicate} aria-label={tr("Duplicate item")} title={tr("Duplicate")}>
            <CopyPlus size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={onEdit} aria-label={tr("Edit item")} title={tr("Edit")}>
            <Pencil size={16} />
          </button>
        </div>
      </div>

      {(() => {
        const spec = cardSpec(entry, snap.settings.currency);
        return spec ? <BankCard entry={entry} spec={spec} revealSeconds={snap.settings.revealTimeoutSeconds} /> : null;
      })()}

      <WifiShare entry={entry} />
      <GiftCardPanel entry={entry} snap={snap} onChanged={onChanged} />

      {(category?.fields ?? [])
        // A gift card's use history is shown by GiftCardPanel.
        .filter((def) => !(entry.categoryId === GIFT_CATEGORY && def.key === 'history'))
        .map((def) => (
          <DetailField key={def.key} entry={entry} def={def} snap={snap} />
        ))}

      <AttachmentsSection
        entryId={entry.id}
        expected={entry.attachmentCount}
        cardRoles={isCardCategory(entry.categoryId)}
        hidePreviews={snap.settings.hidePreviews}
        onChanged={onChanged}
      />

      {entry.tags.length > 0 && (
        <div className="dfield">
          <span className="label">{tr("Tags")}</span>
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
        {tr("Created")} {formatDateTime(entry.createdAt)} {tr("· Updated")} {formatDateTime(entry.updatedAt)}
      </div>

      <div className="detail-foot">
        <button type="button" className="btn" onClick={onEdit}>
          <Pencil size={15} aria-hidden /> {tr("Edit")}
        </button>
        <button type="button" className="btn danger" onClick={onDelete}>
          <Trash size={15} aria-hidden /> {tr("Delete")}
        </button>
      </div>
    </div>
  );
}

function DetailField({ entry, def, snap }: { entry: EntryView; def: FieldDef; snap: VaultSnapshot }) {
  if (def.type === 'secretImage') return null; // legacy card photos now live in attachments
  if (isSecretType(def.type)) return <SecretField entry={entry} def={def} revealSeconds={snap.settings.revealTimeoutSeconds} />;
  const value = entry.fields[def.key];
  if (!value) return null;
  return <PlainField entryId={entry.id} def={def} value={value} />;
}

function PlainField({ entryId, def, value }: { entryId: string; def: FieldDef; value: string }) {
  const toast = useToast();
  const copyable = ['username', 'email', 'text', 'phone', 'url'].includes(def.type);
  const copy = async () => {
    try {
      const { seconds } = await unwrap(api.vault.copyText(value));
      markUsed(entryId);
      api.app.haptic('success');
      toast(tr("{0} copied. Clipboard clears in {1}s.", [def.label, seconds]));
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
          markUsed(entryId);
          const r = await api.app.openExternal(value);
          if (!r.ok) toast(r.message, 'error');
        }}
        title={tr("Open in your browser")}
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
          <button type="button" className="icon-btn" onClick={copy} aria-label={tr("Copy {0}", [def.label])} title={tr("Copy {0}", [def.label])}>
            <Copy size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Secret value: hidden by default. Reveal fetches the value from the main process
 * on demand and hides it again automatically after the configured timeout (a ring
 * on the eye button shows the time left). Copying never sends the value to the
 * renderer at all.
 */
function SecretField({ entry, def, revealSeconds }: { entry: EntryView; def: FieldDef; revealSeconds: number }) {
  const meta = entry.secrets[def.key];
  const [revealed, setRevealed] = useState<string | null>(null);
  // Bumped on every reveal so the countdown ring restarts.
  const [revealCount, setRevealCount] = useState(0);
  const [large, setLarge] = useState<string | null>(null);
  const toast = useToast();

  useTimeout(revealed !== null, revealSeconds * 1000, () => setRevealed(null));
  // Drop revealed values when unmounting.
  useEffect(
    () => () => {
      setRevealed(null);
      setLarge(null);
    },
    []
  );

  if (!meta?.set) return null;

  const fetchValue = () => unwrap(api.vault.reveal(entry.id, def.key));
  const reveal = async () => {
    if (revealed !== null) return setRevealed(null);
    try {
      setRevealed(await fetchValue());
      setRevealCount((n) => n + 1);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const showLarge = async () => {
    try {
      setLarge(revealed ?? (await fetchValue()));
      setRevealed(null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const copy = async () => {
    try {
      const { seconds } = await unwrap(api.vault.copyField(entry.id, def.key));
      markUsed(entry.id);
      api.app.haptic('success');
      toast(tr("{0} copied. Clipboard clears in {1}s.", [def.label, seconds]));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const long = def.type === 'secretTextarea';
  const masked = meta.preview ?? (def.type === 'pin' ? '••••' : long ? '•••••••••••••••• (hidden)' : '••••••••••••••••');

  return (
    <div className="dfield">
      <span className="label">
        {def.label}
        {meta.reused && (
          <span className="badge warn" title={tr("Another item uses the same password")}>
            {tr("Reused")}
          </span>
        )}
      </span>
      <div
        className={`value ${revealed === null ? 'masked' : long ? 'pre' : 'mono'}`}
        aria-label={revealed === null ? tr("{0} hidden", [def.label]) : undefined}
        aria-live="polite"
      >
        {revealed === null ? masked : revealed}
      </div>
      <div className="tools">
        <button
          type="button"
          className={`icon-btn has-ring ${revealed !== null ? 'on' : ''}`}
          onClick={reveal}
          aria-pressed={revealed !== null}
          aria-label={revealed !== null ? tr("Hide {0}", [def.label]) : tr("Show {0}", [def.label])}
          title={revealed !== null ? (revealSeconds ? tr("Hide (hides by itself after {0}s)", [revealSeconds]) : tr("Hide")) : revealSeconds ? tr("Show (auto-hides after {0}s)", [revealSeconds]) : tr("Show")}
        >
          {revealed !== null ? <EyeOff size={15} /> : <Eye size={15} />}
          {revealed !== null && revealSeconds > 0 && <CountdownRing key={revealCount} seconds={revealSeconds} />}
        </button>
        {!long && (
          <button type="button" className="icon-btn" onClick={showLarge} aria-label={tr("Show {0} in large type", [def.label])} title={tr("Large type")}>
            <Maximize2 size={15} />
          </button>
        )}
        <button type="button" className="icon-btn" onClick={copy} aria-label={tr("Copy {0}", [def.label])} title={tr("Copy {0}", [def.label])}>
          <Copy size={15} />
        </button>
      </div>
      {def.type === 'password' && meta.strength !== undefined && (
        <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
          <StrengthMeter score={meta.strength} />
        </div>
      )}
      {large !== null && <LargeReveal label={def.label} value={large} seconds={revealSeconds} onCopy={copy} onClose={() => setLarge(null)} />}
    </div>
  );
}
