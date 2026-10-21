import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';

/** How long to press before the actions appear. */
export const HOLD_MS = 2000;

export interface ActionItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  run: () => void;
}

/** Actions menu for press-and-hold: a small glass card in the centre of the screen. */
export function ActionSheet({ title, items, onClose }: { title: string; items: ActionItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => previous?.focus?.();
  }, []);
  const onKey = (e: KeyboardEvent) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    }
  };
  return createPortal(
    <div className="menu-backdrop hold-menu-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="hold-menu" role="menu" aria-label={title} onKeyDown={onKey}>
        <div className="sheet-title">{title}</div>
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            className={`menu-item ${it.danger ? 'danger' : ''}`}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        ))}
        <button type="button" role="menuitem" className="menu-item cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}

/**
 * Press and hold (HOLD_MS) to open actions — with a ring that fills while holding.
 * Right-click, the Menu key, Shift+F10 open them straight away; Delete runs onDelete.
 * A tap still does the normal thing (open), and after a hold the tap is swallowed.
 */
export function HoldArea({
  title,
  items,
  onDelete,
  className,
  children,
  swipe
}: {
  title: string;
  items: ActionItem[];
  onDelete?: () => void;
  className?: string;
  children: ReactNode;
  /** Swipe right to reveal these actions (shown behind the row). */
  swipe?: ActionItem[];
}) {
  const [holding, setHolding] = useState(false);
  const [open, setOpen] = useState(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const g = useRef({ x: 0, y: 0, timer: 0, mode: 'idle' as 'idle' | 'press' | 'drag' | 'scroll', swallow: false, base: 0 });
  const SWIPE_OPEN = swipe ? 76 * swipe.length : 0;

  const stopHold = () => {
    window.clearTimeout(g.current.timer);
    setHolding(false);
  };
  useEffect(() => () => window.clearTimeout(g.current.timer), []);

  const showActions = () => {
    stopHold();
    g.current.swallow = true;
    api.app.haptic('warning');
    setDx(0);
    setOpen(true);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    g.current = { ...g.current, x: e.clientX, y: e.clientY, mode: 'press', swallow: false, base: dx };
    setHolding(true);
    g.current.timer = window.setTimeout(showActions, HOLD_MS);
  };
  const onPointerMove = (e: PointerEvent) => {
    const s = g.current;
    if (s.mode === 'idle' || s.mode === 'scroll') return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (s.mode === 'press' && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      stopHold();
      if (swipe && Math.abs(mx) > Math.abs(my)) {
        s.mode = 'drag';
        setDragging(true);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* pointer already gone */
        }
      } else {
        s.mode = 'scroll';
        return;
      }
    }
    if (s.mode === 'drag') setDx(Math.max(0, Math.min(SWIPE_OPEN + 60, s.base + mx)));
  };
  const onPointerEnd = () => {
    const s = g.current;
    stopHold();
    if (s.mode === 'drag') {
      s.swallow = true;
      setDragging(false);
      setDx((d) => (d > SWIPE_OPEN / 2 ? SWIPE_OPEN : 0));
    }
    s.mode = 'idle';
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'Delete' && onDelete) {
      e.preventDefault();
      onDelete();
    }
  };

  return (
    <div
      className={`hold-area ${className ?? ''} ${holding ? 'holding' : ''} ${swipe ? 'swipeable' : ''} ${dx > 0 || dragging ? 'swiped' : ''}`}
      style={{ ['--hold-ms' as string]: `${HOLD_MS}ms` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={() => g.current.mode === 'press' && onPointerEnd()}
      onContextMenu={(e) => {
        e.preventDefault();
        stopHold();
        setOpen(true);
      }}
      onClickCapture={(e) => {
        if (g.current.swallow) {
          e.preventDefault();
          e.stopPropagation();
          g.current.swallow = false;
        } else if (dx > 0) {
          // Row is swiped open: a tap closes it.
          e.preventDefault();
          e.stopPropagation();
          setDx(0);
        }
      }}
      onKeyDown={onKey}
    >
      {swipe && (
        <div className="swipe-behind" style={{ width: SWIPE_OPEN, visibility: dx > 0 || dragging ? 'visible' : 'hidden' }} aria-hidden={dx === 0}>
          {swipe.map((it) => (
            <button
              key={it.key}
              type="button"
              className={`swipe-act ${it.danger ? 'danger' : ''}`}
              tabIndex={dx === 0 ? -1 : 0}
              onClick={(e) => {
                e.stopPropagation();
                setDx(0);
                it.run();
              }}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className={`hold-content ${dragging ? 'dragging' : ''}`} style={swipe ? { transform: `translateX(${dx}px)` } : undefined}>
        {children}
        <span className="hold-ring" aria-hidden />
      </div>
      {open && <ActionSheet title={title} items={items} onClose={() => setOpen(false)} />}
    </div>
  );
}
