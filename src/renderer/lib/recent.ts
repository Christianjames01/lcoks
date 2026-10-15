import { useEffect, useState } from 'react';

// "Recently used": when items were last opened or copied on THIS device. Only
// item ids and times are kept (no titles or values), in local storage so the
// list survives locking — which reloads the page.
const KEY = 'vaultlocks.recentlyUsed';
const MAX = 100;
const EVENT = 'vault:recent';

type UsedMap = Record<string, number>;

let cache: UsedMap | null = null;

function load(): UsedMap {
  if (cache) return cache;
  cache = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (raw && typeof raw === 'object') {
      for (const [id, at] of Object.entries(raw)) if (typeof at === 'number' && /^[A-Za-z0-9_-]{1,64}$/.test(id)) cache[id] = at;
    }
  } catch {
    /* ignore */
  }
  return cache;
}

function save(map: UsedMap): void {
  cache = map;
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function markUsed(id: string): void {
  const map = { ...load(), [id]: Date.now() };
  const ids = Object.keys(map);
  if (ids.length > MAX) {
    ids.sort((a, b) => map[b]! - map[a]!);
    for (const old of ids.slice(MAX)) delete map[old];
  }
  save(map);
}

/** Forget items that no longer exist (deleted or purged). */
export function pruneUsed(existing: Iterable<string>): void {
  const keep = new Set(existing);
  const map = load();
  const stale = Object.keys(map).filter((id) => !keep.has(id));
  if (stale.length === 0) return;
  const next = { ...map };
  stale.forEach((id) => delete next[id]);
  save(next);
}

/** Map of item id → last used time (epoch ms); updates live. */
export function useRecentlyUsed(): UsedMap {
  const [map, setMap] = useState<UsedMap>(load);
  useEffect(() => {
    const on = () => setMap(load());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return map;
}
