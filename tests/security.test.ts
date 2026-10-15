// Security check-up (reused / weak / old passwords, score) and site avatars.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultService } from '../src/main/vault/vaultService';
import { isOld, securityReport } from '../src/shared/security';
import { hostOf, siteBadge } from '../src/shared/sites';
import type { EntryView } from '../src/shared/types';

const PW = 'Security-Test-Master-Pass-2026!';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-sec-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const login = (title: string, fields: Record<string, string>) => ({ categoryId: 'personal', title, fields, tags: [], favorite: false });

describe('reused passwords', () => {
  it('flags every item that shares a password, without exposing the value', async () => {
    const v = new VaultService(path.join(dir, 'vault.vault'));
    await v.create(PW, null);
    await v.saveEntry(login('Shop A', { password: 'Same-Pass-123!' }));
    await v.saveEntry(login('Shop B', { password: 'Same-Pass-123!' }));
    await v.saveEntry(login('Bank', { password: 'Unique-Pass-456!' }));
    // Same password in another category (email) counts too.
    await v.saveEntry({ categoryId: 'email', title: 'Mail', fields: { email: 'a@b.c', password: 'Same-Pass-123!' }, tags: [], favorite: false });

    const snap = v.snapshot();
    const reused = Object.fromEntries(snap.entries.map((e) => [e.title, !!e.secrets.password?.reused]));
    expect(reused).toEqual({ 'Shop A': true, 'Shop B': true, Bank: false, Mail: true });
    expect(snap.stats.reused).toBe(3);
    expect(JSON.stringify(snap)).not.toContain('Same-Pass-123!');
  });
});

function view(title: string, opts: { strength?: number; reused?: boolean; updatedAt?: string } = {}): EntryView {
  const at = opts.updatedAt ?? '2026-10-01T00:00:00Z';
  return {
    id: title,
    categoryId: 'personal',
    title,
    fields: {},
    secrets: { password: { set: true, strength: opts.strength ?? 4, reused: opts.reused } },
    tags: [],
    favorite: false,
    favoriteOrder: 0,
    createdAt: at,
    updatedAt: at,
    attachmentCount: 0,
    cardPhotos: { front: false, back: false }
  };
}

describe('security score', () => {
  const now = Date.parse('2026-10-15T00:00:00Z');
  const backedUp = { lastBackupAt: '2026-10-10T00:00:00Z' };

  it('is 100 with strong, unique, recent passwords and a fresh backup', () => {
    const r = securityReport([view('a'), view('b')], backedUp, 30, now);
    expect(r.score).toBe(100);
    expect(r.level).toBe('great');
    expect(r.issues).toEqual([]);
  });

  it('lists weak, reused and old passwords and a missing backup, and lowers the score', () => {
    const entries = [view('weak', { strength: 1 }), view('r1', { reused: true }), view('r2', { reused: true }), view('old', { updatedAt: '2025-01-01T00:00:00Z' }), view('ok')];
    const r = securityReport(entries, { lastBackupAt: null }, 30, now);
    expect(r.issues.map((i) => [i.id, i.items.length])).toEqual([
      ['weak', 1],
      ['reused', 2],
      ['old', 1],
      ['backup', 0]
    ]);
    expect(r.score).toBeLessThan(75);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('every problem costs at least a few points, even in a big vault', () => {
    const many = Array.from({ length: 200 }, (_, i) => view(`ok${i}`));
    const r = securityReport([...many, view('weak', { strength: 0 })], backedUp, 30, now);
    expect(r.score).toBeLessThanOrEqual(92);
  });

  it('has no score for an empty vault', () => {
    expect(securityReport([], { lastBackupAt: null }, 30, now).score).toBeNull();
  });

  it('counts a password as old after a year', () => {
    expect(isOld(view('x', { updatedAt: '2025-10-14T00:00:00Z' }), now)).toBe(true);
    expect(isOld(view('x', { updatedAt: '2025-10-20T00:00:00Z' }), now)).toBe(false);
  });
});

describe('site avatars', () => {
  it('recognises brands from the website, name or title', () => {
    expect(siteBadge('https://www.facebook.com/login', ['My FB'])?.brand).toBe('Facebook');
    expect(siteBadge(undefined, ['Shopee PH'])?.brand).toBe('Shopee');
    expect(siteBadge('mail.google.com', [])?.brand).toBe('Google');
    expect(siteBadge(undefined, ['Gmail (work)'])?.brand).toBe('Gmail');
  });

  it('falls back to a coloured first letter, the same colour every time', () => {
    const a = siteBadge('https://portal.example.com.ph', []);
    expect(a?.text).toBe('E');
    expect(a?.brand).toBeUndefined();
    expect(siteBadge('https://portal.example.com.ph', [])?.background).toBe(a?.background);
    expect(siteBadge(undefined, ['  ', ''])).toBeNull();
  });

  it('picks readable text colour on light badges', () => {
    expect(siteBadge(undefined, ['Snapchat'])?.color).toBe('#111111');
    expect(siteBadge(undefined, ['Netflix'])?.color).toBe('#FFFFFF');
  });

  it('extracts hosts from URLs and bare domains', () => {
    expect(hostOf('https://WWW.Shopee.ph/path')).toBe('shopee.ph');
    expect(hostOf('lazada.com.ph')).toBe('lazada.com.ph');
    expect(hostOf('not a url')).toBe('');
  });
});
