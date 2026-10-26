import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { subtitleFor } from '../../shared/categories';
import { searchEntries } from '../../shared/search';
import type { VaultSnapshot } from '../../shared/types';
import { EmptyState } from '../components/EmptyState';
import { GestureRow } from '../components/EntryActions';
import { EntryIcon } from '../components/EntryIcon';

import { tr } from '../../shared/i18n';
/**
 * Search screen (phone). Searches titles, usernames, websites, categories, notes
 * and tags — never secret values: they are not present in the item list at all.
 */
export function SearchView({ snap, onOpen }: { snap: VaultSnapshot; onOpen: (id: string, row?: Element | null) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const results = useMemo(() => {
    const list = category ? snap.entries.filter((e) => e.categoryId === category) : snap.entries;
    return query.trim() ? searchEntries(list, snap.categories, query) : category ? list : [];
  }, [snap, query, category]);

  return (
    <div className="page search-page">
      <div className="page-narrow">
        <div className="search" role="search" style={{ marginBottom: 12 }}>
          <Search size={17} className="search-icon" aria-hidden />
          <input
            type="search"
            placeholder={tr("Search titles, usernames, websites, tags…")}
            aria-label={tr("Search vault")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          {query && (
            <button type="button" className="icon-btn" style={{ position: 'absolute', right: 3, top: 3 }} aria-label={tr("Clear search")} onClick={() => setQuery('')}>
              <X size={16} />
            </button>
          )}
        </div>
        <div className="quick-add" role="group" aria-label={tr("Filter by category")}>
          <button type="button" className="qchip" aria-pressed={category === ''} onClick={() => setCategory('')}>
            {tr("All")}
          </button>
          {snap.categories.map((c) => (
            <button key={c.id} type="button" className="qchip" aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? '' : c.id)}>
              {c.name}
            </button>
          ))}
        </div>

        {!query.trim() && !category ? (
          <EmptyState
            art="search"
            title={tr("Search your vault")}
            text={tr("Titles, usernames, websites, notes and tags. Passwords, PINs and other secret values are never searched or shown in results.")}
          />
        ) : results.length === 0 ? (
          <EmptyState
            art="search"
            title={tr("No matches")}
            text={tr("Try another word, or clear the category filter.")}
            action={
              category ? (
                <button type="button" className="btn sm" onClick={() => setCategory('')}>
                  {tr("Clear filter")}
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="muted small" aria-live="polite" style={{ margin: '4px 4px 8px' }}>
              {results.length} {tr("result")}{results.length === 1 ? '' : 's'}
            </div>
            <ul className="list card" style={{ padding: 6 }}>
              {results.map((e) => {
                const cat = snap.categories.find((c) => c.id === e.categoryId);
                return (
                  <li key={e.id}>
                    <GestureRow entry={e} swipe>
                    <button type="button" className="row" data-id={e.id} onClick={(ev) => onOpen(e.id, ev.currentTarget)}>
                      <EntryIcon entry={e} category={cat} />
                      <span className="row-main">
                        <span className="row-title" data-vt="title" style={{ display: 'block' }}>
                          {e.title}
                        </span>
                        <span className="row-sub" style={{ display: 'block' }}>
                          {cat?.name}
                          {subtitleFor(cat, e.fields) ? ` · ${subtitleFor(cat, e.fields)}` : ''}
                        </span>
                      </span>
                    </button>
                    </GestureRow>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
