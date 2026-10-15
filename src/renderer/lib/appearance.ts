import { ACCENT_COLORS, type AccentColor, type GeneratorDefaults, type ThemeMode } from '../../shared/types';
import { api } from './api';

// The theme is also needed on the lock screen (before the vault is opened), so
// the last choice is remembered on this device. It is not secret.
const KEY = 'vaultlocks.appearance';
const dark = window.matchMedia('(prefers-color-scheme: dark)');

let current: { theme: ThemeMode; glass: boolean; accent: AccentColor } = { theme: 'system', glass: true, accent: 'blue' };
try {
  const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  if (raw && ['system', 'light', 'dark'].includes(raw.theme)) {
    current = { theme: raw.theme, glass: raw.glass !== false, accent: ACCENT_COLORS.includes(raw.accent) ? raw.accent : 'blue' };
  }
} catch {
  /* ignore */
}

function apply(): void {
  const isDark = current.theme === 'dark' || (current.theme === 'system' && dark.matches);
  const root = document.documentElement;
  root.dataset.theme = isDark ? 'dark' : 'light';
  root.dataset.glass = current.glass ? 'on' : 'off';
  root.dataset.accent = current.accent;
  try {
    api.app.setAppearance(isDark);
  } catch {
    /* ignore */
  }
}

export function setAppearance(theme: ThemeMode, glass: boolean, accent: AccentColor): void {
  if (theme === current.theme && glass === current.glass && accent === current.accent && document.documentElement.dataset.theme) return;
  current = { theme, glass, accent };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  apply();
}

export function initAppearance(): void {
  apply();
  dark.addEventListener('change', () => current.theme === 'system' && apply());
}

// Default options for the password generator (from Settings → Security).
let generatorDefaults: GeneratorDefaults | null = null;
export const setGeneratorDefaults = (d: GeneratorDefaults) => void (generatorDefaults = d);
export const getGeneratorDefaults = () => generatorDefaults;
