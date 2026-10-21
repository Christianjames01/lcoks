import { Archive, CalendarClock, ChevronRight, CopyCheck, KeyRound, Plus, Search, Settings as SettingsIcon, ShieldAlert, Trash2, TriangleAlert, Upload, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { subtitleFor } from '../../shared/categories';
import { describeUpcoming, upcomingDates } from '../../shared/expiry';
import { dayKey, formatMoney, monthOf, totals } from '../../shared/money';
import { securityReport } from '../../shared/security';
import type { EntryView, VaultSnapshot } from '../../shared/types';
import { CategoryCard, QuickActionCard, RecentItemCard, StorageUsageCard, VaultStatusCard } from '../components/DashboardCards';
import { EmptyState } from '../components/EmptyState';
import { CategoryIcon } from '../components/Icon';
import { api } from '../lib/api';
import { daysSince, greeting, relativeTime } from '../lib/format';
import { useRecentlyUsed } from '../lib/recent';
import type { Route } from './VaultApp';

interface Props {
  snap: VaultSnapshot;
  mobile: boolean;
  onOpen: (id: string, row?: Element | null) => void;
  onNavigate: (r: Route) => void;
  onNew: (categoryId?: string) => void;
  onSearch: () => void;
  onImport: () => void;
  onLock: () => void;
}

const QUICK_ADD: [string, string][] = [
  ['personal', 'Password'],
  ['banking', 'Bank account'],
  ['cards', 'Card'],
  ['wallets', 'E-wallet'],
  ['ids', 'ID'],
  ['documents', 'Document'],
  ['notes', 'Secure note']
];

/** How many category cards the overview shows before "View all". */
const CATEGORY_CARDS = 8;

type Health = 'ok' | 'warn' | 'bad';

export function Dashboard({ snap, mobile, onOpen, onNavigate, onNew, onSearch, onImport, onLock }: Props) {
  const used = useRecentlyUsed();
  const [dupCount, setDupCount] = useState<number | null>(null);
  // "View all" shows the whole list right here; "Show less" folds it back.
  const [expanded, setExpanded] = useState<{ cats?: boolean; used?: boolean; updated?: boolean }>({});
  const toggle = (k: 'cats' | 'used' | 'updated') => setExpanded((x) => ({ ...x, [k]: !x[k] }));
  const { settings, meta, stats } = snap;

  // Duplicate check only reads the vault; nothing is changed.
  useEffect(() => {
    let cancelled = false;
    void api.vault.findDuplicates().then((r) => !cancelled && setDupCount(r.ok ? r.value.length : null));
    return () => {
      cancelled = true;
    };
  }, [snap]);

  const recent = useMemo(() => [...snap.entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [snap.entries]);
  const recentlyUsed = useMemo(
    () =>
      snap.entries
        .filter((e) => used[e.id])
        .sort((a, b) => used[b.id]! - used[a.id]!),
    [snap.entries, used]
  );
  const report = useMemo(() => securityReport(snap.entries, meta, settings.backupReminderDays), [snap.entries, meta, settings.backupReminderDays]);
  const pwIssues = report.issues.filter((i) => i.id !== 'backup');
  const favorites = useMemo(() => snap.entries.filter((e) => e.favorite).sort((a, b) => a.favoriteOrder - b.favoriteOrder).slice(0, 4), [snap.entries]);
  const upcoming = useMemo(() => upcomingDates(snap.entries, undefined, 30, snap.categories).slice(0, 5), [snap.entries, snap.categories]);

  // Categories that hold items, fullest first (ties keep the vault's own order).
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of snap.entries) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1);
    return snap.categories
      .map((c, i) => ({ c, i, n: counts.get(c.id) ?? 0 }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || a.i - b.i);
  }, [snap.entries, snap.categories]);

  const month = useMemo(() => {
    const m = monthOf(dayKey(new Date()));
    return totals(snap.transactions.filter((t) => monthOf(t.date) === m));
  }, [snap.transactions]);

  const backupAge = daysSince(meta.lastBackupAt);
  const backupDue = settings.backupReminderDays > 0 && stats.total > 0 && backupAge > settings.backupReminderDays;
  const lockText =
    settings.backgroundLockMinutes === 0
      ? 'Locks as soon as you leave the app'
      : settings.autoLockMinutes === 0
        ? 'Auto-lock is off'
        : `Auto-locks after ${settings.autoLockMinutes} min of inactivity`;

  /** when: what the time in the subtitle means (last update, or last use on this device). */
  const row = (e: EntryView, when: 'updated' | 'used' = 'updated') => {
    const cat = snap.categories.find((c) => c.id === e.categoryId);
    const time = when === 'used' && used[e.id] ? `used ${relativeTime(new Date(used[e.id]!).toISOString())}` : relativeTime(e.updatedAt);
    // A note's body is a secret: the list never shows any of it.
    const lead = e.categoryId === 'notes' ? 'Encrypted note' : subtitleFor(cat, e.fields) || cat?.name;
    return <RecentItemCard key={e.id} entry={e} category={cat} subtitle={`${lead} · ${time}`} swipe={mobile} onOpen={onOpen} />;
  };

  const health = (
    key: string,
    level: Health,
    icon: React.ReactNode,
    title: string,
    status: string,
    onClick: () => void
  ) => (
    <li key={key}>
      <button type="button" className="row" onClick={onClick}>
        <span className={`health-dot ${level}`} aria-hidden>
          {icon}
        </span>
        <span className="row-main">
          <span className="row-title" style={{ display: 'block' }}>
            {title}
          </span>
          <span className="row-sub" style={{ display: 'block', whiteSpace: 'normal' }}>
            {/* Text states the status as well — never colour alone. */}
            {level === 'ok' ? 'Good · ' : level === 'warn' ? 'Needs attention · ' : 'Action needed · '}
            {status}
          </span>
        </span>
        <ChevronRight size={16} aria-hidden className="dim" />
      </button>
    </li>
  );

  const sectionHead = (label: string, onAll?: () => void, open?: boolean, total?: number) => (
    <div className="section-title">
      <span className="label">{label}</span>
      {onAll && (
        <button type="button" className="linkish" onClick={onAll} aria-expanded={open}>
          {open ? 'Show less' : total ? `View all (${total})` : 'View all'}
        </button>
      )}
    </div>
  );
  const RECENT = 6;
  const USED = 5;

  return (
    <div className="page dashboard">
      <div className="page-narrow">
        {!mobile && (
          <header className="dash-head">
            <img className="dash-logo" src="./icon.png" alt="" width={40} height={40} />
            <div className="grow">
              <div className="dash-greeting">{greeting()}</div>
              <h1 className="dash-title">VaultLocks</h1>
            </div>
            <button type="button" className="icon-btn" onClick={() => onNavigate({ view: 'settings' })} aria-label="Settings" title="Settings">
              <SettingsIcon size={18} />
            </button>
          </header>
        )}

        {mobile && (
          <button type="button" className="search-trigger dash-search-top" onClick={onSearch} aria-label="Search vault">
            <Search size={16} aria-hidden />
            <span>Search vault</span>
          </button>
        )}

        <div className="dash-top">
          <VaultStatusCard
            greeting={mobile ? greeting() : undefined}
            description={`${stats.total} item${stats.total === 1 ? '' : 's'}, encrypted with AES-256 on this device. ${lockText}.`}
            metrics={[
              { label: 'Items', value: stats.total, onClick: () => onNavigate({ view: 'items', filter: 'all' }) },
              { label: 'Favorites', value: stats.favorites, onClick: () => onNavigate({ view: 'items', filter: 'favorites' }) },
              { label: 'Notes', value: stats.notes, onClick: () => onNavigate({ view: 'items', filter: 'cat:notes' }) },
              { label: 'Files', value: stats.attachments, onClick: () => onNavigate({ view: 'items', filter: 'all' }) }
            ]}
            report={report}
            onLock={onLock}
            onSecurity={() => onNavigate({ view: 'security' })}
          />
          <button type="button" className="storage-card" onClick={() => onNavigate({ view: 'money' })}>
            <span className="sc-icon" aria-hidden>
              <Wallet size={18} strokeWidth={1.75} />
            </span>
            <span className="grow">
              <span className="sc-title">This month</span>
              <span className="sc-sub">
                {snap.transactions.length === 0
                  ? 'Track expenses and income with a calendar'
                  : `Spent ${formatMoney(month.expense, settings.currency)} · Income ${formatMoney(month.income, settings.currency)}`}
              </span>
            </span>
            <ChevronRight size={16} aria-hidden className="dim" />
          </button>
          <StorageUsageCard refreshKey={snap} onOpen={() => onNavigate({ view: 'settings', tab: 'vault' })} />
        </div>

        {sectionHead('Quick actions')}
        <div className="qa-grid" role="group" aria-label="Quick actions">
          {QUICK_ADD.filter(([id]) => snap.categories.some((c) => c.id === id)).map(([id, label]) => (
            <QuickActionCard key={id} icon={<CategoryIcon icon={snap.categories.find((c) => c.id === id)?.icon} size={20} />} label={label} onClick={() => onNew(id)} />
          ))}
          <QuickActionCard icon={<Wallet size={20} strokeWidth={1.75} />} label="Expense" onClick={() => onNavigate({ view: 'money' })} />
          <QuickActionCard icon={<Upload size={20} strokeWidth={1.75} />} label="Import notes" onClick={onImport} />
        </div>

        {stats.total === 0 ? (
          <EmptyState
            card
            art="vault"
            title="Your vault is empty"
            text="Add passwords, bank accounts, cards, IDs, documents and secure notes. Everything is encrypted on this device."
            action={
              <>
                <button type="button" className="btn primary" onClick={() => onNew()}>
                  <Plus size={15} aria-hidden /> Add your first item
                </button>
                <button type="button" className="btn" onClick={onImport}>
                  <Upload size={15} aria-hidden /> Import notes
                </button>
              </>
            }
          />
        ) : (
          <>
            {sectionHead('Categories', categories.length > CATEGORY_CARDS ? () => toggle('cats') : undefined, expanded.cats, categories.length)}
            <div className="cat-cards">
              {(expanded.cats ? categories : categories.slice(0, CATEGORY_CARDS)).map(({ c, n }) => (
                <CategoryCard key={c.id} category={c} count={n} onClick={() => onNavigate({ view: 'items', filter: `cat:${c.id}` })} />
              ))}
            </div>

            {sectionHead('Security status')}
            <ul className="card health" aria-label="Security status">
              {health(
                'passwords',
                pwIssues.some((i) => i.severity === 'bad') ? 'bad' : pwIssues.length ? 'warn' : 'ok',
                pwIssues.length ? <ShieldAlert size={17} /> : <KeyRound size={17} />,
                'Passwords',
                pwIssues.length ? pwIssues.map((i) => i.title).join(' · ') : 'No weak, reused or old passwords',
                () => onNavigate({ view: 'security' })
              )}
              {health(
                'dups',
                dupCount ? 'warn' : 'ok',
                <CopyCheck size={17} />,
                'Duplicates',
                dupCount === null ? 'Checking…' : dupCount ? `${dupCount} possible duplicate group${dupCount === 1 ? '' : 's'} to review` : 'No duplicates found',
                () => onNavigate({ view: 'duplicates' })
              )}
              {health(
                'backup',
                !meta.lastBackupAt ? 'bad' : backupDue ? 'warn' : 'ok',
                <Archive size={17} />,
                'Backup',
                !meta.lastBackupAt ? 'No backup yet — keep an encrypted copy somewhere safe' : `Last backup ${relativeTime(meta.lastBackupAt)}${meta.lastBackupVerified ? ' (verified)' : ''}`,
                () => onNavigate({ view: 'settings', tab: 'vault' })
              )}
              {upcoming.length > 0 &&
                health(
                  'expiry',
                  upcoming.some((u) => u.days <= 7) ? 'warn' : 'ok',
                  <CalendarClock size={17} />,
                  'Expiring soon',
                  `${upcoming.length} date${upcoming.length === 1 ? '' : 's'} coming up · next: ${upcoming[0]!.entry.title}, ${describeUpcoming(upcoming[0]!)}`,
                  () => onOpen(upcoming[0]!.entry.id)
                )}
              {snap.trash.length > 0 &&
                health('trash', 'ok', <Trash2 size={17} />, 'Recently Deleted', `${snap.trash.length} item${snap.trash.length === 1 ? '' : 's'} can still be restored`, () =>
                  onNavigate({ view: 'trash' })
                )}
            </ul>
          </>
        )}

        {favorites.length > 0 && (
          <>
            {sectionHead('Favorites', () => onNavigate({ view: 'items', filter: 'favorites' }))}
            <ul className="list card recent-list">{favorites.map((e) => row(e))}</ul>
          </>
        )}

        {recentlyUsed.length > 0 && (
          <>
            {sectionHead('Recently used', recentlyUsed.length > USED ? () => toggle('used') : undefined, expanded.used, recentlyUsed.length)}
            <ul className="list card recent-list">{(expanded.used ? recentlyUsed : recentlyUsed.slice(0, USED)).map((e) => row(e, 'used'))}</ul>
          </>
        )}

        {recent.length > 0 && (
          <>
            {sectionHead('Recently updated', recent.length > RECENT ? () => toggle('updated') : undefined, expanded.updated, recent.length)}
            <ul className="list card recent-list">{(expanded.updated ? recent : recent.slice(0, RECENT)).map((e) => row(e))}</ul>
            <button type="button" className="btn block dash-all-items" onClick={() => onNavigate({ view: 'items', filter: 'all' })}>
              See all {stats.total} items
            </button>
          </>
        )}

        {backupDue && (
          <div className="banner strong" role="status" style={{ marginTop: 20 }}>
            <TriangleAlert size={18} aria-hidden />
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{meta.lastBackupAt ? 'Time for a new backup' : 'You have no backup yet'}</div>
              <div className="small muted">Your vault is stored only on this device. Keep an encrypted backup somewhere safe.</div>
            </div>
            <button type="button" className="btn sm" onClick={() => onNavigate({ view: 'settings', tab: 'vault' })}>
              Back up now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
