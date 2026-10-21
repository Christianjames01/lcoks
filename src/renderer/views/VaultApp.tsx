import { CalendarDays, CopyCheck, House, Layers, Lock, Wallet, Menu, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings as SettingsIcon, ShieldCheck, Star, Tag, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calendarNotifications } from '../../shared/calendar';
import { buildReminders } from '../../shared/expiry';
import { searchEntries } from '../../shared/search';
import { isOld, isReused } from '../../shared/security';
import type { EntryView, VaultSnapshot } from '../../shared/types';
import { ConfirmDialog } from '../components/Dialog';
import { EntryActionsProvider, EntryMenu, passwordKeyOf, usernameOf, websiteOf, type EntryActions } from '../components/EntryActions';
import { GeneratorDialog } from '../components/Generator';
import { ReminderAlerts } from '../components/ReminderAlerts';
import { CategoryIcon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { setAppearance, setGeneratorDefaults } from '../lib/appearance';
import { api, errorMessage, unwrap } from '../lib/api';
import { isEditingText, useActivityReporter, useHotkeys } from '../lib/hooks';
import { morphClose, morphOpen } from '../lib/motion';
import { MOBILE_QUERY, useMediaQuery } from '../lib/platform';
import { markUsed, pruneUsed } from '../lib/recent';
import { CalendarView, type CalendarFocus } from './Calendar';
import { Dashboard } from './Dashboard';
import { SecurityView } from './SecurityView';
import { DuplicatesView } from './Duplicates';
import { EntryForm } from './EntryForm';
import { ImportNotesDialog } from './ImportNotes';
import { ItemsView } from './Items';
import { MoneyView } from './Money';
import { SearchView } from './SearchView';
import { SettingsView } from './Settings';
import { TitleBar } from './TitleBar';
import { TrashView } from './Trash';

export type Route =
  | { view: 'dashboard' }
  /** filter: 'all' | 'favorites' | 'weak' | 'reused' | 'old' | 'cat:<id>' | 'tag:<tag>'; entry: opened directly (phone: detail screen only). */
  | { view: 'items'; filter: string; entry?: string }
  | { view: 'search' }
  | { view: 'money' }
  | { view: 'calendar' }
  | { view: 'security' }
  | { view: 'settings'; tab?: string }
  | { view: 'duplicates' }
  | { view: 'trash' };

export type EditorState = { mode: 'new'; categoryId?: string } | { mode: 'edit'; id: string } | null;

type Tab = 'vault' | 'money' | 'calendar' | 'search' | 'settings';

function tabOf(r: Route): Tab {
  if (r.view === 'money') return 'money';
  if (r.view === 'calendar') return 'calendar';
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
  // "Open the add form" request for the Expenses screen (+ button, double tap on the back).
  const [moneyAdd, setMoneyAdd] = useState<{ id: number; kind: 'expense' | 'income' } | null>(null);
  const requestAdd = (kind: 'expense' | 'income' = 'expense') => setMoneyAdd({ id: Date.now(), kind });
  // Calendar: open an event (reminder pop-up) or the add form (+ button).
  const [calendarFocus, setCalendarFocus] = useState<CalendarFocus | null>(null);
  const [sharedText, setSharedText] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1180);
  const [menu, setMenu] = useState<{ entry: EntryView; at: { x: number; y: number } } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const mobile = useMediaQuery(MOBILE_QUERY);
  const searchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useActivityReporter(true);

  const refresh = useCallback(async () => {
    try {
      const s = await unwrap(api.vault.snapshot());
      setSnap(s);
      pruneUsed(s.entries.map((e) => e.id));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Expenses added while locked (lock screen / notification) were picked up by this unlock.
  // Double tap on the back while the app is open (Android): straight to the add form, no app switch.
  useEffect(() => {
    const onQuick = (e: Event) => {
      const cash = (e as CustomEvent<{ cash?: boolean }>).detail?.cash === true;
      setEditor(null);
      setRoute({ view: 'money' });
      requestAdd(cash ? 'income' : 'expense');
    };
    window.addEventListener('vault:quickadd', onQuick);
    return () => window.removeEventListener('vault:quickadd', onQuick);
  }, []);

  // Also checked when the app comes back (a notification reply may have arrived meanwhile).
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const r = await api.inbox.takeReport();
      if (!r.ok || !r.value) return;
      const { added, unreadable } = r.value;
      if (added) {
        await refresh();
        toast(`${added} expense${added === 1 ? '' : 's'} added from quick add.`);
      }
      if (unreadable.length) toast(`Couldn't read an amount in: ${unreadable.map((t) => `“${t}”`).join(', ')}. Please add ${unreadable.length === 1 ? 'it' : 'them'} again.`, 'error');
    };
    void check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [toast, refresh]);

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
    setAppearance(settings.theme, settings.glass, settings.accent);
    setGeneratorDefaults(settings.generator);
  }, [settings]);

  // Phone reminders: rebuilt whenever items or reminder settings change (Android).
  useEffect(() => {
    if (!snap) return;
    const t = setTimeout(async () => {
      const { reminders, reminderDaysBefore, calendarReminders, calendarPreview, calendarSound } = snap.settings;
      if (reminders || calendarReminders) {
        let status = await api.notifications.status();
        if (status === 'unsupported') return;
        // Ask once; after that the user decides in Settings → Reminders.
        let asked = false;
        try {
          asked = localStorage.getItem('vaultlocks.notifAsked') === '1';
          localStorage.setItem('vaultlocks.notifAsked', '1');
        } catch {
          /* ignore */
        }
        if (status === 'prompt' && !asked) status = await api.notifications.request();
      }
      const expiry = reminders
        ? buildReminders(snap.entries, snap.categories, { daysBefore: reminderDaysBefore })
            .slice(0, 40)
            .map((r) => ({ id: r.id, at: r.at.getTime(), title: r.title, body: r.body }))
        : [];
      const calendar = calendarReminders ? calendarNotifications(snap.events, Date.now(), { preview: calendarPreview, sound: calendarSound }) : [];
      const list = [...expiry, ...calendar].sort((a, b) => a.at - b.at).slice(0, 100);
      await api.notifications.schedule(list);
    }, 800);
    return () => clearTimeout(t);
  }, [snap]);

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
    setRoute(
      t === 'money' ? { view: 'money' } : t === 'calendar' ? { view: 'calendar' } : t === 'search' ? { view: 'search' } : t === 'settings' ? { view: 'settings' } : { view: 'dashboard' }
    );
  };
  /** What Back would do right now, or null when there is nowhere to go back to. */
  const backAction = (): (() => void) | null => {
    if (drawerOpen) return () => setDrawerOpen(false);
    if (query) return () => setQuery('');
    if (mobile && selectedId && route.view === 'items' && !route.entry) return () => setSelectedId(null);
    if (history.length) {
      const prev = history[history.length - 1]!;
      return () => {
        setHistory((h) => h.slice(0, -1));
        setRoute(prev);
        setSelectedId(prev.view === 'items' && prev.entry ? prev.entry : null);
      };
    }
    if (route.view !== 'dashboard') return () => switchTab('vault');
    return null;
  };
  const back = (): boolean => {
    const act = backAction();
    if (!act) return false;
    // Phone: leaving an item shrinks its header back into the row it came from.
    const fromDetail = mobile && route.view === 'items' && selectedId && !drawerOpen && !query ? selectedId : null;
    if (fromDetail) morphClose(() => document.querySelector(`main [data-id="${CSS.escape(fromDetail)}"]`), act);
    else act();
    return true;
  };
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const onBack = (e: Event) => backRef.current() && e.preventDefault();
    window.addEventListener('vault:back', onBack);
    return () => window.removeEventListener('vault:back', onBack);
  }, []);

  // ---- item actions (row menu, swipe, shortcuts)
  const copyPassword = async (e: EntryView) => {
    const key = passwordKeyOf(e);
    if (!key) return toast('This item has no password to copy.', 'error');
    try {
      const { seconds } = await unwrap(api.vault.copyField(e.id, key));
      markUsed(e.id);
      api.app.haptic('success');
      toast(`${key === 'password' ? 'Password' : 'Secret'} copied. Clipboard clears in ${seconds}s.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };
  const copyUsername = async (e: EntryView) => {
    const user = usernameOf(e);
    if (!user) return toast('This item has no username to copy.', 'error');
    try {
      const { seconds } = await unwrap(api.vault.copyText(user.value));
      markUsed(e.id);
      api.app.haptic('success');
      toast(`${user.label} copied. Clipboard clears in ${seconds}s.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };
  const actions: EntryActions = {
    copyPassword,
    copyUsername,
    openWebsite: async (e) => {
      const url = websiteOf(e);
      if (!url) return;
      markUsed(e.id);
      const r = await api.app.openExternal(url);
      if (!r.ok) toast(r.message, 'error');
    },
    toggleFavorite: async (e) => {
      try {
        await unwrap(api.vault.setFavorite(e.id, !e.favorite));
        api.app.haptic('tap');
        await refresh();
        toast(e.favorite ? 'Removed from favorites.' : 'Added to favorites.');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    },
    edit: (e) => setEditor({ mode: 'edit', id: e.id }),
    remove: (e) => setDeleting(e),
    openMenu: (e, at) => setMenu({ entry: e, at })
  };

  /** The item the keyboard shortcuts act on: the one open in the detail pane. */
  const selectedEntry = (): EntryView | undefined =>
    snap && (route.view === 'items' || searching) && selectedId && !editor && !menu ? snap.entries.find((e) => e.id === selectedId) : undefined;

  useHotkeys({
    'mod+k': focusSearch,
    'mod+f': focusSearch,
    'mod+n': () => !editor && newItem(currentCategory(route)),
    'mod+l': lock,
    'mod+,': () => go({ view: 'settings' }),
    'mod+g': () => setGeneratorOpen(true),
    'mod+c': () => {
      const e = selectedEntry();
      if (!e || isEditingText() || document.querySelector('.dialog')) return false;
      void copyPassword(e);
      return true;
    },
    'mod+b': () => {
      const e = selectedEntry();
      if (!e || isEditingText() || document.querySelector('.dialog')) return false;
      void copyUsername(e);
      return true;
    }
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

  /** Open an item; on phones the tapped row (if given) grows into the detail screen. */
  const openEntry = (id: string, row?: Element | null) => {
    markUsed(id);
    if (mobile) return morphOpen(row, () => go({ view: 'items', filter: route.view === 'items' ? route.filter : 'all', entry: id }));
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
    if (r.view === 'money') return 'Expenses';
    if (r.view === 'calendar') return 'Calendar';
    if (r.view === 'settings') return 'Settings';
    if (r.view === 'duplicates') return 'Duplicates';
    if (r.view === 'trash') return 'Recently Deleted';
    if (r.view === 'security') return 'Security';
    if (r.filter === 'favorites') return 'Favorites';
    if (r.filter === 'all') return 'All items';
    if (r.filter === 'weak') return 'Weak passwords';
    if (r.filter === 'reused') return 'Reused passwords';
    if (r.filter === 'old') return 'Old passwords';
    if (r.filter.startsWith('tag:')) return `#${r.filter.slice(4)}`;
    return snap.categories.find((c) => c.id === r.filter.slice(4))?.name ?? 'Items';
  })();

  const tab = tabOf(route);

  return (
    <EntryActionsProvider value={actions}>
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
            <button type="button" className="icon-btn" onClick={() => go({ view: 'search' })} aria-label="Search vault" title="Search vault" aria-current={route.view === 'search' ? 'page' : undefined}>
              <Search size={19} />
            </button>
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
            {route.view === 'money' && !searching ? (
              <button type="button" className="btn sm primary" onClick={() => requestAdd()} aria-label="Add expense">
                <Plus size={14} aria-hidden /> <span className="btn-text">Add expense</span>
              </button>
            ) : route.view === 'calendar' && !searching ? (
              <button type="button" className="btn sm primary" onClick={() => setCalendarFocus({ id: Date.now(), add: true })} aria-label="Add event">
                <Plus size={14} aria-hidden /> <span className="btn-text">Add event</span>
              </button>
            ) : (
              <button type="button" className="btn sm primary" onClick={() => newItem(currentCategory(route))} title="New item (Ctrl+N)" aria-label="New item">
                <Plus size={14} aria-hidden /> <span className="btn-text">New item</span>
              </button>
            )}
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
            {navItem('money', 'Expenses', <Wallet size={16} strokeWidth={1.75} aria-hidden />, !searching && route.view === 'money', () => go({ view: 'money' }))}
            {navItem('calendar', 'Calendar', <CalendarDays size={16} strokeWidth={1.75} aria-hidden />, !searching && route.view === 'calendar', () => go({ view: 'calendar' }))}
            <div className="nav-section label">Vault</div>
            {filterNav('all', 'All Items', <Layers size={16} strokeWidth={1.75} aria-hidden />, snap.entries.length)}
            {categoryNav.map((c) => filterNav(`cat:${c.id}`, c.name, <CategoryIcon icon={c.icon} />, counts.get(c.id) ?? 0))}
            {allTags.length > 0 && !collapsed && <div className="nav-section label">Tags</div>}
            {!collapsed && allTags.slice(0, 12).map((t) => filterNav(`tag:${t}`, `#${t}`, <Tag size={14} strokeWidth={1.75} aria-hidden />))}
            <div className="nav-section label">Tools</div>
            {navItem('security', 'Security', <ShieldCheck size={16} strokeWidth={1.75} aria-hidden />, !searching && route.view === 'security', () => go({ view: 'security' }))}
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
              onLock={lock}
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
          {shownRoute.view === 'calendar' && <CalendarView snap={snap} mobile={mobile} onChanged={refresh} focus={calendarFocus} onFocusHandled={() => setCalendarFocus(null)} />}
          {shownRoute.view === 'money' && <MoneyView snap={snap} mobile={mobile} onChanged={refresh} addRequest={moneyAdd} onAddHandled={() => setMoneyAdd(null)} />}
          {shownRoute.view === 'security' && <SecurityView snap={snap} onOpen={openEntry} onNavigate={go} />}
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
          <button type="button" className="tab-btn" aria-current={tab === 'money' ? 'page' : undefined} onClick={() => switchTab('money')}>
            <Wallet size={22} strokeWidth={1.9} aria-hidden />
            Expenses
          </button>
          <button
            type="button"
            className="fab"
            onClick={() =>
              route.view === 'money' ? requestAdd() : route.view === 'calendar' ? setCalendarFocus({ id: Date.now(), add: true }) : newItem(currentCategory(route))
            }
            aria-label={route.view === 'money' ? 'Add expense' : route.view === 'calendar' ? 'Add event' : 'Add item'}
          >
            <Plus size={28} strokeWidth={2.2} aria-hidden />
          </button>
          <button type="button" className="tab-btn" aria-current={tab === 'calendar' ? 'page' : undefined} onClick={() => switchTab('calendar')}>
            <CalendarDays size={22} strokeWidth={1.9} aria-hidden />
            Calendar
          </button>
          <button type="button" className="tab-btn" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => switchTab('settings')}>
            <SettingsIcon size={22} strokeWidth={1.9} aria-hidden />
            Settings
          </button>
        </nav>
      )}

      <ReminderAlerts
        snap={snap}
        onChanged={refresh}
        onView={(eventId, day) => {
          setEditor(null);
          go({ view: 'calendar' });
          setCalendarFocus({ id: Date.now(), eventId, day });
        }}
      />

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
        <ConfirmDialog placement="center"
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
              api.app.haptic('warning');
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

      {menu && <EntryMenu entry={menu.entry} at={menu.at} sheet={mobile} actions={actions} onClose={closeMenu} />}
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
    </EntryActionsProvider>
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
  else if (filter === 'reused') list = list.filter(isReused);
  else if (filter === 'old') list = list.filter((e) => isOld(e));
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
