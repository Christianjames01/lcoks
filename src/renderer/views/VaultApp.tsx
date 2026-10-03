import { CopyCheck, House, Layers, Lock, Menu, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings as SettingsIcon, Star, Tag, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchEntries } from '../../shared/search';
import type { EntryView, VaultSnapshot } from '../../shared/types';
import { ConfirmDialog } from '../components/Dialog';
import { GeneratorDialog } from '../components/Generator';
import { CategoryIcon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { setAppearance, setGeneratorDefaults } from '../lib/appearance';
import { api, errorMessage, unwrap } from '../lib/api';
import { useActivityReporter, useHotkeys } from '../lib/hooks';
import { MOBILE_QUERY, useMediaQuery } from '../lib/platform';
import { Dashboard } from './Dashboard';
import { DuplicatesView } from './Duplicates';
import { EntryForm } from './EntryForm';
import { ImportNotesDialog } from './ImportNotes';
import { ItemsView } from './Items';
import { SearchView } from './SearchView';
import { SettingsView } from './Settings';
import { TitleBar } from './TitleBar';
import { TrashView } from './Trash';

export type Route =
  | { view: 'dashboard' }
  /** filter: 'all' | 'favorites' | 'weak' | 'cat:<id>' | 'tag:<tag>'; entry: opened directly (phone: detail screen only). */
  | { view: 'items'; filter: string; entry?: string }
  | { view: 'search' }
  | { view: 'settings'; tab?: string }
  | { view: 'duplicates' }
  | { view: 'trash' };

export type EditorState = { mode: 'new'; categoryId?: string } | { mode: 'edit'; id: string } | null;

type Tab = 'vault' | 'favorites' | 'search' | 'settings';

function tabOf(r: Route): Tab {
  if (r.view === 'items' && r.filter === 'favorites') return 'favorites';
  if (r.view === 'search') return 'search';
  if (r.view === 'settings' || r.view === 'duplicates' || r.view === 'trash') return 'settings';
  return 'vault';
}

export function VaultApp({ version }: { version: string }) {
  const [snap, setSnap] = useState<VaultSnapshot | null>(null);
  const [route, setRoute] = useState<Route>({ view: 'dashboard' });
  const [history, setHistory] = useState<Route[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleting, setDeleting] = useState<EntryView | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sharedText, setSharedText] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1180);
  const mobile = useMediaQuery(MOBILE_QUERY);
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

  // Text shared from another app (Android "Share → VaultLocks") opens the importer.
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const t = await api.app.takeSharedText();
      if (t && t.trim()) {
        setSharedText(t);
        setImportOpen(true);
      }
    };
    void check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);

  // Appearance & generator settings.
  const settings = snap?.settings;
  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.density = settings.density;
    setAppearance(settings.theme, settings.glass);
    setGeneratorDefaults(settings.generator);
  }, [settings]);

  const lock = useCallback(() => void api.auth.lock(), []);
  const focusSearch = () => {
    if (mobile) return go({ view: 'search' });
    searchRef.current?.focus();
    searchRef.current?.select();
  };
  const newItem = (categoryId?: string) => setEditor({ mode: 'new', categoryId });

  // ---- navigation with history (Android back button walks it backwards)
  const go = (r: Route, opts: { replace?: boolean } = {}) => {
    setQuery('');
    setDrawerOpen(false);
    if (!opts.replace) setHistory((h) => [...h.slice(-30), route]);
    setRoute(r);
    setSelectedId(r.view === 'items' && r.entry ? r.entry : mobile ? null : selectedId);
  };
  const switchTab = (t: Tab) => {
    setDrawerOpen(false);
    setHistory([]);
    setQuery('');
    setSelectedId(null);
    setRoute(t === 'favorites' ? { view: 'items', filter: 'favorites' } : t === 'search' ? { view: 'search' } : t === 'settings' ? { view: 'settings' } : { view: 'dashboard' });
  };
  const back = (): boolean => {
    if (drawerOpen) return setDrawerOpen(false), true;
    if (query) return setQuery(''), true;
    if (mobile && selectedId && route.view === 'items' && !route.entry) return setSelectedId(null), true;
    if (history.length) {
      const prev = history[history.length - 1]!;
      setHistory((h) => h.slice(0, -1));
      setRoute(prev);
      setSelectedId(prev.view === 'items' && prev.entry ? prev.entry : null);
      return true;
    }
    if (route.view !== 'dashboard') return switchTab('vault'), true;
    return false;
  };
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const onBack = (e: Event) => backRef.current() && e.preventDefault();
    window.addEventListener('vault:back', onBack);
    return () => window.removeEventListener('vault:back', onBack);
  }, []);

  useHotkeys({
    'mod+k': focusSearch,
    'mod+n': () => !editor && newItem(currentCategory(route)),
    'mod+l': lock,
    'mod+,': () => go({ view: 'settings' }),
    'mod+g': () => setGeneratorOpen(true)
  });

  useEffect(
    () =>
      api.events.onCommand((cmd) => {
        if (cmd === 'new-item') newItem();
        if (cmd === 'search') focusSearch();
        if (cmd === 'settings') go({ view: 'settings' });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Desktop: typing in the title-bar search shows results in the item list.
  const searching = !mobile && query.trim().length > 0;
  const shownRoute: Route = searching ? { view: 'items', filter: 'all' } : route;

  const visibleEntries = useMemo(() => {
    if (!snap || shownRoute.view !== 'items') return [];
    return filterEntries(snap, shownRoute.filter, searching ? query : '');
  }, [snap, shownRoute, query, searching]);

  const openEntry = (id: string) => {
    if (mobile) return go({ view: 'items', filter: route.view === 'items' ? route.filter : 'all', entry: id });
    setSelectedId(id);
    if (shownRoute.view !== 'items') go({ view: 'items', filter: 'all' });
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

  const categoryNav = snap.categories;

  // Plain render helper (not a component) so buttons keep focus across re-renders.
  const navItem = (key: string, label: string, icon: React.ReactNode, active: boolean, onClick: () => void, count?: number) => (
    <button
      key={key}
      type="button"
      className="nav-item"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
    >
      {icon}
      <span className="nav-text">{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
  const filterNav = (filter: string, label: string, icon: React.ReactNode, count?: number) =>
    navItem(filter, label, icon, isActive(filter), () => go({ view: 'items', filter }), count);

  const screenTitle = (() => {
    const r = shownRoute;
    if (r.view === 'dashboard') return 'Vault';
    if (r.view === 'search') return 'Search';
    if (r.view === 'settings') return 'Settings';
    if (r.view === 'duplicates') return 'Duplicates';
    if (r.view === 'trash') return 'Recently Deleted';
    if (r.filter === 'favorites') return 'Favorites';
    if (r.filter === 'all') return 'All items';
    if (r.filter === 'weak') return 'Weak passwords';
    if (r.filter.startsWith('tag:')) return `#${r.filter.slice(4)}`;
    return snap.categories.find((c) => c.id === r.filter.slice(4))?.name ?? 'Items';
  })();

  const tab = tabOf(route);

  return (
    <>
      <TitleBar>
        {mobile ? (
          <>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setDrawerOpen((o) => !o)}
              aria-label="Open categories"
              aria-expanded={drawerOpen}
              aria-controls="vault-nav"
            >
              <Menu size={20} />
            </button>
            <h1 className="screen-title">{screenTitle}</h1>
            <button type="button" className="icon-btn" onClick={lock} aria-label="Lock vault" title="Lock vault">
              <Lock size={19} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="icon-btn"
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
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
                autoComplete="off"
              />
              {query ? (
                <button
                  type="button"
                  className="icon-btn"
                  style={{ position: 'absolute', right: 2, top: 0, width: 32, height: 32 }}
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
          </>
        )}
      </TitleBar>

      <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
        {mobile && drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden />}
        {(
          <nav id="vault-nav" className={`sidebar ${drawerOpen ? 'open' : ''}`} aria-label="Vault navigation">
            {navItem('dashboard', 'Dashboard', <House size={16} strokeWidth={1.75} aria-hidden />, !searching && route.view === 'dashboard', () => go({ view: 'dashboard' }))}
            {filterNav('favorites', 'Favorites', <Star size={16} strokeWidth={1.75} aria-hidden />, snap.stats.favorites)}
            <div className="nav-section label">Vault</div>
            {filterNav('all', 'All Items', <Layers size={16} strokeWidth={1.75} aria-hidden />, snap.entries.length)}
            {categoryNav.map((c) => filterNav(`cat:${c.id}`, c.name, <CategoryIcon icon={c.icon} />, counts.get(c.id) ?? 0))}
            {allTags.length > 0 && !collapsed && <div className="nav-section label">Tags</div>}
            {!collapsed && allTags.slice(0, 12).map((t) => filterNav(`tag:${t}`, `#${t}`, <Tag size={14} strokeWidth={1.75} aria-hidden />))}
            <div className="nav-section label">Tools</div>
            {navItem('duplicates', 'Duplicates', <CopyCheck size={16} strokeWidth={1.75} aria-hidden />, !searching && route.view === 'duplicates', () => go({ view: 'duplicates' }))}
            {navItem(
              'trash',
              'Recently Deleted',
              <Trash2 size={16} strokeWidth={1.75} aria-hidden />,
              !searching && route.view === 'trash',
              () => go({ view: 'trash' }),
              snap.trash.length || undefined
            )}
            <div className="spacer" />
            <hr />
            {navItem('settings', 'Settings', <SettingsIcon size={16} strokeWidth={1.75} aria-hidden />, !searching && route.view === 'settings', () => go({ view: 'settings' }))}
            <button type="button" className="nav-item lock" onClick={lock} title="Lock vault (Ctrl+L)" aria-label="Lock vault">
              <Lock size={16} strokeWidth={1.9} aria-hidden />
              <span className="nav-text">Lock Vault</span>
            </button>
          </nav>
        )}

        <main className="main">
          {shownRoute.view === 'dashboard' && (
            <Dashboard
              snap={snap}
              mobile={mobile}
              onOpen={openEntry}
              onNavigate={go}
              onNew={newItem}
              onImport={() => setImportOpen(true)}
              onSearch={() => focusSearch()}
            />
          )}
          {shownRoute.view === 'items' && (
            <ItemsView
              snap={snap}
              filter={shownRoute.filter}
              query={searching ? query : ''}
              entries={visibleEntries}
              mobile={mobile}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onBack={() => back()}
              onNew={() => newItem(currentCategory(shownRoute))}
              onEdit={(id) => setEditor({ mode: 'edit', id })}
              onDelete={setDeleting}
              onChanged={refresh}
              onNavigate={go}
            />
          )}
          {shownRoute.view === 'search' && <SearchView snap={snap} onOpen={openEntry} />}
          {shownRoute.view === 'duplicates' && <DuplicatesView snap={snap} onChanged={refresh} onOpen={openEntry} />}
          {shownRoute.view === 'trash' && <TrashView snap={snap} onChanged={refresh} />}
          {shownRoute.view === 'settings' && (
            <SettingsView
              key={shownRoute.tab ?? 'settings'}
              snap={snap}
              version={version}
              initialTab={shownRoute.tab}
              onChanged={refresh}
              onSnapshot={setSnap}
              onNavigate={go}
              onImport={() => setImportOpen(true)}
              onGenerator={() => setGeneratorOpen(true)}
            />
          )}
        </main>
      </div>

      {mobile && (
        <nav className="bottom-nav" aria-label="Main">
          <button type="button" className="tab-btn" aria-current={tab === 'vault' ? 'page' : undefined} onClick={() => switchTab('vault')}>
            <House size={22} strokeWidth={1.9} aria-hidden />
            Vault
          </button>
          <button type="button" className="tab-btn" aria-current={tab === 'favorites' ? 'page' : undefined} onClick={() => switchTab('favorites')}>
            <Star size={22} strokeWidth={1.9} aria-hidden />
            Favorites
          </button>
          <button type="button" className="fab" onClick={() => newItem(currentCategory(route))} aria-label="Add item">
            <Plus size={28} strokeWidth={2.2} aria-hidden />
          </button>
          <button type="button" className="tab-btn" aria-current={tab === 'search' ? 'page' : undefined} onClick={() => switchTab('search')}>
            <Search size={22} strokeWidth={1.9} aria-hidden />
            Search
          </button>
          <button type="button" className="tab-btn" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => switchTab('settings')}>
            <SettingsIcon size={22} strokeWidth={1.9} aria-hidden />
            Settings
          </button>
        </nav>
      )}

      {editor && (
        <EntryForm
          state={editor}
          snap={snap}
          onClose={() => setEditor(null)}
          onSaved={async (view, attachmentsAdded) => {
            const wasNew = editor.mode === 'new';
            setEditor(null);
            await refresh();
            if (mobile) {
              go({ view: 'items', filter: `cat:${view.categoryId}`, entry: view.id }, { replace: route.view === 'items' && route.entry === view.id });
            } else {
              setSelectedId(view.id);
              // Make sure the saved item is visible in the current list; otherwise jump to its category.
              const visible = !query.trim() && route.view === 'items' && (route.filter === 'all' || route.filter === `cat:${view.categoryId}`);
              if (!visible) go({ view: 'items', filter: `cat:${view.categoryId}` });
              setSelectedId(view.id);
            }
            toast(wasNew ? (attachmentsAdded ? `Item saved securely with ${attachmentsAdded} attachment(s).` : 'Item saved securely.') : 'Changes saved.');
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete item?"
          danger
          confirmLabel="Move to Recently Deleted"
          message={
            <>
              <div style={{ margin: '0 0 12px', color: 'var(--fg)', fontWeight: 600, wordBreak: 'break-word' }}>{deleting.title}</div>
              The item and its attachments move to Recently Deleted. You can restore them for 30 days; after that they are deleted permanently.
            </>
          }
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await unwrap(api.vault.deleteEntry(deleting.id));
              const wasOpen = selectedId === deleting.id;
              setDeleting(null);
              await refresh();
              if (wasOpen) {
                if (mobile) back();
                else setSelectedId(null);
              }
              toast('Moved to Recently Deleted.');
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}

      {generatorOpen && <GeneratorDialog onClose={() => setGeneratorOpen(false)} />}
      {importOpen && (
        <ImportNotesDialog
          key={sharedText ?? 'manual'}
          snap={snap}
          initialText={sharedText}
          onClose={() => {
            setImportOpen(false);
            setSharedText(undefined);
          }}
          onImported={async () => {
            setImportOpen(false);
            setSharedText(undefined);
            await refresh();
            go({ view: 'items', filter: 'tag:imported' });
          }}
        />
      )}
    </>
  );
}

function currentCategory(route: Route): string | undefined {
  return route.view === 'items' && route.filter.startsWith('cat:') ? route.filter.slice(4) : undefined;
}

export type SortMode = 'name' | 'updated' | 'created';

export function filterEntries(snap: VaultSnapshot, filter: string, query: string, sort?: SortMode): EntryView[] {
  let list = snap.entries;
  if (filter === 'favorites') list = list.filter((e) => e.favorite);
  else if (filter === 'weak') list = list.filter((e) => e.secrets.password?.set && (e.secrets.password.strength ?? 4) <= 1);
  else if (filter.startsWith('cat:')) list = list.filter((e) => e.categoryId === filter.slice(4));
  else if (filter.startsWith('tag:')) list = list.filter((e) => e.tags.includes(filter.slice(4)));
  if (query.trim()) return searchEntries(list, snap.categories, query);

  const sorted = [...list];
  const byName = (a: EntryView, b: EntryView) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const mode = sort ?? (filter === 'favorites' ? snap.settings.favoriteSort : 'name');
  if (mode === 'manual') sorted.sort((a, b) => a.favoriteOrder - b.favoriteOrder);
  else if (mode === 'updated') sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  else if (mode === 'created') sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else sorted.sort(byName);
  return sorted;
}
