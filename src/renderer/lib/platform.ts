import { useEffect, useState } from 'react';

/** True inside the Android (Capacitor) build. */
export const isAndroid = (): boolean => document.documentElement.dataset.platform === 'android';

/** Phone-width layout (drawer navigation, stacked list/detail). */
export const MOBILE_QUERY = '(max-width: 720px)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}
