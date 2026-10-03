import { RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { TRASH_DAYS, type TrashView as TrashItem, type VaultSnapshot } from '../../shared/types';
import { ConfirmDialog } from '../components/Dialog';
import { CategoryIcon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';
import { formatDate } from '../lib/format';

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
      toast(`“${t.title}” restored.`);
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
              Recently Deleted
            </h2>
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              Deleted items (with their attachments) are kept for {TRASH_DAYS} days, then removed permanently.
            </p>
          </div>
          {items.length > 0 && (
            <button type="button" className="btn sm danger" onClick={() => setEmptying(true)}>
              <Trash2 size={14} aria-hidden /> Empty
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon">
              <Trash2 size={20} aria-hidden />
            </div>
            <div className="h3">Nothing here</div>
            <div className="muted small">Items you delete appear here so you can restore them.</div>
          </div>
        ) : (
          <ul className="list card" style={{ padding: 6 }}>
            {items.map((t) => {
              const cat = snap.categories.find((c) => c.id === t.categoryId);
              const left = daysLeft(t.deletedAt);
              return (
                <li key={t.id} className="row-flex" style={{ gap: 4, flexWrap: 'wrap' }}>
                  <div className="row" style={{ cursor: 'default', flex: 1, minWidth: 200 }}>
                    <span className="row-icon">
                      <CategoryIcon icon={cat?.icon} />
                    </span>
                    <span className="row-main">
                      <span className="row-title" style={{ display: 'block' }}>
                        {t.title}
                      </span>
                      <span className="row-sub" style={{ display: 'block' }}>
                        {cat?.name ?? 'Item'} · deleted {formatDate(t.deletedAt)} · {left} day{left === 1 ? '' : 's'} left
                        {t.attachmentCount ? ` · ${t.attachmentCount} attachment(s)` : ''}
                      </span>
                    </span>
                  </div>
                  <button type="button" className="btn sm" onClick={() => void restore(t)} aria-label={`Restore ${t.title}`}>
                    <RotateCcw size={14} aria-hidden /> Restore
                  </button>
                  <button type="button" className="icon-btn" onClick={() => setPurging(t)} aria-label={`Delete ${t.title} permanently`} title="Delete permanently">
                    <Trash2 size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {purging && (
        <ConfirmDialog
          title="Delete permanently?"
          danger
          confirmLabel="Delete permanently"
          message={
            <>
              <strong style={{ color: 'var(--fg)' }}>{purging.title}</strong> and its attachments will be erased from this device. This cannot be undone.
            </>
          }
          onCancel={() => setPurging(null)}
          onConfirm={async () => {
            try {
              await unwrap(api.vault.purgeEntry(purging.id));
              setPurging(null);
              await onChanged();
              toast('Deleted permanently.');
            } catch (e) {
              setPurging(null);
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
      {emptying && (
        <ConfirmDialog
          title="Empty Recently Deleted?"
          danger
          confirmLabel={`Delete ${items.length} item${items.length === 1 ? '' : 's'}`}
          message={<>All {items.length} item(s) in Recently Deleted and their attachments will be erased permanently. This cannot be undone.</>}
          onCancel={() => setEmptying(false)}
          onConfirm={async () => {
            try {
              const n = await unwrap(api.vault.emptyTrash());
              setEmptying(false);
              await onChanged();
              toast(`${n} item(s) deleted permanently.`);
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
