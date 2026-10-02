import { House, Layers, Lock, Menu, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings as SettingsIcon, Star, Tag, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EntryView, VaultSnapshot } from '../../shared/types';
import { ConfirmDialog } from '../components/Dialog';
import { GeneratorDialog } from '../components/Generator';
import { CategoryIcon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';
import { useActivityReporter, useHotkeys } from '../lib/hooks';
import { MOBILE_QUERY, useMediaQuery } from '../lib/platform';
import { searchEntries } from '../../shared/search';
import { Dashboard } from './Dashboard';
import { EntryForm } from './EntryForm';
import { ItemsView } from './Items';
import { SettingsView } from './Settings';
import { TitleBar } from './TitleBar';

export type Route =
  | { view: 'dashboard' }
  | { view: 'items'; filter: string } // 'all' | 'favorites' | 'weak' | 'cat:<id>' | 'tag:<tag>'
  | { view: 'settings'; tab?: string };

export type EditorState = { mode: 'new'; categoryId?: string } | { mode: 'edit'; id: string } | null;

export function VaultApp({ version }: { version: string }) {
  const [snap, setSnap] = useState<VaultSnapshot | null>(null);
  const [route, setRoute] = useState<Route>({ view: 'dashboard' });
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleting, setDeleting] = useState<EntryView | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1180);
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useActivityReporter(true);

  const refresh = useCallback(async () => {
    try {
      setSnap(await unwrap(api.vault.snapshot()));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1180);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Apply appearance settings.
  useEffect(() => {
    if (snap) document.documentElement.dataset.density = snap.settings.density;
  }, [snap?.settings.density]);

  const lock = useCallback(() => void api.auth.lock(), []);
  const focusSearch = () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  };
  const newItem = (categoryId?: string) => setEditor({ mode: 'new', categoryId });

  useHotkeys({
    'mod+k': focusSearch,
    'mod+n': () => !editor && newItem(currentCategory(route)),
    'mod+l': lock,
    'mod+,': () => setRoute({ view: 'settings' }),
    'mod+g': () => setGeneratorOpen(true)
  });

  useEffect(
    () =>
      api.events.onCommand((cmd) => {
        if (cmd === 'new-item') newItem();
        if (cmd === 'search') focusSearch();
        if (cmd === 'settings') setRoute({ view: 'settings' });
      }),
    []
  );

  const settingsSidebar = snap?.settings.sidebar ?? 'auto';
  const collapsed = !mobile && (settingsSidebar === 'collapsed' || (settingsSidebar === 'auto' && narrow));

  const toggleSidebar = async () => {
    const next = collapsed ? 'expanded' : 'collapsed';
    const r = await api.vault.updateSettings({ sidebar: next });
    if (r.ok) setSnap((s) => (s ? { ...s, settings: r.value } : s));
  };

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of snap?.entries ?? []) m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + 1);
    return m;
  }, [snap]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const e of snap?.entries ?? []) e.tags.forEach((t) => set.add(t));
    return [...set].sort();
  }, [snap]);

  const searching = query.trim().length > 0;
  const shownRoute: Route = searching ? { view: 'items', filter: 'all' } : route;

  const visibleEntries = useMemo(() => {
    if (!snap || shownRoute.view !== 'items') return [];
    return filterEntries(snap, shownRoute.filter, query);
  }, [snap, shownRoute, query]);

  const go = (r: Route) => {
    setQuery('');
    setRoute(r);
    setDrawerOpen(false);
    if (mobile) setSelectedId(null);
  };

  // Android hardware back button: close drawer → close item → go to dashboard → (else app minimizes).
  const backRef = useRef<() => boolean>(() => false);
  backRef.current = () => {
    if (drawerOpen) return setDrawerOpen(false), true;
    if (query) return setQuery(''), true;
    if (mobile && selectedId && shownRoute.view === 'items') return setSelectedId(null), true;
    if (route.view !== 'dashboard') return go({ view: 'dashboard' }), true;
    return false;
  };
  useEffect(() => {
    const onBack = (e: Event) => backRef.current() && e.preventDefault();
    window.addEventListener('vault:back', onBack);
    return () => window.removeEventListener('vault:back', onBack);
  }, []);

  const openEntry = (id: string) => {
    setSelectedId(id);
    if (shownRoute.view !== 'items') setRoute({ view: 'items', filter: 'all' });
  };

  const isActive = (filter: string) => !searching && route.view === 'items' && route.filter === filter;

  if (!snap) {
    return (
      <>
        <TitleBar />
        <div className="auth">
          <span className="spinner" aria-label="Loading vault" />
        </div>
      </>
    );
  }

  const builtinNav = snap.categories.filter((c) => c.builtin && c.id !== 'notes');
  const notesCat = snap.categories.find((c) => c.id === 'notes')!;
  const customNav = snap.categories.filter((c) => !c.builtin);

  // Plain render helper (not a component) so buttons keep focus across re-renders.
  const navItem = (filter: string, label: string, icon: React.ReactNode, count?: number) => (
    <button
      key={filter}
      type="button"
      className="nav-item"
      aria-current={isActive(filter) ? 'page' : undefined}
      onClick={() => go({ view: 'items', filter })}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
    >
      {icon}
      <span className="nav-text">{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );

  return (
    <>
      <TitleBar>
        {mobile ? (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="vault-nav"
          >
            <Menu size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="icon-btn"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
        <div className="drag" />
        <div className="search" role="search">
          <Search size={15} className="search-icon" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search vault…"
            aria-label="Search vault (Ctrl+K)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Enter' && visibleEntries[0]) {
                setSelectedId(visibleEntries[0].id);
              }
            }}
            spellCheck={false}
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              className="icon-btn"
              style={{ position: 'absolute', right: 2, top: -1, width: 30, height: 30 }}
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <X size={14} />
            </button>
          ) : (
            <span className="kbd" aria-hidden>
              Ctrl K
            </span>
          )}
        </div>
        <div className="drag" />
        <button type="button" className="btn sm primary" onClick={() => newItem(currentCategory(route))} title="New item (Ctrl+N)" aria-label="New item">
          <Plus size={14} aria-hidden /> <span className="btn-text">New item</span>
        </button>
        <button type="button" className="btn sm" onClick={lock} title="Lock vault (Ctrl+L)" aria-label="Lock vault">
          <Lock size={14} aria-hidden /> <span className="btn-text">Lock</span>
        </button>
      </TitleBar>

      <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
        {mobile && drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden />}
        <nav id="vault-nav" className={`sidebar ${drawerOpen ? 'open' : ''}`} aria-label="Vault navigation">
          <button
            type="button"
            className="nav-item"
            aria-current={!searching && route.view === 'dashboard' ? 'page' : undefined}
            onClick={() => go({ view: 'dashboard' })}
            title={collapsed ? 'Dashboard' : undefined}
            aria-label={collapsed ? 'Dashboard' : undefined}
          >
            <House size={16} strokeWidth={1.75} aria-hidden />
            <span className="nav-text">Dashboard</span>
          </button>
          <div className="nav-section label">Vault</div>
          {navItem('all', 'All Items', <Layers size={16} strokeWidth={1.75} aria-hidden />, snap.entries.length)}
          {builtinNav.map((c) => (
            navItem(`cat:${c.id}`, c.id === 'social' ? 'Social' : c.id === 'software' ? 'Software' : c.name, <CategoryIcon icon={c.icon} />, counts.get(c.id) ?? 0)
          ))}
          {navItem('cat:notes', 'Secure Notes', <CategoryIcon icon={notesCat.icon} />, counts.get('notes') ?? 0)}
          {customNav.length > 0 && <div className="nav-section label">Custom</div>}
          {customNav.map((c) => (
            navItem(`cat:${c.id}`, c.name, <CategoryIcon icon={c.icon} />, counts.get(c.id) ?? 0)
          ))}
          <hr />
          {navItem('favorites', 'Favorites', <Star size={16} strokeWidth={1.75} aria-hidden />, snap.stats.favorites)}
          {allTags.length > 0 && <div className="nav-section label">Tags</div>}
          {!collapsed &&
            allTags.slice(0, 12).map((t) => navItem(`tag:${t}`, `#${t}`, <Tag size={14} strokeWidth={1.75} aria-hidden />))}
          <div className="spacer" />
          <hr />
          <button
            type="button"
            className="nav-item"
            aria-current={!searching && route.view === 'settings' ? 'page' : undefined}
            onClick={() => go({ view: 'settings' })}
            title={collapsed ? 'Settings' : undefined}
            aria-label={collapsed ? 'Settings' : undefined}
          >
            <SettingsIcon size={16} strokeWidth={1.75} aria-hidden />
            <span className="nav-text">Settings</span>
          </button>
          <button type="button" className="nav-item lock" onClick={lock} title="Lock vault (Ctrl+L)" aria-label="Lock vault">
            <Lock size={16} strokeWidth={1.9} aria-hidden />
            <span className="nav-text">Lock Vault</span>
          </button>
        </nav>

        <div className="main">
          {shownRoute.view === 'dashboard' && (
            <Dashboard
              snap={snap}
              onOpen={openEntry}
              onNavigate={go}
              onNew={() => newItem()}
              onSearch={(q) => {
                setQuery(q);
                searchRef.current?.focus();
              }}
            />
          )}
          {shownRoute.view === 'items' && (
            <ItemsView
              snap={snap}
              filter={shownRoute.filter}
              query={query}
              entries={visibleEntries}
              mobile={mobile}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onNew={() => newItem(currentCategory(shownRoute))}
              onEdit={(id) => setEditor({ mode: 'edit', id })}
              onDelete={setDeleting}
              onChanged={refresh}
            />
          )}
          {shownRoute.view === 'settings' && <SettingsView key={shownRoute.tab ?? 'settings'} snap={snap} version={version} initialTab={shownRoute.tab} onChanged={refresh} onSnapshot={setSnap} />}
        </div>
      </div>

      {editor && (
        <EntryForm
          state={editor}
          snap={snap}
          onClose={() => setEditor(null)}
          onSaved={async (view) => {
            setEditor(null);
            await refresh();
            setSelectedId(view.id);
            // Make sure the saved item is visible in the current list; otherwise jump to its category.
            const visible =
              !query.trim() && route.view === 'items' && (route.filter === 'all' || route.filter === `cat:${view.categoryId}`);
            if (!visible) {
              setQuery('');
              setRoute({ view: 'items', filter: `cat:${view.categoryId}` });
            }
            toast(editor.mode === 'new' ? 'Item saved securely.' : 'Changes saved.');
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete item?"
          danger
          confirmLabel="Delete permanently"
          message={
            <>
              This will permanently remove:
              <div style={{ margin: '12px 0', color: 'var(--fg)', fontWeight: 600, wordBreak: 'break-word' }}>{deleting.title}</div>
              This cannot be undone.
            </>
          }
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await unwrap(api.vault.deleteEntry(deleting.id));
              setDeleting(null);
              if (selectedId === deleting.id) setSelectedId(null);
              await refresh();
              toast('Item deleted.');
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}

      {generatorOpen && <GeneratorDialog onClose={() => setGeneratorOpen(false)} />}
    </>
  );
}

function currentCategory(route: Route): string | undefined {
  return route.view === 'items' && route.filter.startsWith('cat:') ? route.filter.slice(4) : undefined;
}

export function filterEntries(snap: VaultSnapshot, filter: string, query: string): EntryView[] {
  let list = snap.entries;
  if (filter === 'favorites') list = list.filter((e) => e.favorite);
  else if (filter === 'weak') list = list.filter((e) => e.secrets.password?.set && (e.secrets.password.strength ?? 4) <= 1);
  else if (filter.startsWith('cat:')) list = list.filter((e) => e.categoryId === filter.slice(4));
  else if (filter.startsWith('tag:')) list = list.filter((e) => e.tags.includes(filter.slice(4)));
  if (query.trim()) return searchEntries(list, snap.categories, query);

  const sorted = [...list];
  if (filter === 'favorites') {
    const mode = snap.settings.favoriteSort;
    if (mode === 'manual') sorted.sort((a, b) => a.favoriteOrder - b.favoriteOrder);
    else if (mode === 'updated') sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    else sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  } else {
    sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }
  return sorted;
}
