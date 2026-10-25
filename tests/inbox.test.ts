// Quick add while locked: entries are encrypted to the inbox public key and
// only become readable (and part of the vault) after the next unlock.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateInboxKeys, openInbox, sealInbox } from '../src/core/inbox';
import { VaultService } from '../src/main/vault/vaultService';

const PW = 'Inbox-Test-Master-Pass-2026!';
const DAY = '2026-10-20';

let dir: string;
let vaultDir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-inbox-'));
  vaultDir = path.join(dir, 'vault');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const files = async () => (await fs.readdir(vaultDir)).sort();

describe('inbox crypto', () => {
  it('round-trips and rejects the wrong key or tampering', async () => {
    const a = await generateInboxKeys();
    const b = await generateInboxKeys();
    const box = await sealInbox(a.pub, { t: 'lunch 150', day: DAY, at: '' });
    expect(box).not.toContain('lunch');
    expect((await openInbox(a.priv, box)).t).toBe('lunch 150');
    await expect(openInbox(b.priv, box)).rejects.toThrow();
    const parsed = JSON.parse(box);
    parsed.ct = parsed.ct.slice(0, -4) + (parsed.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(openInbox(a.priv, JSON.stringify(parsed))).rejects.toThrow();
  });
});

describe('quick add while locked', () => {
  it('is off until the vault has been unlocked once', async () => {
    const v = new VaultService(path.join(vaultDir, 'vault.vault'));
    await v.create(PW, null);
    v.lock();
    expect((await v.inboxStatus()).enabled).toBe(false);
    await expect(v.quickAdd('lunch 150', DAY)).rejects.toMatchObject({ code: 'INBOX_OFF', userMessage: expect.stringMatching(/Unlock VaultLocks once/) });
  });

  it('queues encrypted entries and adds them on unlock', async () => {
    const v = new VaultService(path.join(vaultDir, 'vault.vault'));
    await v.create(PW, null);
    v.lock();
    await v.unlock(PW); // first unlock with this version: creates the inbox key
    v.lock();

    expect(await v.inboxStatus()).toEqual({ enabled: true, pending: 0 });
    expect(await v.quickAdd('Secret dinner place 450', DAY)).toEqual({ queued: true });
    await v.quickAdd('grab 85.50', DAY);
    await expect(v.quickAdd('no amount here', DAY)).rejects.toMatchObject({ userMessage: expect.stringMatching(/amount/) });
    expect((await v.inboxStatus()).pending).toBe(2);

    // Nothing readable on disk while locked; the private key is not outside the vault.
    for (const f of await files()) {
      const text = await fs.readFile(path.join(vaultDir, f), 'utf8');
      expect(text).not.toContain('Secret dinner');
      expect(text).not.toMatch(/"d"\s*:/);
    }

    await v.unlock(PW);
    const txs = v.snapshot().transactions.sort((a, b) => a.amount - b.amount);
    expect(txs.map((t) => [t.note, t.amount, t.category, t.date])).toEqual([
      ['Grab', 8550, 'transport', DAY],
      ['Secret dinner place', 45000, 'food', DAY]
    ]);
    expect(await v.takeInboxReport()).toEqual({ added: 2, unreadable: [] });
    expect(await v.takeInboxReport()).toBeNull();
    expect((await files()).filter((f) => f.startsWith('inbox-'))).toEqual([]);
    expect(JSON.stringify(v.snapshot())).not.toContain('"priv"');
  });

  it('saves directly while unlocked', async () => {
    const v = new VaultService(path.join(vaultDir, 'vault.vault'));
    await v.create(PW, null);
    expect(await v.quickAdd('coffee 120 yesterday', DAY)).toEqual({ queued: false });
    expect(v.snapshot().transactions[0]).toMatchObject({ amount: 12000, date: '2026-10-19', category: 'coffee' });
  });
});

describe('pop-up entries and accounts', () => {
  it('structured entries keep category and account; inbox.meta has names only', async () => {
    const v = new VaultService(path.join(vaultDir, 'vault.vault'));
    await v.create(PW, null);
    v.lock();
    await v.unlock(PW);
    await v.saveTransaction({ kind: 'expense', amount: 77700, category: 'food', note: 'Secret amount', date: DAY, accountId: 'gcash' });
    v.lock();

    const meta = await fs.readFile(path.join(vaultDir, 'inbox.meta'), 'utf8');
    expect(JSON.parse(meta).accounts.map((a: { name: string }) => a.name)).toEqual(['Cash', 'GCash', 'Maya', 'Bank']);
    expect(meta).not.toContain('777');

    // What the Android pop-up writes (same format as QuickAdd.java).
    const pub = await fs.readFile(path.join(vaultDir, 'inbox.pub'), 'utf8');
    await fs.writeFile(path.join(vaultDir, 'inbox-11111111-2222-3333-4444-555555555555.box'), await sealInbox(pub, { t: 'Jeep', day: DAY, at: '', k: 'expense', a: 1300, c: 'transport', acc: 'cash' }));
    await fs.writeFile(path.join(vaultDir, 'inbox-11111111-2222-3333-4444-666666666666.box'), await sealInbox(pub, { t: '', day: DAY, at: '', k: 'income', a: 50000, c: 'topup', acc: 'gcash' }));

    await v.unlock(PW);
    const s = v.snapshot();
    expect(s.transactions.find((t) => t.note === 'Jeep')).toMatchObject({ amount: 1300, category: 'transport', accountId: 'cash' });
    expect(s.transactions.find((t) => t.category === 'topup')).toMatchObject({ kind: 'income', amount: 50000, accountId: 'gcash' });

    await v.saveAccount({ id: 'gcash', name: 'GCash (main)', kind: 'ewallet', opening: 0 });
    expect(await fs.readFile(path.join(vaultDir, 'inbox.meta'), 'utf8')).toContain('GCash (main)');
    await v.deleteAccount('maya');
    expect(v.snapshot().accounts.map((a) => a.id)).toEqual(['cash', 'gcash', 'bank']);
  });
});

describe('Kloud on the lock screen', () => {
  it('spoken sentences become expenses or reminders on unlock, understood as of when they were said', async () => {
    const v = new VaultService(path.join(vaultDir, 'vault.vault'));
    await v.create(PW, null);
    v.lock();
    await v.unlock(PW);
    v.lock();
    const pub = (await fs.readFile(path.join(vaultDir, 'inbox.pub'), 'utf8')).trim();
    const said = new Date(2026, 9, 25, 9, 30); // Sunday morning
    const put = async (id: string, t: string) =>
      fs.writeFile(path.join(vaultDir, `inbox-${id}.box`), await sealInbox(pub, { t, x: 'voice', day: '2026-10-25', at: said.toISOString() }));
    await put('11111111-1111-4111-8111-111111111111', 'Kloud, lunch 150 from gcash');
    await put('22222222-2222-4222-8222-222222222222', 'remind me to pay rent tomorrow at 9');
    await put('33333333-3333-4333-8333-333333333333', 'banana');

    await v.unlock(PW);
    const s = v.snapshot();
    expect(s.transactions.map((t) => [t.note, t.amount, t.category, t.accountId, t.date])).toEqual([['Lunch', 15000, 'food', 'gcash', '2026-10-25']]);
    expect(s.tasks.map((t) => [t.title, t.due, t.dueTime, t.reminder])).toEqual([['Pay rent', '2026-10-26', '09:00', { type: 'before', minutes: 0 }]]);
    expect(await v.takeInboxReport()).toEqual({ added: 2, unreadable: ['banana'] });
  });
});
