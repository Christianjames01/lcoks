import { RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { TRASH_DAYS, type TrashView as TrashItem, type VaultSnapshot } from '../../shared/types';
import { ConfirmDialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { EntryIcon } from '../components/EntryIcon';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';
import { formatDate } from '../lib/format';

import { tr } from '../../shared/i18n';
function daysLeft(deletedAt: string): number {
  const ms = new Date(deletedAt).getTime() + TRASH_DAYS * 86_400_000 - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** Recently Deleted: restore, delete one permanently, or empty (all confirmed). */
export function TrashView({ snap, onChanged }: { snap: VaultSnapshot; onChanged: () => Promise<void> }) {
  const [purging, setPurging] = useState<TrashItem | null>(null);
  const [emptying, setEmptying] = useState(false);
  const toast = useToast();
  const items = [...snap.trash].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  const restore = async (t: TrashItem) => {
    try {
      await unwrap(api.vault.restoreEntry(t.id));
      await onChanged();
      toast(tr("“{0}” restored.", [t.title]));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="row-flex" style={{ alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="grow" style={{ flex: 1, minWidth: 220 }}>
            <h2 className="h2" style={{ margin: 0 }}>
              {tr("Recently Deleted")}
            </h2>
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              {tr("Deleted items (with their attachments) are kept for")} {TRASH_DAYS} {tr("days, then removed permanently.")}
            </p>
          </div>
          {items.length > 0 && (
            <button type="button" className="btn sm danger" onClick={() => setEmptying(true)}>
              <Trash2 size={14} aria-hidden /> {tr("Empty")}
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <EmptyState card art="trash" title={tr("Nothing here")} text={tr("Items you delete appear here for {0} days, so you can restore them.", [TRASH_DAYS])} />
        ) : (
          <ul className="list card" style={{ padding: 6 }}>
            {items.map((t) => {
              const cat = snap.categories.find((c) => c.id === t.categoryId);
              const left = daysLeft(t.deletedAt);
              return (
                <li key={t.id} className="row-flex" style={{ gap: 4, flexWrap: 'wrap' }}>
                  <div className="row" style={{ cursor: 'default', flex: 1, minWidth: 200 }}>
                    <EntryIcon entry={t} category={cat} />
                    <span className="row-main">
                      <span className="row-title" style={{ display: 'block' }}>
                        {t.title}
                      </span>
                      <span className="row-sub" style={{ display: 'block' }}>
                        {cat?.name ?? tr("Item")} {tr("· deleted")} {formatDate(t.deletedAt)} · {left} {tr("day")}{left === 1 ? '' : 's'} {tr("left")}
                        {t.attachmentCount ? tr(" · {0} attachment(s)", [t.attachmentCount]) : ''}
                      </span>
                    </span>
                  </div>
                  <button type="button" className="btn sm" onClick={() => void restore(t)} aria-label={tr("Restore {0}", [t.title])}>
                    <RotateCcw size={14} aria-hidden /> {tr("Restore")}
                  </button>
                  <button type="button" className="icon-btn" onClick={() => setPurging(t)} aria-label={tr("Delete {0} permanently", [t.title])} title={tr("Delete permanently")}>
                    <Trash2 size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {purging && (
        <ConfirmDialog placement="center"
          title={tr("Delete permanently?")}
          danger
          confirmLabel={tr("Delete permanently")}
          message={
            <>
              <strong style={{ color: 'var(--fg)' }}>{purging.title}</strong> {tr("and its attachments will be erased from this device. This cannot be undone.")}
            </>
          }
          onCancel={() => setPurging(null)}
          onConfirm={async () => {
            try {
              await unwrap(api.vault.purgeEntry(purging.id));
              setPurging(null);
              await onChanged();
              toast(tr("Deleted permanently."));
            } catch (e) {
              setPurging(null);
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
      {emptying && (
        <ConfirmDialog placement="center"
          title={tr("Empty Recently Deleted?")}
          danger
          confirmLabel={tr("Delete {0} item{1}", [items.length, items.length === 1 ? '' : 's'])}
          message={<>{tr("All")} {items.length} {tr("item(s) in Recently Deleted and their attachments will be erased permanently. This cannot be undone.")}</>}
          onCancel={() => setEmptying(false)}
          onConfirm={async () => {
            try {
              const n = await unwrap(api.vault.emptyTrash());
              setEmptying(false);
              await onChanged();
              toast(tr("{0} item(s) deleted permanently.", [n]));
            } catch (e) {
              setEmptying(false);
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
    </div>
  );
}
