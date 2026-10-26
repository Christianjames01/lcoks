import { CopyCheck, ExternalLink, Merge, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { DuplicateGroup, EntryView, VaultSnapshot } from '../../shared/types';
import { ConfirmDialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { api, errorMessage, unwrap } from '../lib/api';
import { formatDate } from '../lib/format';

import { tr } from '../../shared/i18n';
/** How complete an item is: filled fields, secrets, tags and attachments. */
function completeness(e: EntryView): number {
  return (
    Object.values(e.fields).filter((v) => v && v.trim()).length +
    Object.values(e.secrets).filter((s) => s.set).length +
    e.tags.length * 0.5 +
    e.attachmentCount
  );
}

/**
 * Review possible duplicates. Nothing is changed automatically: the user picks
 * which item to keep. Merging fills the kept item's empty fields from the others
 * and moves the others to Recently Deleted, so nothing is lost.
 */
export function DuplicatesView({ snap, onChanged, onOpen }: { snap: VaultSnapshot; onChanged: () => Promise<void>; onOpen: (id: string) => void }) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setGroups(await unwrap(api.vault.findDuplicates()));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, snap]);

  return (
    <div className="page">
      <div className="page-narrow">
        <h2 className="h2" style={{ margin: 0 }}>
          {tr("Duplicates")}
        </h2>
        <p className="muted small" style={{ margin: '4px 0 18px' }}>
          {tr("Items with the same name in a category, the same account / card / ID number, or the same login on the same website. Review each group — nothing is merged or deleted unless you choose to, and merged copies go to Recently Deleted.")}
        </p>
        {error && (
          <div className="notice danger" role="alert">
            {error}
          </div>
        )}
        {groups === null && !error && (
          <div className="empty">
            <span className="spinner" aria-label={tr("Checking for duplicates")} />
          </div>
        )}
        {groups && groups.length === 0 && (
          <EmptyState card art="secure" title={tr("No duplicates found")} text={tr("Your vault has no items that look like copies of each other.")} />
        )}
        {groups?.map((g) => (
          <DuplicateCard
            key={g.key}
            group={g}
            snap={snap}
            onOpen={onOpen}
            onDone={async (msg) => {
              toast(msg);
              await onChanged();
              await load();
            }}
            onError={(m) => toast(m, 'error')}
          />
        ))}
      </div>
    </div>
  );
}

function DuplicateCard({
  group,
  snap,
  onOpen,
  onDone,
  onError
}: {
  group: DuplicateGroup;
  snap: VaultSnapshot;
  onOpen: (id: string) => void;
  onDone: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const best = [...group.items].sort((a, b) => completeness(b) - completeness(a) || b.updatedAt.localeCompare(a.updatedAt))[0]!;
  const [keepId, setKeepId] = useState(best.id);
  const [confirm, setConfirm] = useState<null | 'merge' | { remove: EntryView }>(null);
  const keep = group.items.find((i) => i.id === keepId) ?? best;
  const others = group.items.filter((i) => i.id !== keep.id);
  const catName = (id: string) => snap.categories.find((c) => c.id === id)?.name ?? 'Item';

  const cell = (e: EntryView, key: string, secret: boolean) => {
    if (key === 'title') return e.title;
    if (key === 'tags') return e.tags.join(', ') || '—';
    if (secret) return e.secrets[key]?.set ? 'Saved (hidden)' : '—';
    return e.fields[key] || '—';
  };

  return (
    <section className="card dup-group" aria-label={tr("Possible duplicates: {0}", [group.items.map((i) => i.title).join(', ')])}>
      <div className="dup-head">
        <CopyCheck size={18} aria-hidden />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{group.items.length} {tr("similar items")}</div>
          <div className="muted small">{group.reasons.join(' · ')}</div>
        </div>
      </div>
      <div className="compare-wrap">
        <table className="compare">
          <thead>
            <tr>
              <th scope="col">{tr("Field")}</th>
              {group.items.map((e) => (
                <th key={e.id} scope="col" className={e.id === keep.id ? 'keep-col' : undefined}>
                  <label className="row-flex" style={{ gap: 6, cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: 12.5, color: 'var(--fg)' }}>
                    <input type="radio" name={`keep-${group.key}`} checked={e.id === keep.id} onChange={() => setKeepId(e.id)} aria-label={tr("Keep {0}", [e.title])} />
                    {tr("Keep this")}
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{tr("Category")}</th>
              {group.items.map((e) => (
                <td key={e.id} className={e.id === keep.id ? 'keep-col' : undefined}>
                  {catName(e.categoryId)}
                </td>
              ))}
            </tr>
            {group.fields.map((f) => (
              <tr key={f.key}>
                <th scope="row">
                  {f.label}
                  <div style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{f.status === 'same' ? 'same' : f.status === 'partial' ? tr("missing in some") : 'different'}</div>
                </th>
                {group.items.map((e) => (
                  <td key={e.id} className={`${e.id === keep.id ? 'keep-col' : ''} ${f.status === 'different' ? 'diff' : ''}`} style={{ wordBreak: 'break-word' }}>
                    {cell(e, f.key, f.secret)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">{tr("Attachments")}</th>
              {group.items.map((e) => (
                <td key={e.id} className={e.id === keep.id ? 'keep-col' : undefined}>
                  {e.attachmentCount}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">{tr("Updated")}</th>
              {group.items.map((e) => (
                <td key={e.id} className={e.id === keep.id ? 'keep-col' : undefined}>
                  {formatDate(e.updatedAt)}
                  <div>
                    <button type="button" className="linkish" onClick={() => onOpen(e.id)}>
                      {tr("Open")} <ExternalLink size={11} aria-hidden />
                    </button>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="dup-actions">
        <button type="button" className="btn sm primary" onClick={() => setConfirm('merge')}>
          <Merge size={14} aria-hidden /> {tr("Merge into “")}{keep.title}”
        </button>
        {others.length === 1 && (
          <button type="button" className="btn sm" onClick={() => setConfirm({ remove: others[0]! })}>
            <Trash2 size={14} aria-hidden /> {tr("Delete the other")}
          </button>
        )}
        <button
          type="button"
          className="btn sm ghost"
          onClick={async () => {
            try {
              await unwrap(api.vault.dismissDuplicate(group.key));
              await onDone(tr("Marked as not duplicates."));
            } catch (e) {
              onError(errorMessage(e));
            }
          }}
        >
          {tr("Not duplicates")}
        </button>
      </div>

      {confirm === 'merge' && (
        <ConfirmDialog placement="center"
          title={tr("Merge items?")}
          confirmLabel={tr("Merge")}
          message={
            <>
              <strong style={{ color: 'var(--fg)' }}>{keep.title}</strong> {tr("is kept. Its empty fields are filled from the other item(s), notes and tags are combined, and attachments are moved over. Field values that differ keep the kept item's version.")}
              <br />
              <br />
              {tr("The other")} {others.length} {tr("item(s) move to Recently Deleted, where you can restore them for 30 days.")}
            </>
          }
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await unwrap(api.vault.mergeEntries(keep.id, others.map((o) => o.id)));
              setConfirm(null);
              await onDone(tr("Items merged. The other copies are in Recently Deleted."));
            } catch (e) {
              setConfirm(null);
              onError(errorMessage(e));
            }
          }}
        />
      )}
      {confirm && typeof confirm === 'object' && (
        <ConfirmDialog placement="center"
          title={tr("Delete the other item?")}
          danger
          confirmLabel={tr("Move to Recently Deleted")}
          message={
            <>
              <strong style={{ color: 'var(--fg)' }}>{confirm.remove.title}</strong> {tr("moves to Recently Deleted without merging anything into “")}{keep.title}”.
            </>
          }
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await unwrap(api.vault.deleteEntry(confirm.remove.id));
              setConfirm(null);
              await onDone(tr("Moved to Recently Deleted."));
            } catch (e) {
              setConfirm(null);
              onError(errorMessage(e));
            }
          }}
        />
      )}
    </section>
  );
}
