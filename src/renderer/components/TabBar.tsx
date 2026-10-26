import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { api } from '../lib/api';

import { tr } from '../../shared/i18n';
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Phone bottom bar with a glass highlight that slides to the open tab. Press on the
 * bar and slide: the highlight follows the finger (snapping over the + button) and
 * letting go opens the tab under it. A plain tap works as before.
 * Tabs are the children with `data-tab`; anything else (the + button) is left alone.
 */
export function TabBar({ current, onPick, children }: { current: string; onPick: (tab: string) => void; children: ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef({ id: -1, x: 0, moved: false, swallow: false, last: '' });

  const tabs = () => [...(nav.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])];
  const boxOf = (el: HTMLElement): Box => ({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });

  /** Highlight sits on the open tab (hidden when the open screen has no tab, e.g. Settings). */
  const place = useCallback(() => {
    const el = tabs().find((t) => t.dataset.tab === current);
    setBox(el ? boxOf(el) : null);
  }, [current]);

  useLayoutEffect(() => {
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [place]);

  /** The tab whose centre is nearest to x (relative to the bar). */
  const nearest = (x: number) => {
    let best: HTMLElement | null = null;
    let dist = Infinity;
    for (const t of tabs()) {
      const d = Math.abs(t.offsetLeft + t.offsetWidth / 2 - x);
      if (d < dist) {
        dist = d;
        best = t;
      }
    }
    return best;
  };

  const localX = (e: PointerEvent) => e.clientX - (nav.current?.getBoundingClientRect().left ?? 0);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('.fab')) return;
    drag.current = { id: e.pointerId, x: e.clientX, moved: false, swallow: false, last: '' };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d.id !== e.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < 8) return;
      d.moved = true;
      setDragging(true);
      try {
        nav.current?.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    }
    const all = tabs();
    const first = all[0];
    const last = all[all.length - 1];
    const target = nearest(localX(e));
    if (!first || !last || !target) return;
    const w = target.offsetWidth;
    // Follow the finger, kept within the first and last tab.
    const left = Math.max(first.offsetLeft, Math.min(last.offsetLeft + last.offsetWidth - w, localX(e) - w / 2));
    setBox({ left, top: target.offsetTop, width: w, height: target.offsetHeight });
    const tab = target.dataset.tab ?? '';
    if (tab !== d.last) {
      d.last = tab;
      setHover(tab);
      api.app.haptic('tap');
    }
  };

  const finish = (e: PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    if (d.id !== e.pointerId) return;
    d.id = -1;
    if (!d.moved) return;
    d.swallow = true; // the click that follows a drag must not also tap a tab
    setDragging(false);
    setHover(null);
    const target = cancelled ? null : nearest(localX(e));
    const tab = target?.dataset.tab;
    if (tab && tab !== current) onPick(tab);
    else place();
  };

  return (
    <nav
      ref={nav}
      className={`bottom-nav has-indicator ${dragging ? 'dragging' : ''}`}
      aria-label={tr("Main")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onClickCapture={(e) => {
        if (drag.current.swallow) {
          e.preventDefault();
          e.stopPropagation();
          drag.current.swallow = false;
        }
      }}
      data-hover={hover ?? undefined}
    >
      {box && <span className="tab-indicator" aria-hidden style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />}
      {children}
    </nav>
  );
}
