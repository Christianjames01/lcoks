import { Copy, Plus, Search, ShieldCheck, Star, TriangleAlert, Upload } from 'lucide-react';
import { subtitleFor } from '../../shared/categories';
import type { EntryView, VaultSnapshot } from '../../shared/types';
import { CategoryIcon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';
import { daysSince, greeting, relativeTime } from '../lib/format';
import type { Route } from './VaultApp';

interface Props {
  snap: VaultSnapshot;
  onOpen: (id: string) => void;
  onNavigate: (r: Route) => void;
  onNew: () => void;
  onSearch: (q: string) => void;
  onImport: () => void;
}

export function Dashboard({ snap, onOpen, onNavigate, onNew, onSearch, onImport }: Props) {
  const toast = useToast();
  const recent = [...snap.entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const favorites = snap.entries.filter((e) => e.favorite).sort((a, b) => a.favoriteOrder - b.favoriteOrder).slice(0, 4);
  const { settings, meta, stats } = snap;
  const backupDue = settings.backupReminderDays > 0 && stats.total > 0 && daysSince(meta.lastBackupAt) > settings.backupReminderDays;
  const lockText = settings.autoLockMinutes === 0 ? 'Auto-lock is off' : `Auto-locks after ${settings.autoLockMinutes} min of inactivity`;

  const copyPassword = async (e: EntryView) => {
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
          <span className="row-icon">
            <CategoryIcon icon={cat?.icon} />
          </span>
          <span className="row-main">
            <span className="row-title" style={{ display: 'block' }}>
              {e.title}
            </span>
            <span className="row-sub" style={{ display: 'block' }}>
              {subtitleFor(cat, e.fields)} · {relativeTime(e.updatedAt)}
            </span>
          </span>
          <span className="row-end" aria-hidden>
            {e.favorite && <Star size={13} className="star" fill="currentColor" />}
            {hasSecret ? '••••••••' : ''}
          </span>
        </button>
        {hasSecret && (
          <button type="button" className="icon-btn" onClick={() => copyPassword(e)} aria-label={`Copy secret for ${e.title}`} title="Copy password">
            <Copy size={15} />
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="row-flex" style={{ alignItems: 'flex-start', marginBottom: 28 }}>
          <div style={{ flex: 1 }}>
            <h1 className="h1">{greeting()}</h1>
            <p className="muted row-flex" style={{ margin: '6px 0 0', gap: 8 }}>
              <ShieldCheck size={16} aria-hidden /> Your vault is protected · <span className="dim">{lockText}</span>
            </p>
          </div>
        </div>

        <div className="stats" style={{ marginBottom: 20 }}>
          <button type="button" className="card stat" onClick={() => onNavigate({ view: 'items', filter: 'all' })}>
            <div className="num">{stats.total}</div>
            <span className="label">Items</span>
          </button>
          <button type="button" className="card stat" onClick={() => onNavigate({ view: 'items', filter: 'all' })}>
            <div className="num">{stats.withPasswords}</div>
            <span className="label">Passwords</span>
          </button>
          <button type="button" className="card stat" onClick={() => onNavigate({ view: 'items', filter: 'cat:notes' })}>
            <div className="num">{stats.notes}</div>
            <span className="label">Secure notes</span>
          </button>
          <button type="button" className="card stat" onClick={() => onNavigate({ view: 'items', filter: 'weak' })}>
            <div className="num">{stats.weak}</div>
            <span className="label">Weak passwords</span>
          </button>
        </div>

        {backupDue && (
          <div className="banner strong" role="status" style={{ marginBottom: 20 }}>
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

        <div className="search" style={{ width: '100%' }}>
          <Search size={15} className="search-icon" style={{ top: 12, left: 12 }} aria-hidden />
          <input
            type="search"
            placeholder="Search vault…"
            aria-label="Search vault"
            style={{ height: 40, paddingLeft: 36 }}
            onChange={(e) => onSearch(e.target.value)}
            autoComplete="off"
          />
        </div>

        {stats.total === 0 ? (
          <div className="card empty" style={{ marginTop: 24 }}>
            <div className="empty-icon">
              <Plus size={20} aria-hidden />
            </div>
            <div className="h3">Your vault is empty</div>
            <div className="muted small">Add bank accounts, logins, Wi-Fi passwords, licenses and secure notes.</div>
            <div className="row-flex" style={{ marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" className="btn primary" onClick={onNew}>
                <Plus size={15} aria-hidden /> Add your first item
              </button>
              <button type="button" className="btn" onClick={onImport}>
                <Upload size={15} aria-hidden /> Import notes
              </button>
            </div>
          </div>
        ) : (
          <>
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
            <div className="section-title">
              <span className="label">Recent items</span>
              <span className="row-flex" style={{ gap: 14 }}>
                <button type="button" className="linkish" onClick={onImport}>
                  Import notes
                </button>
                <button type="button" className="linkish" onClick={() => onNavigate({ view: 'items', filter: 'all' })}>
                  View all
                </button>
              </span>
            </div>
            <ul className="list card" style={{ padding: 6 }}>
              {recent.map(row)}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
