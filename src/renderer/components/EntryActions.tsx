import { Copy, ExternalLink, Pencil, Star, Trash2, User } from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EntryView } from '../../shared/types';
import { api } from '../lib/api';

/** Things you can do to an item from its row: menu, swipe and keyboard shortcuts all go through these. */
export interface EntryActions {
  copyPassword(e: EntryView): Promise<void>;
  copyUsername(e: EntryView): Promise<void>;
  openWebsite(e: EntryView): Promise<void>;
  toggleFavorite(e: EntryView): Promise<void>;
  edit(e: EntryView): void;
  remove(e: EntryView): void;
  /** Long-press / right-click menu at a screen point. */
  openMenu(e: EntryView, at: { x: number; y: number }): void;
}

const Ctx = createContext<EntryActions | null>(null);
export const EntryActionsProvider = Ctx.Provider;
export function useEntryActions(): EntryActions | null {
  return useContext(Ctx);
}

/** The secret field a "copy password" copies: the password, else the first secret that is set. */
export function passwordKeyOf(e: EntryView): string | undefined {
  if (e.secrets.password?.set) return 'password';
  return Object.keys(e.secrets).find((k) => e.secrets[k]?.set);
}

const USERNAME_KEYS: [string, string][] = [
  ['username', 'Username'],
  ['email', 'Email'],
  ['mobileNumber', 'Mobile number'],
  ['accountName', 'Account name']
];
export function usernameOf(e: EntryView): { label: string; value: string } | null {
  for (const [k, label] of USERNAME_KEYS) if (e.fields[k]) return { label, value: e.fields[k]! };
  return null;
}
export function websiteOf(e: EntryView): string | undefined {
  return e.fields.website || e.fields.url || undefined;
}

// ------------------------------------------------------------------- menu --

export function EntryMenu({
  entry,
  at,
  sheet,
  actions,
  onClose
}: {
  entry: EntryView;
  at: { x: number; y: number };
  /** Phone: a centred menu card instead of a pop-up at the pointer. */
  sheet: boolean;
  actions: EntryActions;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // The finger that long-pressed to open this menu is still down: when it lifts, the
  // browser may send a click to whatever item is now under it. Only a press that
  // starts on the menu counts (keyboard activation has detail 0 and always counts).
  const pressed = useRef(false);
  const user = usernameOf(entry);
  const secretKey = passwordKeyOf(entry);
  const site = websiteOf(entry);

  const items: { key: string; label: string; icon: ReactNode; run: () => void; danger?: boolean }[] = [];
  if (secretKey)
    items.push({ key: 'pw', label: secretKey === 'password' ? 'Copy password' : `Copy ${secretKey === 'pin' ? 'PIN' : 'secret'}`, icon: <Copy size={16} />, run: () => void actions.copyPassword(entry) });
  if (user) items.push({ key: 'user', label: `Copy ${user.label.toLowerCase()}`, icon: <User size={16} />, run: () => void actions.copyUsername(entry) });
  if (site) items.push({ key: 'site', label: 'Open website', icon: <ExternalLink size={16} />, run: () => void actions.openWebsite(entry) });
  items.push({ key: 'edit', label: 'Edit', icon: <Pencil size={16} />, run: () => actions.edit(entry) });
  items.push({
    key: 'fav',
    label: entry.favorite ? 'Remove from favorites' : 'Add to favorites',
    icon: <Star size={16} fill={entry.favorite ? 'currentColor' : 'none'} />,
    run: () => void actions.toggleFavorite(entry)
  });
  items.push({ key: 'del', label: 'Delete', icon: <Trash2 size={16} />, run: () => actions.remove(entry), danger: true });

  // Keep the pop-up inside the window.
  useLayoutEffect(() => {
    if (sheet || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8));
    const top = Math.max(8, at.y + r.height > window.innerHeight - 8 ? at.y - r.height : at.y);
    setPos({ left, top });
  }, [at, sheet]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    // Desktop: a positioned menu would be misplaced after the window changes size.
    // Phones: the keyboard closing (focus moves into the menu) also resizes the
    // window — that must not close the sheet the moment it opens.
    const startWidth = window.innerWidth;
    const onResize = (e: Event) => {
      if (sheet) return;
      if (e.type === 'resize' && window.innerWidth === startWidth) return;
      onClose();
    };
    // Escape closes the menu even when focus is not inside it.
    const onWindowKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || ref.current?.contains(document.activeElement)) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    window.addEventListener('keydown', onWindowKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
      window.removeEventListener('keydown', onWindowKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose, sheet]);

  const onKey = (e: KeyboardEvent) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    }
  };

  return createPortal(
    <div
      className={`menu-backdrop ${sheet ? 'hold-menu-backdrop' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        className={sheet ? 'hold-menu' : 'context-menu'}
        role="menu"
        aria-label={`Actions for ${entry.title}`}
        onKeyDown={onKey}
        onPointerDown={() => (pressed.current = true)}
        style={sheet ? undefined : { left: pos?.left ?? at.x, top: pos?.top ?? at.y, visibility: pos ? 'visible' : 'hidden' }}
      >
        {sheet && <div className="sheet-title">{entry.title}</div>}
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            className={`menu-item ${it.danger ? 'danger' : ''}`}
            onClick={(e) => {
              if (e.detail !== 0 && !pressed.current) return;
              onClose();
              it.run();
            }}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        ))}
        {sheet && (
          <button type="button" className="menu-item cancel" onClick={(e) => (e.detail === 0 || pressed.current) && onClose()}>
            Cancel
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

// -------------------------------------------------------- gesture row --

const ACTIONS_W = 148;
const COPY_AT = 76;
const LONG_PRESS_MS = 480;

/** The row whose swipe actions are showing (only one at a time). */
let openRow: { current: () => void } | null = null;

/**
 * Wraps an item row: right-click / long-press opens the item menu, and on phones
 * a swipe right copies the password and a swipe left shows Favorite and Delete.
 */
export function GestureRow({ entry, swipe, children }: { entry: EntryView; swipe: boolean; children: ReactNode }) {
  const actions = useEntryActions();
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const g = useRef({ x: 0, y: 0, mode: 'idle' as 'idle' | 'pending' | 'drag' | 'scroll' | 'long', timer: 0, suppress: false, menuAt: 0, armed: false });
  const copyKey = passwordKeyOf(entry);
  const user = usernameOf(entry);
  const canCopy = !!copyKey || !!user;

  const close = () => {
    setOpen(false);
    setDx(0);
    if (openRow === closeRef) openRow = null;
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => () => window.clearTimeout(g.current.timer), []);

  if (!actions) return <>{children}</>;

  const showMenu = (x: number, y: number) => {
    g.current.menuAt = Date.now();
    actions.openMenu(entry, { x, y });
  };

  return (
    <div
      className={`gesture-row ${swipe ? 'swipeable' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (openRow && openRow !== closeRef) openRow.current();
        const s = g.current;
        s.suppress = false;
        s.x = e.clientX;
        s.y = e.clientY;
        s.mode = 'pending';
        s.armed = false;
        window.clearTimeout(s.timer);
        if (e.pointerType !== 'mouse') {
          s.timer = window.setTimeout(() => {
            if (s.mode !== 'pending') return;
            s.mode = 'long';
            s.suppress = true;
            api.app.haptic('tap');
            showMenu(s.x, s.y);
          }, LONG_PRESS_MS);
        }
      }}
      onPointerMove={(e) => {
        const s = g.current;
        const ddx = e.clientX - s.x;
        const ddy = e.clientY - s.y;
        if (s.mode === 'pending') {
          if (Math.hypot(ddx, ddy) > 8) window.clearTimeout(s.timer);
          if (swipe && e.pointerType !== 'mouse' && Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy) * 1.4) {
            s.mode = 'drag';
            setDragging(true);
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
          } else if (Math.abs(ddy) > 10) {
            s.mode = 'scroll';
          }
        }
        if (s.mode !== 'drag') return;
        let x = (open ? -ACTIONS_W : 0) + ddx;
        if (x > 0) x = canCopy ? Math.min(x, 150) : Math.min(x * 0.25, 30);
        if (x < -ACTIONS_W) x = -ACTIONS_W - (-ACTIONS_W - x) * 0.25;
        const past = x > COPY_AT && canCopy;
        if (past !== s.armed) {
          s.armed = past;
          if (past) api.app.haptic('tap');
        }
        setDx(x);
      }}
      onPointerUp={() => {
        const s = g.current;
        window.clearTimeout(s.timer);
        if (s.mode === 'drag') {
          s.suppress = true;
          setDragging(false);
          if (dx > COPY_AT && canCopy) {
            close();
            void (copyKey ? actions.copyPassword(entry) : actions.copyUsername(entry));
          } else if (dx < -ACTIONS_W / 2) {
            setOpen(true);
            setDx(-ACTIONS_W);
            openRow = closeRef;
          } else {
            close();
          }
        }
        s.mode = 'idle';
      }}
      onPointerCancel={() => {
        const s = g.current;
        window.clearTimeout(s.timer);
        if (s.mode === 'drag') {
          setDragging(false);
          if (open) setDx(-ACTIONS_W);
          else setDx(0);
        }
        s.mode = 'idle';
      }}
      onClickCapture={(e) => {
        // Taps on Favorite / Delete go through; anything else right after a drag or long-press is swallowed.
        if ((e.target as Element).closest('.swipe-actions')) return;
        const s = g.current;
        if (s.suppress || open) {
          e.preventDefault();
          e.stopPropagation();
          s.suppress = false;
          if (open) close();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (Date.now() - g.current.menuAt < 1000) return;
        let { clientX: x, clientY: y } = e;
        if (x === 0 && y === 0) {
          const r = e.currentTarget.getBoundingClientRect();
          x = r.left + 40;
          y = r.top + r.height / 2;
        }
        showMenu(x, y);
      }}
    >
      {swipe && (dx !== 0 || open) && (
        <>
          {dx > 0 && (
            <div className={`swipe-under copy ${dx > COPY_AT ? 'armed' : ''}`} aria-hidden>
              <Copy size={18} />
              <span>{copyKey ? (copyKey === 'password' ? 'Copy password' : 'Copy') : user ? `Copy ${user.label.toLowerCase()}` : ''}</span>
            </div>
          )}
          {dx < 0 && (
            <div className="swipe-actions">
              <button
                type="button"
                className="swipe-btn fav"
                tabIndex={-1}
                onClick={() => {
                  close();
                  void actions.toggleFavorite(entry);
                }}
              >
                <Star size={18} fill={entry.favorite ? 'currentColor' : 'none'} />
                {entry.favorite ? 'Unfavorite' : 'Favorite'}
              </button>
              <button
                type="button"
                className="swipe-btn del"
                tabIndex={-1}
                onClick={() => {
                  close();
                  actions.remove(entry);
                }}
              >
                <Trash2 size={18} />
                Delete
              </button>
            </div>
          )}
        </>
      )}
      <div className={`gesture-content ${dragging ? 'dragging' : ''}`} style={dx ? { transform: `translateX(${dx}px)` } : undefined}>
        {children}
      </div>
    </div>
  );
}
