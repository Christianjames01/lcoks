import { useEffect, useRef } from 'react';
import { api } from './api';

/** Report user activity to main (resets the auto-lock timer), throttled to 1 per 5 s. */
export function useActivityReporter(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    const ping = () => {
      const now = Date.now();
      if (now - last > 5000) {
        last = now;
        api.app.reportActivity();
      }
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, ping, { passive: true }));
    ping();
    return () => events.forEach((e) => window.removeEventListener(e, ping));
  }, [enabled]);
}

export type Hotkeys = Partial<Record<'mod+k' | 'mod+n' | 'mod+l' | 'mod+,' | 'mod+g', () => void>>;

/** Global keyboard shortcuts (Ctrl on Windows/Linux, Cmd on macOS). */
export function useHotkeys(map: Hotkeys): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey || e.shiftKey) return;
      const k = `mod+${e.key.toLowerCase()}` as keyof Hotkeys;
      const fn = ref.current[k];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Run `fn` after `ms` once `active` becomes true; cancels if it turns false first. */
export function useTimeout(active: boolean, ms: number, fn: () => void): void {
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    if (!active || ms <= 0) return;
    const t = setTimeout(() => cb.current(), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
}
