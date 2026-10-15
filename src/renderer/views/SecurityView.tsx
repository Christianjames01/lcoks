import { Archive, ChevronRight, KeyRound, Repeat2, ShieldAlert, Timer } from 'lucide-react';
import { useMemo } from 'react';
import { subtitleFor } from '../../shared/categories';
import { securityReport, type IssueId, type SecurityReport } from '../../shared/security';
import type { EntryView, VaultSnapshot } from '../../shared/types';
import { EmptyState } from '../components/EmptyState';
import { EntryIcon } from '../components/EntryIcon';
import { GestureRow } from '../components/EntryActions';
import { relativeTime } from '../lib/format';
import { MOBILE_QUERY, useMediaQuery } from '../lib/platform';
import type { Route } from './VaultApp';

const ICONS: Record<IssueId, React.ReactNode> = {
  weak: <ShieldAlert size={18} aria-hidden />,
  reused: <Repeat2 size={18} aria-hidden />,
  old: <Timer size={18} aria-hidden />,
  backup: <Archive size={18} aria-hidden />
};

/** How many affected items to list per issue before "Show all". */
const PREVIEW = 5;

/** Circular 0–100 score. Colour follows the level, and the label says it in words too. */
export function ScoreRing({ report, size = 52, onClick }: { report: SecurityReport; size?: number; onClick?: () => void }) {
  const score = report.score ?? 0;
  const ring = (
    <span className={`score-ring lvl-${report.level}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" aria-hidden focusable="false">
        <circle className="track" cx="18" cy="18" r="15.5" pathLength="100" />
        <circle className="value" cx="18" cy="18" r="15.5" pathLength="100" style={{ strokeDasharray: `${score} 100` }} />
      </svg>
      <span className="score-num" style={{ fontSize: Math.round(size * 0.32) }}>
        {report.score ?? '–'}
      </span>
    </span>
  );
  if (!onClick) return ring;
  return (
    <button type="button" className="score-btn" onClick={onClick} aria-label={`Security score ${score} of 100, ${report.label}. Show what to fix.`} title="Security check-up">
      {ring}
    </button>
  );
}

export function SecurityView({ snap, onOpen, onNavigate }: { snap: VaultSnapshot; onOpen: (id: string, row?: Element | null) => void; onNavigate: (r: Route) => void }) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const report = useMemo(() => securityReport(snap.entries, snap.meta, snap.settings.backupReminderDays), [snap]);

  const row = (e: EntryView) => {
    const cat = snap.categories.find((c) => c.id === e.categoryId);
    return (
      <li key={e.id}>
        <GestureRow entry={e} swipe={mobile}>
          <button type="button" className="row" data-id={e.id} onClick={(ev) => onOpen(e.id, ev.currentTarget)}>
            <EntryIcon entry={e} category={cat} />
            <span className="row-main">
              <span className="row-title" data-vt="title" style={{ display: 'block' }}>
                {e.title}
              </span>
              <span className="row-sub" style={{ display: 'block' }}>
                {subtitleFor(cat, e.fields) || cat?.name} · changed {relativeTime(e.updatedAt)}
              </span>
            </span>
            <ChevronRight size={16} aria-hidden className="dim" />
          </button>
        </GestureRow>
      </li>
    );
  };

  return (
    <div className="page">
      <div className="page-narrow">
        <section className="card security-hero" aria-label="Security score">
          <ScoreRing report={report} size={96} />
          <div className="grow">
            <div className="label">Security score</div>
            <h2 className="h2" style={{ margin: '2px 0 4px' }}>
              {report.score === null ? 'Nothing to check yet' : report.label}
            </h2>
            <div className="muted small">
              {report.score === null
                ? 'Add items and they will be checked here.'
                : `${report.passwords} password${report.passwords === 1 ? '' : 's'} checked for strength, reuse and age. Checks run on this device only.`}
            </div>
          </div>
        </section>

        {report.score !== null && report.issues.length === 0 && (
          <EmptyState card art="secure" title="All clear" text="No weak, reused or old passwords, and your backup is up to date." />
        )}

        {report.issues.map((issue) => {
          const filter = issue.id === 'backup' ? null : issue.id;
          return (
            <section key={issue.id} className="card issue" aria-labelledby={`issue-${issue.id}`}>
              <div className="issue-head">
                <span className={`health-dot ${issue.severity}`} aria-hidden>
                  {ICONS[issue.id]}
                </span>
                <div className="grow">
                  <h3 id={`issue-${issue.id}`} className="h3" style={{ margin: 0 }}>
                    {issue.title}
                  </h3>
                  <div className="muted small">{issue.detail}</div>
                </div>
                <span className="issue-pts" title="Points this costs your score">
                  −{issue.penalty}
                </span>
              </div>
              {issue.items.length > 0 && <ul className="list issue-list">{issue.items.slice(0, PREVIEW).map(row)}</ul>}
              <div className="issue-foot">
                {filter && issue.items.length > PREVIEW && (
                  <button type="button" className="btn sm" onClick={() => onNavigate({ view: 'items', filter })}>
                    Show all {issue.items.length}
                  </button>
                )}
                {issue.id === 'backup' && (
                  <button type="button" className="btn sm primary" onClick={() => onNavigate({ view: 'settings', tab: 'vault' })}>
                    <Archive size={14} aria-hidden /> Back up now
                  </button>
                )}
                {(issue.id === 'weak' || issue.id === 'reused') && (
                  <span className="muted small">
                    <KeyRound size={12} aria-hidden style={{ verticalAlign: -1 }} /> Open an item, then Edit → generate a new password.
                  </span>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
