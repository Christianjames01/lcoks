import { Archive, CalendarClock, ChevronRight, CopyCheck, Copy, KeyRound, Plus, Search, ShieldAlert, ShieldCheck, Star, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { subtitleFor } from '../../shared/categories';
import { describeUpcoming, upcomingDates } from '../../shared/expiry';
import type { EntryView, VaultSnapshot } from '../../shared/types';
import { BankIcon } from '../components/BankIcon';
import { CategoryIcon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';
import { brandOf, isCardCategory } from '../lib/cardSpec';
import { daysSince, greeting, relativeTime } from '../lib/format';
import type { Route } from './VaultApp';

interface Props {
  snap: VaultSnapshot;
  mobile: boolean;
  onOpen: (id: string) => void;
  onNavigate: (r: Route) => void;
  onNew: (categoryId?: string) => void;
  onSearch: () => void;
  onImport: () => void;
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

type Health = 'ok' | 'warn' | 'bad';

export function Dashboard({ snap, mobile, onOpen, onNavigate, onNew, onSearch, onImport }: Props) {
  const toast = useToast();
  const [catQuery, setCatQuery] = useState('');
  const [dupCount, setDupCount] = useState<number | null>(null);
  const { settings, meta, stats } = snap;

  // Duplicate check only reads the vault; nothing is changed.
  useEffect(() => {
    let cancelled = false;
    void api.vault.findDuplicates().then((r) => !cancelled && setDupCount(r.ok ? r.value.length : null));
    return () => {
      cancelled = true;
    };
  }, [snap]);

  const recent = useMemo(() => [...snap.entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6), [snap.entries]);
  const favorites = useMemo(() => snap.entries.filter((e) => e.favorite).sort((a, b) => a.favoriteOrder - b.favoriteOrder).slice(0, 4), [snap.entries]);
  const upcoming = useMemo(() => upcomingDates(snap.entries).slice(0, 5), [snap.entries]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of snap.entries) m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + 1);
    return m;
  }, [snap.entries]);
  const categories = snap.categories.filter((c) => !catQuery.trim() || c.name.toLowerCase().includes(catQuery.trim().toLowerCase()));

  const backupAge = daysSince(meta.lastBackupAt);
  const backupDue = settings.backupReminderDays > 0 && stats.total > 0 && backupAge > settings.backupReminderDays;
  const lockText =
    settings.backgroundLockMinutes === 0
      ? 'Locks as soon as you leave the app'
      : settings.autoLockMinutes === 0
        ? 'Auto-lock is off'
        : `Auto-locks after ${settings.autoLockMinutes} min of inactivity`;

  const copySecret = async (e: EntryView) => {
    const key = e.secrets.password?.set ? 'password' : Object.keys(e.secrets).find((k) => e.secrets[k]?.set);
    if (!key) return;
    try {
      const { seconds } = await unwrap(api.vault.copyField(e.id, key));
      toast(`Copied. Clipboard clears in ${seconds}s.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const row = (e: EntryView) => {
    const cat = snap.categories.find((c) => c.id === e.categoryId);
    const hasSecret = Object.values(e.secrets).some((s) => s.set);
    return (
      <li key={e.id} className="row-flex" style={{ gap: 4 }}>
        <button type="button" className="row" onClick={() => onOpen(e.id)}>
          {isCardCategory(e.categoryId) ? (
            <BankIcon bankName={brandOf(e)} title={e.title} />
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
              {subtitleFor(cat, e.fields) || cat?.name} · {relativeTime(e.updatedAt)}
            </span>
          </span>
          {e.favorite && (
            <span className="row-end">
              <Star size={13} className="star" fill="currentColor" aria-label="Favorite" />
            </span>
          )}
        </button>
        {hasSecret && (
          <button type="button" className="icon-btn" onClick={() => copySecret(e)} aria-label={`Copy secret for ${e.title}`} title="Copy password">
            <Copy size={16} />
          </button>
        )}
      </li>
    );
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

  return (
    <div className="page">
      <div className="page-narrow">
        <section className="card hero" aria-label="Vault status">
          <span className="hero-icon" aria-hidden>
            <ShieldCheck size={28} />
          </span>
          <div className="grow">
            {!mobile && <div className="muted small">{greeting()}</div>}
            <h2 className="h2" style={{ margin: 0 }}>
              Vault unlocked
            </h2>
            <div className="muted small">
              {stats.total} item{stats.total === 1 ? '' : 's'} · AES-256 encrypted · {lockText}
            </div>
          </div>
        </section>

        {mobile && (
          <button type="button" className="search" style={{ width: '100%', marginBottom: 14, padding: 0, border: 0, background: 'none' }} onClick={onSearch} aria-label="Search vault">
            <Search size={16} className="search-icon" style={{ top: 13, left: 13 }} aria-hidden />
            <span className="input" style={{ display: 'flex', alignItems: 'center', paddingLeft: 38, color: 'var(--muted)', borderRadius: 14 }}>
              Search vault
            </span>
          </button>
        )}

        <div className="section-title" style={{ marginTop: 0 }}>
          <span className="label">Quick add</span>
        </div>
        <div className="quick-add" role="group" aria-label="Quick add">
          {QUICK_ADD.filter(([id]) => snap.categories.some((c) => c.id === id)).map(([id, label]) => (
            <button key={id} type="button" className="qchip" onClick={() => onNew(id)}>
              <CategoryIcon icon={snap.categories.find((c) => c.id === id)?.icon} /> {label}
            </button>
          ))}
          <button type="button" className="qchip" onClick={onImport}>
            <Upload size={16} aria-hidden /> Import notes
          </button>
        </div>

        <div className="stats" style={{ margin: '6px 0 20px' }}>
          <button type="button" className="card stat" onClick={() => onNavigate({ view: 'items', filter: 'all' })}>
            <div className="num">{stats.total}</div>
            <span className="label">Items</span>
          </button>
          <button type="button" className="card stat" onClick={() => onNavigate({ view: 'items', filter: 'favorites' })}>
            <div className="num">{stats.favorites}</div>
            <span className="label">Favorites</span>
          </button>
          <button type="button" className="card stat" onClick={() => onNavigate({ view: 'items', filter: 'cat:notes' })}>
            <div className="num">{stats.notes}</div>
            <span className="label">Secure notes</span>
          </button>
          <button type="button" className="card stat" onClick={() => onNavigate({ view: 'items', filter: 'all' })} title="Files attached to items">
            <div className="num">{stats.attachments}</div>
            <span className="label">Attachments</span>
          </button>
        </div>

        {stats.total === 0 ? (
          <div className="card empty" style={{ marginBottom: 20 }}>
            <div className="empty-icon">
              <Plus size={20} aria-hidden />
            </div>
            <div className="h3">Your vault is empty</div>
            <div className="muted small">Add passwords, bank accounts, cards, IDs, documents and secure notes.</div>
            <div className="row-flex" style={{ marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" className="btn primary" onClick={() => onNew()}>
                <Plus size={15} aria-hidden /> Add your first item
              </button>
              <button type="button" className="btn" onClick={onImport}>
                <Upload size={15} aria-hidden /> Import notes
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="section-title">
              <span className="label">Security status</span>
            </div>
            <ul className="card health" aria-label="Security status">
              {health(
                'weak',
                stats.weak > 0 ? 'warn' : 'ok',
                stats.weak > 0 ? <ShieldAlert size={17} /> : <KeyRound size={17} />,
                'Password strength',
                stats.weak > 0 ? `${stats.weak} weak password${stats.weak === 1 ? '' : 's'}` : 'No weak passwords',
                () => onNavigate({ view: 'items', filter: stats.weak > 0 ? 'weak' : 'all' })
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

        <div className="section-title">
          <span className="label">Categories</span>
          <button type="button" className="linkish" onClick={() => onNavigate({ view: 'settings', tab: 'categories' })}>
            Manage
          </button>
        </div>
        {snap.categories.length > 8 && (
          <div className="search" style={{ width: '100%', marginBottom: 10 }}>
            <Search size={15} className="search-icon" style={{ top: 13, left: 12 }} aria-hidden />
            <input
              type="search"
              placeholder="Find a category"
              aria-label="Find a category"
              style={{ height: 42, paddingLeft: 36 }}
              value={catQuery}
              onChange={(e) => setCatQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
        )}
        <div className="cat-grid">
          {categories.map((c) => (
            <button key={c.id} type="button" className="card cat-tile" onClick={() => onNavigate({ view: 'items', filter: `cat:${c.id}` })}>
              <span className="row-icon" aria-hidden>
                <CategoryIcon icon={c.icon} size={19} />
              </span>
              <span>
                <span className="cat-name" style={{ display: 'block' }}>
                  {c.name}
                </span>
                <span className="cat-count">
                  {counts.get(c.id) ?? 0} item{(counts.get(c.id) ?? 0) === 1 ? '' : 's'}
                </span>
              </span>
            </button>
          ))}
          {categories.length === 0 && <div className="muted small">No category matches “{catQuery}”.</div>}
        </div>

        {favorites.length > 0 && (
          <>
            <div className="section-title">
              <span className="label">Favorites</span>
              <button type="button" className="linkish" onClick={() => onNavigate({ view: 'items', filter: 'favorites' })}>
                View all
              </button>
            </div>
            <ul className="list card" style={{ padding: 6 }}>
              {favorites.map(row)}
            </ul>
          </>
        )}

        {recent.length > 0 && (
          <>
            <div className="section-title">
              <span className="label">Recently updated</span>
              <button type="button" className="linkish" onClick={() => onNavigate({ view: 'items', filter: 'all' })}>
                View all
              </button>
            </div>
            <ul className="list card" style={{ padding: 6 }}>
              {recent.map(row)}
            </ul>
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
