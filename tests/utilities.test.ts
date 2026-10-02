import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoLockTimer } from '../src/main/services/autoLock';
import { ClipboardManager, type ClipboardLike } from '../src/main/services/clipboard';
import { formatLine, sanitizeMeta } from '../src/main/services/logger';
import { BUILTIN_CATEGORIES } from '../src/shared/categories';
import {
  AMBIGUOUS,
  CHARSETS,
  generatePassphrase,
  generatePassword,
  secureRandomInt,
  DEFAULT_PASSWORD_OPTIONS
} from '../src/shared/generator';
import { searchEntries } from '../src/shared/search';
import { estimateStrength } from '../src/shared/strength';
import type { EntryView } from '../src/shared/types';
import { EFF_WORDS } from '../src/shared/wordlist';

afterEach(() => vi.useRealTimers());

describe('password generator', () => {
  it('honours length bounds 8–128', () => {
    for (const length of [1, 8, 24, 128, 500]) {
      const pw = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length });
      expect(pw.length).toBe(Math.min(128, Math.max(8, length)));
    }
  });

  it('includes every selected character class and nothing else', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword({ length: 8, upper: true, lower: false, digits: true, symbols: false, avoidAmbiguous: false });
      expect(/[A-Z]/.test(pw)).toBe(true);
      expect(/[0-9]/.test(pw)).toBe(true);
      expect(/^[A-Z0-9]+$/.test(pw)).toBe(true);
    }
  });

  it('avoids ambiguous characters when asked', () => {
    const pw = generatePassword({ length: 128, upper: true, lower: true, digits: true, symbols: true, avoidAmbiguous: true });
    expect([...pw].some((c) => AMBIGUOUS.has(c))).toBe(false);
  });

  it('throws when no character class is selected', () => {
    expect(() => generatePassword({ length: 16, upper: false, lower: false, digits: false, symbols: false, avoidAmbiguous: false })).toThrow();
  });

  it('is roughly uniform (no modulo bias)', () => {
    const counts = new Array(10).fill(0);
    const N = 50_000;
    for (let i = 0; i < N; i++) counts[secureRandomInt(10)]++;
    for (const c of counts) expect(Math.abs(c - N / 10)).toBeLessThan(N / 10 * 0.08);
    const all = new Set<string>();
    for (let i = 0; i < 200; i++) all.add(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 32 }));
    expect(all.size).toBe(200);
    expect(CHARSETS.symbols.length).toBeGreaterThan(20);
  });

  it('generates passphrases from the EFF list', () => {
    expect(EFF_WORDS).toHaveLength(7776);
    const p = generatePassphrase({ words: 6, separator: '-', capitalize: false, includeNumber: false });
    const words = p.split('-');
    expect(words).toHaveLength(6);
    for (const w of words) expect(EFF_WORDS.includes(w)).toBe(true);
  });
});

describe('strength estimator', () => {
  it('rates common and short passwords as weak', () => {
    for (const p of ['password', 'P@ssw0rd', '123456', 'qwerty', 'Summer2024!', 'abc']) {
      expect(estimateStrength(p).score).toBeLessThanOrEqual(1);
    }
  });
  it('rates long random and passphrase passwords as strong', () => {
    expect(estimateStrength(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 24 })).score).toBe(4);
    expect(estimateStrength('correct-horse-battery-staple-orbit-velvet').score).toBeGreaterThanOrEqual(3);
  });
  it('handles empty, Unicode and extremely long input', () => {
    expect(estimateStrength('').score).toBe(0);
    expect(estimateStrength('密码密码密码密码🔐🔐').score).toBeGreaterThanOrEqual(0);
    expect(estimateStrength('x'.repeat(10_000)).score).toBeLessThanOrEqual(4);
  });
});

describe('clipboard manager', () => {
  function fakeClipboard() {
    let content = '';
    const cb: ClipboardLike & { content: () => string; set: (s: string) => void } = {
      writeSecret: async (t) => void (content = t),
      readText: async () => content,
      clear: () => void (content = ''),
      content: () => content,
      set: (s) => void (content = s)
    };
    return cb;
  }

  it('clears the clipboard after the timeout', async () => {
    vi.useFakeTimers();
    const cb = fakeClipboard();
    const m = new ClipboardManager(cb);
    expect(await m.copySecret('hunter2', 15)).toBe(15);
    expect(cb.content()).toBe('hunter2');
    await vi.advanceTimersByTimeAsync(14_000);
    expect(cb.content()).toBe('hunter2');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(cb.content()).toBe('');
  });

  it('does not clear something the user copied afterwards', async () => {
    vi.useFakeTimers();
    const cb = fakeClipboard();
    const m = new ClipboardManager(cb);
    await m.copySecret('hunter2', 15);
    cb.set('user copied this later');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(cb.content()).toBe('user copied this later');
  });

  it('clamps the timeout and clears immediately on lock', async () => {
    const cb = fakeClipboard();
    const m = new ClipboardManager(cb);
    expect(await m.copySecret('x', 1)).toBe(10);
    await m.clearIfOurs();
    expect(cb.content()).toBe('');
  });
});

describe('auto-lock timer', () => {
  it('fires after inactivity and resets on activity', () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const t = new AutoLockTimer(onLock);
    t.configure(1);
    vi.advanceTimersByTime(50_000);
    t.reset();
    vi.advanceTimersByTime(50_000);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(11_000);
    expect(onLock).toHaveBeenCalledTimes(1);
  });
  it('never fires when set to Never (0)', () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    new AutoLockTimer(onLock).configure(0);
    vi.advanceTimersByTime(10 * 3600_000);
    expect(onLock).not.toHaveBeenCalled();
  });
});

describe('logger', () => {
  it('drops non-allow-listed keys and free-form strings', () => {
    const meta = sanitizeMeta({ code: 'UNLOCK_FAILED', password: 'hunter2', title: 'My Bank', reason: 'has spaces & secrets', count: 3 } as any);
    expect(meta).toEqual({ code: 'UNLOCK_FAILED', count: 3 });
    const line = formatLine('vault.unlock_failed', { code: 'X', password: 'hunter2' } as any);
    expect(line).not.toContain('hunter2');
    expect(formatLine('event with spaces hunter2')).not.toContain('hunter2');
  });
});

describe('search', () => {
  const mk = (over: Partial<EntryView>): EntryView => ({
    id: Math.random().toString(36),
    categoryId: 'personal',
    title: '',
    fields: {},
    secrets: {},
    tags: [],
    favorite: false,
    favoriteOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...over
  });
  const cats = [...BUILTIN_CATEGORIES];
  const entries = [
    mk({ title: 'GitHub', fields: { username: 'octocat', website: 'github.com' }, tags: ['work'] }),
    mk({ title: 'BPI Savings', categoryId: 'banking', fields: { notes: 'Personal savings account' }, tags: ['bank'] }),
    mk({ title: 'Home Wi-Fi', categoryId: 'others', secrets: { password: { set: true } } })
  ];
  it('matches titles, usernames, websites, categories, notes and tags', () => {
    expect(searchEntries(entries, cats, 'octo')[0]!.title).toBe('GitHub');
    expect(searchEntries(entries, cats, 'github.com')).toHaveLength(1);
    expect(searchEntries(entries, cats, 'banking')[0]!.title).toBe('BPI Savings');
    expect(searchEntries(entries, cats, 'savings account')).toHaveLength(1);
    expect(searchEntries(entries, cats, '#work')).toHaveLength(1);
    expect(searchEntries(entries, cats, 'wi-fi')).toHaveLength(1);
    expect(searchEntries(entries, cats, 'nothing-here')).toHaveLength(0);
  });
});

describe('static security checks on the source tree', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n) && n !== 'wordlist.ts') files.push(p);
    }
  };
  walk(path.join(__dirname, '..', 'src'));

  it('contains no console logging (which could leak secrets)', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/console\.(log|info|warn|error|debug|trace)\s*\(/);
  });
  it('never uses Math.random, MD5 or SHA-1 for security', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/Math\.random\s*\(/);
      expect(src, f).not.toMatch(/createHash\(\s*['"](md5|sha1)['"]/i);
    }
  });
  it('makes no network calls from application code', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|new WebSocket|net\.request|https?\.request/);
    }
  });
  it('renderer never enables nodeIntegration or disables isolation', () => {
    const main = readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
    expect(main).toMatch(/sandbox: true/);
    expect(main).toMatch(/contextIsolation: true/);
    expect(main).toMatch(/nodeIntegration: false/);
  });
});
