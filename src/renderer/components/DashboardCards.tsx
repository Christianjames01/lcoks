import { ChevronRight, Copy, HardDrive, Lock, LockOpen, MoreHorizontal, Star } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { SecurityReport } from '../../shared/security';
import type { CategoryDef, EntryView, StorageInfo } from '../../shared/types';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { ScoreRing } from '../views/SecurityView';
import { GestureRow, useEntryActions } from './EntryActions';
import { EntryIcon } from './EntryIcon';
import { CategoryIcon } from './Icon';

import { tr } from '../../shared/i18n';
// ------------------------------------------------------------ vault status --

/** Concentric rings around the lock: the vault's emblem on the dashboard. */
function VaultEmblem() {
  return (
    <span className="vault-emblem" aria-hidden>
      <svg className="ve-svg" viewBox="0 0 72 72" width="72" height="72" focusable="false">
        <circle cx="36" cy="36" r="34" className="ve-ring outer" />
        <circle cx="36" cy="36" r="26" className="ve-ring" />
        <circle cx="36" cy="36" r="18" className="ve-core" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return <line key={i} x1={36 + Math.cos(a) * 28.5} y1={36 + Math.sin(a) * 28.5} x2={36 + Math.cos(a) * 31.5} y2={36 + Math.sin(a) * 31.5} className="ve-tick" />;
        })}
      </svg>
      <LockOpen className="ve-lock" size={20} strokeWidth={1.8} />
    </span>
  );
}

interface Metric {
  label: string;
  value: number;
  onClick: () => void;
}

/**
 * The vault's real state. This card only exists inside the unlocked vault, so it
 * always reads "Unlocked"; "Lock now" uses the same lock as the title bar.
 */
export function VaultStatusCard({
  greeting,
  description,
  metrics,
  report,
  onLock,
  onSecurity
}: {
  greeting?: string;
  description: string;
  metrics: Metric[];
  report: SecurityReport;
  onLock: () => void;
  onSecurity: () => void;
}) {
  return (
    <section className="vault-card" aria-label={tr("Vault status")}>
      <div className="vault-card-head">
        <VaultEmblem />
        <div className="grow">
          {greeting && <div className="vault-greeting">{greeting}</div>}
          <h2 className="vault-card-title">{tr("Your vault is open")}</h2>
          <span className="status-pill" role="status">
            <span className="status-dot" aria-hidden /> {tr("Unlocked")}
          </span>
        </div>
      </div>
      <p className="vault-card-desc">{description}</p>
      <div className="vault-metrics">
        {metrics.map((m) => (
          <button key={m.label} type="button" className="vault-metric" onClick={m.onClick}>
            <span className="vm-num">{m.value}</span>
            <span className="vm-label">{m.label}</span>
          </button>
        ))}
      </div>
      <div className="vault-card-actions">
        <button type="button" className="btn primary" onClick={onLock}>
          <Lock size={15} aria-hidden /> {tr("Lock now")}
        </button>
        {report.score !== null && (
          <button type="button" className="vault-score" onClick={onSecurity}>
            <ScoreRing report={report} size={34} />
            <span className="grow">
              <span className="vs-title">{tr("Security score")} {report.score}</span>
              <span className="vs-sub">
                {report.label}
                {report.issues.length ? tr(" · {0} to fix", [report.issues.length]) : ''}
              </span>
            </span>
            <ChevronRight size={16} aria-hidden className="dim" />
          </button>
        )}
      </div>
    </section>
  );
}

// ----------------------------------------------------------- storage usage --

/** Space used by the vault file and its attachments (real figures from the vault). */
export function StorageUsageCard({ refreshKey, onOpen }: { refreshKey: unknown; onOpen: () => void }) {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.attachments.storageInfo().then((r) => {
      if (cancelled) return;
      if (r.ok) setInfo(r.value);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (failed) return null;
  const used = info ? info.vaultBytes + info.attachmentBytes : 0;
  const total = info && info.freeBytes !== null ? used + info.freeBytes : null;
  const share = total ? Math.max(1, Math.min(100, (used / Math.max(1, total)) * 100)) : null;
  const vaultShare = info && used ? (info.vaultBytes / used) * 100 : 0;

  return (
    <button type="button" className="storage-card" onClick={onOpen} aria-busy={!info}>
      <span className="sc-icon" aria-hidden>
        <HardDrive size={18} strokeWidth={1.75} />
      </span>
      <span className="grow">
        <span className="sc-title">{tr("Storage")}</span>
        {info ? (
          <span className="sc-sub">
            {formatBytes(used)} {tr("used ·")} {info.attachmentCount} {tr("file")}{info.attachmentCount === 1 ? '' : 's'}
            {info.freeBytes !== null ? tr(" · {0} free", [formatBytes(info.freeBytes)]) : ''}
          </span>
        ) : (
          <span className="skeleton skeleton-line" style={{ width: '60%', marginTop: 6 }} />
        )}
        {info && (
          <span
            className="sc-bar"
            role="img"
            aria-label={tr("Vault data {0}, attachments {1}{2}", [formatBytes(info.vaultBytes), formatBytes(info.attachmentBytes), total ? `, ${share!.toFixed(1)}% of this device's available space` : ''])}
          >
            <span className="sc-fill" style={{ width: share !== null ? `${share}%` : '100%' }}>
              <span className="sc-vault" style={{ width: `${vaultShare}%` }} />
            </span>
          </span>
        )}
      </span>
      <ChevronRight size={16} aria-hidden className="dim" />
    </button>
  );
}

// ------------------------------------------------------------ quick action --

export function QuickActionCard({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" className="qa-card" onClick={onClick}>
      <span className="qa-icon" aria-hidden>
        {icon}
      </span>
      <span className="qa-label">{label}</span>
      {hint && <span className="qa-hint">{hint}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- category --

export function CategoryCard({ category, count, onClick }: { category: Pick<CategoryDef, 'id' | 'name' | 'icon'>; count: number; onClick: () => void }) {
  return (
    <button type="button" className={`cat-card ${count === 0 ? 'is-empty' : ''}`} data-cat={category.id} onClick={onClick}>
      <span className="cat-card-icon" aria-hidden>
        <CategoryIcon icon={category.icon} size={19} />
      </span>
      <span className="cat-card-name">{category.name}</span>
      <span className="cat-card-count">
        {count} {tr("item")}{count === 1 ? '' : 's'}
      </span>
    </button>
  );
}

// ------------------------------------------------------------- recent item --

/**
 * An item row on the dashboard. The row opens the item; the copy and "more"
 * buttons are separate controls so they never trigger the row's navigation.
 */
export function RecentItemCard({
  entry,
  category,
  subtitle,
  swipe,
  onOpen
}: {
  entry: EntryView;
  category: CategoryDef | undefined;
  subtitle: string;
  swipe: boolean;
  onOpen: (id: string, row?: Element | null) => void;
}) {
  const actions = useEntryActions();
  const hasSecret = Object.values(entry.secrets).some((s) => s.set);
  const isNote = entry.categoryId === 'notes';
  return (
    <li>
      <GestureRow entry={entry} swipe={swipe}>
        <div className="recent-card">
          <button type="button" className="row" data-id={entry.id} onClick={(ev) => onOpen(entry.id, ev.currentTarget)}>
            <EntryIcon entry={entry} category={category} />
            <span className="row-main">
              <span className="row-title" data-vt="title" style={{ display: 'block' }}>
                {entry.title}
              </span>
              <span className="row-sub" style={{ display: 'block' }}>
                {isNote && <Lock size={11} aria-hidden className="inline-lock" />}
                {subtitle}
              </span>
            </span>
            {entry.favorite && (
              <span className="row-end">
                <Star size={13} className="star" fill="currentColor" aria-label={tr("Favorite")} />
              </span>
            )}
          </button>
          {hasSecret && actions && !isNote && (
            <button type="button" className="icon-btn" onClick={() => void actions.copyPassword(entry)} aria-label={tr("Copy secret for {0}", [entry.title])} title={tr("Copy password")}>
              <Copy size={16} />
            </button>
          )}
          {actions && (
            <button
              type="button"
              className="icon-btn"
              aria-label={tr("More actions for {0}", [entry.title])}
              aria-haspopup="menu"
              title={tr("More")}
              onClick={(ev) => {
                ev.stopPropagation();
                const r = ev.currentTarget.getBoundingClientRect();
                actions.openMenu(entry, { x: r.left, y: r.bottom + 4 });
              }}
            >
              <MoreHorizontal size={16} />
            </button>
          )}
        </div>
      </GestureRow>
    </li>
  );
}
