import { Camera, ChevronLeft, ChevronRight, Download, ExternalLink, File as FileIcon, FileText, FolderOpen, ImagePlus, Images, Paperclip, Pencil, Plus, Trash, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AttachmentInput, AttachmentMeta } from '../../shared/types';
import { api, errorMessage, unwrap } from '../lib/api';
import { FileError, LARGE_FILE_BYTES, dataUrlOf, decodeText, isImage, isPdf, isText, kindLabel, pickFiles, toAttachmentInput, type PickSource } from '../lib/files';
import { formatBytes, formatDateTime } from '../lib/format';
import { isAndroid } from '../lib/platform';
import { ConfirmDialog, Dialog } from './Dialog';
import { useToast } from './Toast';

// ------------------------------------------------------------ add sheet --

/** "Add Attachment" choices: Take Photo / Choose from Gallery / Choose File. */
export function AddAttachmentSheet({ onPick, onClose }: { onPick: (source: PickSource) => void; onClose: () => void }) {
  return (
    <Dialog title="Add attachment" onClose={onClose} size="narrow">
      <div className="action-list">
        <button type="button" className="btn" onClick={() => onPick('camera')} data-autofocus>
          <Camera size={20} aria-hidden /> Take photo
        </button>
        <button type="button" className="btn" onClick={() => onPick('gallery')}>
          <Images size={20} aria-hidden /> Choose from gallery
        </button>
        <button type="button" className="btn" onClick={() => onPick('file')}>
          <FolderOpen size={20} aria-hidden /> Choose file
        </button>
      </div>
      <p className="help-text" style={{ marginTop: 14, marginBottom: 0 }}>
        Photos, PDFs, text files and documents up to 25 MB. Files are encrypted with your vault key and never leave this device unless you export them.
      </p>
    </Dialog>
  );
}

/** Read picked files; errors for individual files are reported, the rest continue. */
export async function readPicked(files: File[], onError: (msg: string) => void, onLarge: () => void): Promise<AttachmentInput[]> {
  const out: AttachmentInput[] = [];
  for (const f of files) {
    try {
      if (f.size > LARGE_FILE_BYTES) onLarge();
      out.push(await toAttachmentInput(f));
    } catch (e) {
      onError(e instanceof FileError ? e.message : 'A file could not be read.');
    }
  }
  return out;
}

// --------------------------------------------------------------- section --

interface Props {
  entryId: string;
  /** Card / ID items can use photos as the front and back of the card. */
  cardRoles: boolean;
  hidePreviews: boolean;
  onChanged: () => Promise<void> | void;
}

/** Attachments of a saved item: grid, add, view, export, delete. */
export function AttachmentsSection({ entryId, cardRoles, hidePreviews, onChanged }: Props) {
  const [items, setItems] = useState<AttachmentMeta[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dupQueue, setDupQueue] = useState<{ input: AttachmentInput; existing: AttachmentMeta }[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [doc, setDoc] = useState<AttachmentMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setItems(await unwrap(api.attachments.list(entryId)));
    } catch (e) {
      toast(errorMessage(e), 'error');
      setItems([]);
    }
  }, [entryId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const afterChange = async () => {
    await load();
    await onChanged();
  };

  const addInputs = async (inputs: AttachmentInput[]) => {
    let added = 0;
    const dups: { input: AttachmentInput; existing: AttachmentMeta }[] = [];
    for (const input of inputs) {
      try {
        const r = await unwrap(api.attachments.add(entryId, input));
        if (r.status === 'duplicate') dups.push({ input, existing: r.existing });
        else added++;
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    }
    if (added) toast(added === 1 ? 'Attachment added and encrypted.' : `${added} attachments added and encrypted.`);
    if (dups.length) setDupQueue((q) => [...q, ...dups]);
    await afterChange();
  };

  const pick = async (source: PickSource) => {
    setAdding(false);
    const files = await pickFiles(source);
    if (!files.length) return;
    setBusy(true);
    try {
      const inputs = await readPicked(
        files,
        (m) => toast(m, 'error'),
        () => toast('Large file — encrypting may take a moment.')
      );
      await addInputs(inputs);
    } finally {
      setBusy(false);
    }
  };

  const dup = dupQueue[0];
  const images = (items ?? []).filter((a) => isImage(a.mime));

  return (
    <section className="att-section" aria-label="Attachments">
      <div className="att-head">
        <span className="label">
          <Paperclip size={12} aria-hidden style={{ verticalAlign: -1 }} /> Attachments {items && items.length > 0 ? `(${items.length})` : ''}
        </span>
        <button type="button" className="btn sm" onClick={() => setAdding(true)} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden /> : <Plus size={14} aria-hidden />} Add attachment
        </button>
      </div>
      {items === null ? (
        <div className="att-empty">
          <span className="spinner" aria-label="Loading attachments" />
        </div>
      ) : items.length === 0 ? (
        <div className="att-empty">No attachments. Add photos of documents, PDFs or other files.</div>
      ) : (
        <div className="att-grid">
          {items.map((a) => (
            <AttachmentTile
              key={a.id}
              meta={a}
              hidden={hidePreviews}
              onOpen={() => (isImage(a.mime) ? setViewing(a.id) : setDoc(a))}
            />
          ))}
        </div>
      )}

      {adding && <AddAttachmentSheet onPick={(s) => void pick(s)} onClose={() => setAdding(false)} />}

      {dup && (
        <Dialog
          title="Possible duplicate"
          onClose={() => setDupQueue((q) => q.slice(1))}
          size="narrow"
          role="alertdialog"
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDupQueue((q) => q.slice(1))} data-autofocus>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  setDupQueue((q) => q.slice(1));
                  await addInputs([{ ...dup.input, allowDuplicate: true }]);
                }}
              >
                Keep both
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            This file appears to already be attached as <strong>{dup.existing.name}</strong> ({formatBytes(dup.existing.size)}, added {formatDateTime(dup.existing.createdAt)}).
          </p>
        </Dialog>
      )}

      {viewing && images.length > 0 && (
        <ImageViewer
          entryId={entryId}
          images={images}
          startId={viewing}
          cardRoles={cardRoles}
          onClose={() => setViewing(null)}
          onChanged={afterChange}
        />
      )}
      {doc && <DocumentViewer entryId={entryId} meta={doc} onClose={() => setDoc(null)} onChanged={afterChange} />}
    </section>
  );
}

function AttachmentTile({ meta, hidden, onOpen }: { meta: AttachmentMeta; hidden: boolean; onOpen: () => void }) {
  const [peek, setPeek] = useState(false);
  const blurred = hidden && !peek;
  return (
    <button
      type="button"
      className="att-tile"
      onClick={() => (blurred && meta.thumb ? setPeek(true) : onOpen())}
      aria-label={`${meta.name}, ${kindLabel(meta.mime)}, ${formatBytes(meta.size)}${blurred && meta.thumb ? '. Preview hidden, tap to show' : ''}`}
    >
      {meta.role && <span className="att-role">{meta.role === 'front' ? 'Card front' : 'Card back'}</span>}
      <span className={`att-thumb ${blurred ? 'hidden' : ''}`} aria-hidden>
        {meta.thumb ? <img src={meta.thumb} alt="" /> : isPdf(meta.mime) || isText(meta.mime) ? <FileText size={30} strokeWidth={1.5} /> : <FileIcon size={30} strokeWidth={1.5} />}
      </span>
      <span className="att-meta">
        <span className="att-name">{meta.name}</span>
        <span className="att-sub">
          {kindLabel(meta.mime)} · {formatBytes(meta.size)}
        </span>
      </span>
    </button>
  );
}

// ------------------------------------------------------- shared actions --

function useAttachmentActions(entryId: string, onChanged: () => Promise<void> | void) {
  const toast = useToast();
  return {
    exportFile: async (meta: AttachmentMeta) => {
      try {
        const r = await unwrap(api.attachments.exportFile(entryId, meta.id));
        if (r) toast(isAndroid() ? 'Exported. A decrypted copy now exists wherever you saved it.' : 'Exported. The saved copy is not encrypted.');
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
    openWith: async (meta: AttachmentMeta) => {
      try {
        await unwrap(api.attachments.openWith(entryId, meta.id));
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
    remove: async (meta: AttachmentMeta) => {
      try {
        await unwrap(api.attachments.remove(entryId, meta.id));
        toast('Attachment deleted.');
        await onChanged();
        return true;
      } catch (e) {
        toast(errorMessage(e), 'error');
        return false;
      }
    },
    rename: async (meta: AttachmentMeta, name: string) => {
      try {
        await unwrap(api.attachments.update(entryId, meta.id, { name }));
        await onChanged();
        return true;
      } catch (e) {
        toast(errorMessage(e), 'error');
        return false;
      }
    },
    setRole: async (meta: AttachmentMeta, role: 'front' | 'back' | null) => {
      try {
        await unwrap(api.attachments.update(entryId, meta.id, { role }));
        toast(role ? `Set as the card ${role}.` : 'Removed from the card.');
        await onChanged();
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    }
  };
}

function RenameDialog({ meta, onClose, onSave }: { meta: AttachmentMeta; onClose: () => void; onSave: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState(meta.name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    if (await onSave(name.trim())) onClose();
    else setBusy(false);
  };
  return (
    <Dialog
      title="Rename attachment"
      onClose={onClose}
      size="narrow"
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            Save
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="att-name">File name</label>
          <input id="att-name" className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoComplete="off" data-autofocus />
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------- document viewer --

export function DocumentViewer({ entryId, meta, onClose, onChanged }: { entryId: string; meta: AttachmentMeta; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const [text, setText] = useState<string | null>(null);
  const [pages, setPages] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const actions = useAttachmentActions(entryId, onChanged);
  const canPreview = isText(meta.mime) || (isPdf(meta.mime) && isAndroid());

  // Decrypted content lives only in this dialog's state and is dropped on close.
  useEffect(
    () => () => {
      setText(null);
      setPages(null);
    },
    []
  );

  const preview = async () => {
    setLoading(true);
    setPreviewError(null);
    try {
      if (isText(meta.mime)) {
        const b64 = await unwrap(api.attachments.read(entryId, meta.id));
        const t = decodeText(b64);
        setText(t.length > 300_000 ? `${t.slice(0, 300_000)}\n\n… (preview truncated)` : t);
      } else if (isPdf(meta.mime)) {
        setPages(await unwrap(api.attachments.renderPdf(entryId, meta.id)));
      }
    } catch (e) {
      setPreviewError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog
        title={meta.name}
        subtitle={kindLabel(meta.mime)}
        onClose={onClose}
        size="wide"
        footer={
          <>
            <button type="button" className="btn danger left" onClick={() => setConfirmDelete(true)}>
              <Trash size={15} aria-hidden /> Delete
            </button>
            {isAndroid() && (
              <button type="button" className="btn" onClick={() => void actions.openWith(meta)}>
                <ExternalLink size={15} aria-hidden /> Open with…
              </button>
            )}
            <button type="button" className="btn" onClick={() => void actions.exportFile(meta)}>
              <Download size={15} aria-hidden /> Export
            </button>
          </>
        }
      >
        <dl className="kv card">
          <dt>Name</dt>
          <dd className="row-flex" style={{ gap: 6 }}>
            <span style={{ wordBreak: 'break-word' }}>{meta.name}</span>
            <button type="button" className="icon-btn" onClick={() => setRenaming(true)} aria-label="Rename attachment" title="Rename">
              <Pencil size={14} />
            </button>
          </dd>
          <dt>Type</dt>
          <dd>
            {kindLabel(meta.mime)} <span className="dim">({meta.mime})</span>
          </dd>
          <dt>Size</dt>
          <dd>{formatBytes(meta.size)}</dd>
          <dt>Added</dt>
          <dd>{formatDateTime(meta.createdAt)}</dd>
          <dt>Storage</dt>
          <dd>Encrypted (AES-256-GCM) inside your vault</dd>
        </dl>
        {canPreview && !text && !pages && (
          <button type="button" className="btn" style={{ marginTop: 14 }} onClick={() => void preview()} disabled={loading}>
            {loading ? <span className="spinner" aria-hidden /> : <FileText size={15} aria-hidden />} Show preview
          </button>
        )}
        {!canPreview && (
          <p className="help-text" style={{ marginTop: 14 }}>
            {isPdf(meta.mime) ? 'PDF preview is available in the Android app. ' : 'This file type cannot be previewed inside VaultLocks. '}
            {isAndroid() ? 'Use “Open with…” to view it in another app; the temporary copy is deleted automatically.' : 'Use Export to save a copy you can open.'}
          </p>
        )}
        {previewError && (
          <div className="notice danger" role="alert" style={{ marginTop: 14 }}>
            {previewError}
          </div>
        )}
        {text !== null && (
          <div className="doc-preview">
            <pre>{text}</pre>
          </div>
        )}
        {pages && (
          <div className="doc-preview" aria-label="PDF preview">
            {pages.map((src, i) => (
              <img key={i} src={src} alt={`Page ${i + 1}`} />
            ))}
            {pages.length === 0 && <div className="card-pad muted">This PDF has no pages.</div>}
          </div>
        )}
      </Dialog>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete attachment?"
          danger
          confirmLabel="Delete attachment"
          message={
            <>
              <strong style={{ color: 'var(--fg)' }}>{meta.name}</strong> will be permanently removed from this item. This cannot be undone.
            </>
          }
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            if (await actions.remove(meta)) onClose();
          }}
        />
      )}
      {renaming && <RenameDialog meta={meta} onClose={() => setRenaming(false)} onSave={(n) => actions.rename(meta, n)} />}
    </>
  );
}

// ---------------------------------------------------------- image viewer --

const MAX_SCALE = 6;

/** Full-screen image viewer: pinch / wheel zoom, drag to pan, swipe or arrows for next/previous. */
export function ImageViewer({
  entryId,
  images,
  startId,
  cardRoles,
  onClose,
  onChanged
}: {
  entryId: string;
  images: AttachmentMeta[];
  startId: string;
  cardRoles: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex((i) => i.id === startId)));
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scale, setScale] = useState(1);
  const ref = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; x: number; y: number; sx: number; sy: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);
  const actions = useAttachmentActions(entryId, onChanged);
  const meta = images[Math.min(index, images.length - 1)]!;

  const render = () => {
    const v = view.current;
    if (imgRef.current) imgRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
    setScale(v.scale);
  };
  const reset = () => {
    view.current = { scale: 1, x: 0, y: 0 };
    render();
  };
  const zoomBy = (f: number) => {
    const v = view.current;
    v.scale = Math.min(MAX_SCALE, Math.max(1, v.scale * f));
    if (v.scale === 1) {
      v.x = 0;
      v.y = 0;
    }
    render();
  };

  // Load the decrypted image only while it is on screen.
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    reset();
    void (async () => {
      try {
        const b64 = await unwrap(api.attachments.read(entryId, meta.id));
        if (!cancelled) setSrc(dataUrlOf(meta.mime, b64));
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id, entryId]);

  useEffect(() => () => setSrc(null), []);

  const go = (d: number) => setIndex((i) => (i + d + images.length) % images.length);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const handleKey = (e: { key: string; stopPropagation: () => void }) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!confirmDelete) onClose();
    } else if (e.key === 'ArrowRight' && images.length > 1) go(1);
    else if (e.key === 'ArrowLeft' && images.length > 1) go(-1);
    else if (e.key === '+' || e.key === '=') zoomBy(1.4);
    else if (e.key === '-') zoomBy(1 / 1.4);
  };
  const onKey = (e: React.KeyboardEvent) => handleKey(e);
  // Keys also work if focus left the viewer (e.g. a focused button was removed).
  const keyRef = useRef(handleKey);
  keyRef.current = handleKey;
  useEffect(() => {
    const onWindowKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (!el || el.contains(document.activeElement)) return;
      const open = document.querySelectorAll('.dialog, .viewer');
      if (open[open.length - 1] === el) keyRef.current(e);
    };
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const v = view.current;
    gesture.current = {
      dist: pts.length >= 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0,
      scale: v.scale,
      x: v.x,
      y: v.y,
      sx: e.clientX,
      sy: e.clientY,
      moved: false
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const v = view.current;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.dist > 0) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      v.scale = Math.min(MAX_SCALE, Math.max(1, (g.scale * d) / g.dist));
      g.moved = true;
    } else if (v.scale > 1) {
      v.x = g.x + (e.clientX - g.sx);
      v.y = g.y + (e.clientY - g.sy);
      g.moved = true;
    } else if (Math.abs(e.clientX - g.sx) > 10) {
      g.moved = true;
    }
    render();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (!g) return;
    const dx = e.clientX - g.sx;
    if (view.current.scale <= 1.01) {
      if (images.length > 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - g.sy)) return go(dx < 0 ? 1 : -1);
      reset();
    }
    if (!g.moved) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        // Double tap: toggle zoom.
        if (view.current.scale > 1) reset();
        else zoomBy(2.5);
        lastTap.current = 0;
      } else lastTap.current = now;
    }
  };

  return createPortal(
    <div ref={ref} className="viewer" role="dialog" aria-modal="true" aria-label={`Image viewer: ${meta.name}`} tabIndex={-1} onKeyDown={onKey}>
      <div className="viewer-top">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close viewer">
          <X size={20} />
        </button>
        <span className="viewer-title">{meta.name}</span>
        {images.length > 1 && (
          <span className="counter" aria-live="polite">
            {index + 1} / {images.length}
          </span>
        )}
        <button type="button" className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Delete image">
          <Trash size={18} />
        </button>
      </div>

      <div
        className="viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)}
      >
        {src ? (
          <img ref={imgRef} src={src} alt={meta.name} draggable={false} />
        ) : error ? (
          <div role="alert" style={{ padding: 24, textAlign: 'center' }}>
            {error}
          </div>
        ) : (
          <span className="spinner" aria-label="Decrypting image" />
        )}
      </div>

      {images.length > 1 && (
        <>
          <button type="button" className="icon-btn viewer-nav prev" onClick={() => go(-1)} aria-label="Previous image">
            <ChevronLeft size={24} />
          </button>
          <button type="button" className="icon-btn viewer-nav next" onClick={() => go(1)} aria-label="Next image">
            <ChevronRight size={24} />
          </button>
        </>
      )}

      <div className="viewer-bottom">
        <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.4)} disabled={scale <= 1} aria-label="Zoom out">
          <ZoomOut size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={() => zoomBy(1.4)} disabled={scale >= MAX_SCALE} aria-label="Zoom in">
          <ZoomIn size={18} />
        </button>
        {cardRoles && (
          <>
            <button
              type="button"
              className="btn sm"
              style={{ background: 'rgba(255,255,255,0.14)', color: '#fff', borderColor: 'transparent' }}
              onClick={() => void actions.setRole(meta, meta.role === 'front' ? null : 'front')}
              aria-pressed={meta.role === 'front'}
            >
              <ImagePlus size={14} aria-hidden /> {meta.role === 'front' ? 'Card front ✓' : 'Use as card front'}
            </button>
            <button
              type="button"
              className="btn sm"
              style={{ background: 'rgba(255,255,255,0.14)', color: '#fff', borderColor: 'transparent' }}
              onClick={() => void actions.setRole(meta, meta.role === 'back' ? null : 'back')}
              aria-pressed={meta.role === 'back'}
            >
              {meta.role === 'back' ? 'Card back ✓' : 'Use as back'}
            </button>
          </>
        )}
        <button type="button" className="icon-btn" onClick={() => void actions.exportFile(meta)} aria-label="Export image">
          <Download size={18} />
        </button>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete image?"
          danger
          confirmLabel="Delete image"
          message={
            <>
              <strong style={{ color: 'var(--fg)' }}>{meta.name}</strong> will be permanently removed from this item. This cannot be undone.
            </>
          }
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            if (await actions.remove(meta)) {
              if (images.length <= 1) onClose();
              else setIndex((i) => Math.min(i, images.length - 2));
            }
          }}
        />
      )}
    </div>,
    document.body
  );
}
