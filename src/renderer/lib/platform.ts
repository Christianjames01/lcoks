import { useEffect, useState } from 'react';

/** True inside the Android (Capacitor) build. */
export const isAndroid = (): boolean => document.documentElement.dataset.platform === 'android';
/** True inside the iPhone (Capacitor) build. */
export const isIOS = (): boolean => document.documentElement.dataset.platform === 'ios';
/** Phone app (Android or iPhone), as opposed to the desktop app. */
export const isPhone = (): boolean => isAndroid() || isIOS();

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
