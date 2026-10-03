import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'narrow' | 'normal' | 'wide';
  /** Prevent closing via Escape/backdrop (e.g. while saving). */
  busy?: boolean;
  role?: 'dialog' | 'alertdialog';
}

/** Accessible modal: focus trap, Escape to close, focus restored on close. */
export function Dialog({ title, subtitle, onClose, children, footer, size = 'normal', busy, role = 'dialog' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const first =
      el.querySelector<HTMLElement>('[data-autofocus]') ??
      el.querySelector<HTMLElement>('.dialog-body input, .dialog-body textarea, .dialog-body select, .dialog-body button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!busyRef.current) closeRef.current();
      } else if (e.key === 'Tab') {
        e.stopPropagation(); // nested dialogs: only the innermost traps focus
        const items = [
          ...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        ].filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
        if (items.length === 0) return;
        const firstEl = items[0]!;
        const lastEl = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    el.addEventListener('keydown', onKey);
    // Escape also works when focus fell out of the dialog (e.g. the focused button
    // disappeared) — handled only by the top-most dialog.
    const onWindowKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || el.contains(document.activeElement)) return;
      const open = document.querySelectorAll('.dialog, .viewer');
      if (open[open.length - 1] !== el) return;
      e.stopPropagation();
      if (!busyRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onWindowKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onWindowKey);
      previous?.focus?.();
    };
  }, []);

  // Portal: above the title bar and bottom navigation wherever the dialog is opened.
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={ref} className={`dialog ${size === 'normal' ? '' : size}`} role={role} aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog-head">
          <div className="grow">
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            {subtitle && (
              <div className="muted small" style={{ marginTop: 2 }}>
                {subtitle}
              </div>
            )}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close dialog" title="Close (Esc)">
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

interface ConfirmProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

/** Confirmation for destructive / significant actions. Cancel is focused by default. */
export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      size="narrow"
      busy={busy}
      role="alertdialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy} data-autofocus>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                if (mounted.current) setBusy(false);
              }
            }}
          >
            {busy && <span className="spinner" aria-hidden />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="muted" style={{ lineHeight: 1.6 }}>
        {message}
      </div>
    </Dialog>
  );
}
