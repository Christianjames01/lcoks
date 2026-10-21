// The iPhone "Add expense" Shortcut writes inbox boxes with Swift/CryptoKit
// (ios/App/App/QuickAddCrypto.swift). This opens them with the vault's real
// decryption code. Needs the compiled check tool, so it only runs in the macOS CI
// job (IOS_SEAL_BIN); elsewhere it is skipped.

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { generateInboxKeys, openInbox } from '../src/core/inbox';

const bin = process.env.IOS_SEAL_BIN;

describe.skipIf(!bin)('iPhone quick-add boxes', () => {
  const seal = (pub: string, ...args: string[]) => execFileSync(bin!, [pub, ...args], { encoding: 'utf8' });

  it('an expense with an account opens with the vault key', async () => {
    const keys = await generateInboxKeys();
    const box = seal(keys.pub, 'expense', '15050', 'food', 'acc-gcash-1', '  Jollibee  ');
    expect(box).not.toContain('Jollibee');
    const e = await openInbox(keys.priv, box);
    expect(e).toMatchObject({ t: 'Jollibee', k: 'expense', a: 15050, c: 'food', acc: 'acc-gcash-1' });
    expect(e.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.at).toMatch(/Z$/);
  });

  it('cash in without an account', async () => {
    const keys = await generateInboxKeys();
    const e = await openInbox(keys.priv, seal(keys.pub, 'income', '50000', 'other-income', '-', ''));
    expect(e).toMatchObject({ t: '', k: 'income', a: 50000, c: 'other-income' });
    expect(e.acc).toBeUndefined();
  });

  it('a box for another vault cannot be opened', async () => {
    const a = await generateInboxKeys();
    const b = await generateInboxKeys();
    await expect(openInbox(b.priv, seal(a.pub, 'expense', '100', 'other', '-', 'x'))).rejects.toThrow();
  });
});
