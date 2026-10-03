// Recently Deleted, duplicate detection / merge and encrypted attachments of the
// shared vault core (same code on desktop and Android).

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '../src/core/schema';
import { BackupService } from '../src/main/vault/backupService';
import { VaultService } from '../src/main/vault/vaultService';

const PW = 'Core-Test-Master-Pass-2026!';
const b64 = (s: string) => Buffer.from(s).toString('base64');

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-core-'));
  file = path.join(dir, 'vault', 'vault.vault');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function vault(now?: () => Date) {
  const v = new VaultService(file, now);
  await v.create(PW, null);
  return v;
}
const login = (title: string, fields: Record<string, string>, tags: string[] = []) => ({ categoryId: 'personal', title, fields, tags, favorite: false });

describe('Recently Deleted', () => {
  it('deleting moves an item to the trash; it can be restored intact', async () => {
    const v = await vault();
    const e = await v.saveEntry(login('GitHub', { username: 'me', password: 'pw-1' }));
    await v.deleteEntry(e.id);
    expect(v.snapshot().entries).toHaveLength(0);
    expect(v.snapshot().trash.map((t) => t.title)).toEqual(['GitHub']);
    expect(JSON.stringify(v.snapshot().trash)).not.toContain('pw-1');
    // Survives lock/unlock.
    v.lock();
    await v.unlock(PW);
    await v.restoreEntry(e.id);
    expect(v.getSecret(e.id, 'password')).toBe('pw-1');
    expect(v.snapshot().trash).toHaveLength(0);
  });

  it('purges only on request or after 30 days', async () => {
    let t = new Date('2026-01-01T00:00:00Z');
    const v = await vault(() => t);
    const a = await v.saveEntry(login('A', { password: '1' }));
    const b = await v.saveEntry(login('B', { password: '2' }));
    await v.deleteEntry(a.id);
    await v.deleteEntry(b.id);
    await v.purgeEntry(a.id);
    expect(v.snapshot().trash.map((x) => x.title)).toEqual(['B']);
    t = new Date('2026-01-25T00:00:00Z');
    v.lock();
    await v.unlock(PW);
    expect(v.snapshot().trash).toHaveLength(1);
    t = new Date('2026-02-01T00:00:01Z');
    v.lock();
    await v.unlock(PW);
    expect(v.snapshot().trash).toHaveLength(0);
  });
});

describe('duplicate detection', () => {
  it('finds same-name, same-number and same-login duplicates without changing anything', async () => {
    const v = await vault();
    const a = await v.saveEntry(login('GitHub', { username: 'me@x.com', website: 'github.com', password: 'p1' }));
    const b = await v.saveEntry(login('github ', { username: 'ME@x.com', website: 'https://github.com/login', password: 'p2' }));
    const c = await v.saveEntry({ categoryId: 'banking', title: 'BDO Savings', fields: { bankName: 'BDO', accountNumber: '1234 5678 90' }, tags: [], favorite: false });
    const d = await v.saveEntry({ categoryId: 'banking', title: 'My BDO', fields: { bankName: 'BDO', accountNumber: '1234567890' }, tags: [], favorite: false });
    await v.saveEntry(login('Unrelated', { username: 'other', password: 'p3' }));
    const before = await fs.readFile(file, 'utf8');
    const groups = v.findDuplicates();
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    const sets = groups.map((g) => g.items.map((i) => i.id).sort());
    expect(sets).toContainEqual([a.id, b.id].sort());
    expect(sets).toContainEqual([c.id, d.id].sort());
    expect(groups).toHaveLength(2);
    // Comparison never includes secret values.
    expect(JSON.stringify(groups)).not.toMatch(/p1|p2|1234567890/);
  });

  it('dismissed groups stay hidden', async () => {
    const v = await vault();
    await v.saveEntry(login('Mail', { password: 'a' }));
    await v.saveEntry(login('Mail', { password: 'b' }));
    const [g] = v.findDuplicates();
    await v.dismissDuplicate(g!.key);
    expect(v.findDuplicates()).toHaveLength(0);
  });

  it('merge keeps the chosen item, fills its empty fields, and moves the others to Recently Deleted', async () => {
    const v = await vault();
    const keep = await v.saveEntry(login('Netflix', { username: 'me', password: 'keep-pw', notes: 'first' }, ['tv']));
    const other = await v.saveEntry(login('Netflix', { username: 'me', password: 'other-pw', website: 'netflix.com', notes: 'second' }, ['family']));
    const merged = await v.mergeEntries(keep.id, [other.id]);
    const e = v.getEntryForEdit(merged.id);
    expect(e.fields.password).toBe('keep-pw');
    expect(e.fields.website).toBe('netflix.com');
    expect(e.fields.notes).toContain('first');
    expect(e.fields.notes).toContain('second');
    expect([...e.tags].sort()).toEqual(['family', 'tv']);
    // Nothing destroyed: the other copy is restorable.
    expect(v.snapshot().trash.map((t) => t.id)).toEqual([other.id]);
    await v.restoreEntry(other.id);
    expect(v.getSecret(other.id, 'password')).toBe('other-pw');
  });
});

describe('attachments', () => {
  it('stores files encrypted, reads them back, and survives lock/unlock', async () => {
    const v = await vault();
    const e = await v.saveEntry(login('Passport scan', {}));
    const r = await v.addAttachment(e.id, { name: 'passport.pdf', mime: 'application/pdf', data: b64('%PDF-1.7 secret passport') });
    expect(r.status).toBe('added');
    const att = r.status === 'added' ? r.attachment : null!;
    const raw = await fs.readFile(path.join(dir, 'vault', `att-${att.id}.att`), 'utf8');
    expect(Buffer.from(raw, 'base64').toString('latin1')).not.toContain('secret passport');
    expect(await fs.readFile(file, 'utf8')).not.toContain('passport.pdf');
    v.lock();
    await v.unlock(PW);
    expect(Buffer.from(await v.readAttachment(e.id, att.id), 'base64').toString()).toBe('%PDF-1.7 secret passport');
    expect(v.snapshot().entries[0]!.attachmentCount).toBe(1);
  });

  it('detects the same file by its hash and adds it only when asked', async () => {
    const v = await vault();
    const e = await v.saveEntry(login('ID', {}));
    const input = { name: 'front.jpg', mime: 'image/jpeg', data: b64('jpeg-bytes') };
    await v.addAttachment(e.id, input);
    const dup = await v.addAttachment(e.id, { ...input, name: 'copy.jpg' });
    expect(dup.status).toBe('duplicate');
    expect(v.listAttachments(e.id)).toHaveLength(1);
    expect((await v.addAttachment(e.id, { ...input, allowDuplicate: true })).status).toBe('added');
    expect(v.listAttachments(e.id)).toHaveLength(2);
  });

  it('rejects oversized and invalid files without changing the vault', async () => {
    const v = await vault();
    const e = await v.saveEntry(login('X', {}));
    const before = await fs.readFile(file, 'utf8');
    const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64');
    await expect(v.addAttachment(e.id, { name: 'big.bin', mime: 'application/octet-stream', data: big })).rejects.toThrow();
    await expect(v.addAttachment(e.id, { name: 'a.png', mime: 'image/png', data: '%%%not base64' })).rejects.toThrow();
    await expect(v.addAttachment(e.id, { name: 'a.png', mime: 'image/png', data: '' })).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect((await fs.readdir(path.join(dir, 'vault'))).filter((n) => n.startsWith('att-'))).toHaveLength(0);
  });

  it('front/back roles are exclusive; delete removes the encrypted file', async () => {
    const v = await vault();
    const e = await v.saveEntry({ categoryId: 'cards', title: 'Card', fields: { bankName: 'BDO' }, tags: [], favorite: false });
    const a = await v.addAttachment(e.id, { name: 'a.jpg', mime: 'image/jpeg', data: b64('a'), role: 'front' });
    const b = await v.addAttachment(e.id, { name: 'b.jpg', mime: 'image/jpeg', data: b64('b'), role: 'front' });
    const roles = v.listAttachments(e.id).map((x) => x.role ?? null);
    expect(roles.filter((r) => r === 'front')).toHaveLength(1);
    const bId = b.status === 'added' ? b.attachment.id : '';
    expect(v.listAttachments(e.id).find((x) => x.id === bId)!.role).toBe('front');
    await v.deleteAttachment(e.id, bId);
    await expect(fs.stat(path.join(dir, 'vault', `att-${bId}.att`))).rejects.toThrow();
    expect(a.status).toBe('added');
  });

  it('attachments stay with an item in Recently Deleted and are removed only when purged', async () => {
    const v = await vault();
    const e = await v.saveEntry(login('Doc', {}));
    const r = await v.addAttachment(e.id, { name: 'n.txt', mime: 'text/plain', data: b64('hello') });
    const id = r.status === 'added' ? r.attachment.id : '';
    const f = path.join(dir, 'vault', `att-${id}.att`);
    await v.deleteEntry(e.id);
    await fs.stat(f);
    await v.restoreEntry(e.id);
    expect(Buffer.from(await v.readAttachment(e.id, id), 'base64').toString()).toBe('hello');
    await v.deleteEntry(e.id);
    await v.purgeEntry(e.id);
    await expect(fs.stat(f)).rejects.toThrow();
  });

  it('are re-encrypted on a master password change and travel inside backups', async () => {
    const v = await vault();
    const e = await v.saveEntry(login('Doc', {}));
    const r = await v.addAttachment(e.id, { name: 'n.txt', mime: 'text/plain', data: b64('backup me') });
    const id = r.status === 'added' ? r.attachment.id : '';
    await v.changePassword(PW, 'New-Core-Master-Pass-99', null);
    v.lock();
    await v.unlock('New-Core-Master-Pass-99');
    expect(Buffer.from(await v.readAttachment(e.id, id), 'base64').toString()).toBe('backup me');

    const target = path.join(dir, 'backup.vault');
    await new BackupService(v).createBackup(target);
    expect(await fs.readFile(target, 'utf8')).not.toContain('backup me');

    // Restore into a brand-new vault elsewhere.
    const other = new VaultService(path.join(dir, 'other', 'vault.vault'));
    await other.create('Other-Master-Pass-123', null);
    const b = new BackupService(other);
    const token = b.register(target);
    await b.open(token, 'New-Core-Master-Pass-99');
    await b.apply(token, 'merge');
    const restored = other.snapshot().entries.find((x) => x.title === 'Doc')!;
    const [att] = other.listAttachments(restored.id);
    expect(Buffer.from(await other.readAttachment(restored.id, att!.id), 'base64').toString()).toBe('backup me');
  });
});
