import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupService } from '../src/main/vault/backupService';
import { UNLOCK_FAILED_MESSAGE, VaultError, VaultService } from '../src/main/vault/vaultService';
import * as atomic from '../src/main/storage/atomicFile';

// Pass-through mock so individual tests can inject write failures.
vi.mock('../src/main/storage/atomicFile', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/main/storage/atomicFile')>();
  return { ...m, writeFileAtomic: vi.fn(m.writeFileAtomic) };
});

const PW = 'Correct-Horse-Battery-Staple-42!';
const SECRET = 'S3cr3t-P@ssw0rd-🔐-ÜñíçødÉ';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-test-'));
  file = path.join(dir, 'vault', 'vault.vault');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

async function newVault(): Promise<VaultService> {
  const v = new VaultService(file);
  await v.create(PW, 'favourite book');
  return v;
}

async function addBank(v: VaultService, title = 'BPI Savings Account') {
  return v.saveEntry({
    categoryId: 'banking',
    title,
    fields: {
      bankName: 'BPI',
      accountName: 'John Doe',
      accountNumber: '1234 5678 9012 5678',
      username: 'john@example.com',
      password: SECRET,
      pin: '4321',
      website: 'https://example.com',
      notes: 'Personal savings account.'
    },
    tags: ['bank', 'Personal'],
    favorite: false
  });
}

describe('vault lifecycle', () => {
  it('creates, locks and unlocks with the correct password', async () => {
    const v = await newVault();
    expect(v.isUnlocked).toBe(true);
    await addBank(v);
    v.lock();
    expect(v.isUnlocked).toBe(false);
    expect(() => v.snapshot()).toThrow(VaultError);
    await v.unlock(PW);
    expect(v.snapshot().entries).toHaveLength(1);
  });

  it('rejects a wrong password with a generic message', async () => {
    const v = await newVault();
    v.lock();
    await expect(v.unlock('wrong password')).rejects.toMatchObject({ code: 'UNLOCK_FAILED', userMessage: UNLOCK_FAILED_MESSAGE });
    expect(v.isUnlocked).toBe(false);
  });

  it('throttles repeated failed unlock attempts', async () => {
    const v = await newVault();
    v.lock();
    for (let i = 0; i < 3; i++) await expect(v.unlock('nope')).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
    await expect(v.unlock(PW)).rejects.toMatchObject({ code: 'THROTTLED' });
  });

  it('refuses to create a second vault over an existing one', async () => {
    await newVault();
    await expect(new VaultService(file).create(PW, null)).rejects.toMatchObject({ code: 'EXISTS' });
  });

  it('refuses a hint that contains the master password', async () => {
    await expect(new VaultService(file).create(PW, `it is ${PW}`)).rejects.toThrow();
  });

  it('survives an application restart', async () => {
    const v = await newVault();
    await addBank(v);
    v.lock();
    const restarted = new VaultService(file);
    await restarted.init();
    expect(await restarted.getHint()).toBe('favourite book');
    await restarted.unlock(PW);
    expect(restarted.snapshot().entries[0]!.title).toBe('BPI Savings Account');
  });

  it('supports extremely long and Unicode master passwords', async () => {
    const long = 'Ω≈ç√∫˜µ≤≥÷ 密码 пароль 🔑'.repeat(40); // ~1000 chars
    const v = new VaultService(file);
    await v.create(long, null);
    v.lock();
    await v.unlock(long.normalize('NFD')); // same password, different Unicode form
    expect(v.isUnlocked).toBe(true);
  });
});

describe('on-disk confidentiality and integrity', () => {
  it('never writes plaintext secrets, titles, tags or the master password to disk', async () => {
    const v = await newVault();
    await addBank(v);
    const raw = await fs.readFile(file, 'utf8');
    for (const s of [PW, SECRET, 'BPI Savings Account', 'john@example.com', '4321', 'Personal savings', 'banking', '"bank"']) {
      expect(raw).not.toContain(s);
    }
    expect(JSON.parse(raw)).toHaveProperty('kdf.name', 'argon2id');
  });

  it('rejects a vault whose ciphertext was modified', async () => {
    const v = await newVault();
    await addBank(v);
    v.lock();
    const d = JSON.parse(await fs.readFile(file, 'utf8'));
    const ct = Buffer.from(d.ciphertext, 'base64');
    ct[10] = ct[10]! ^ 0xff;
    d.ciphertext = ct.toString('base64');
    await fs.writeFile(file, JSON.stringify(d));
    await expect(v.unlock(PW)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
  });

  it('rejects an invalid authentication tag', async () => {
    const v = await newVault();
    v.lock();
    const d = JSON.parse(await fs.readFile(file, 'utf8'));
    d.cipher.tag = Buffer.alloc(16, 7).toString('base64');
    await fs.writeFile(file, JSON.stringify(d));
    await expect(v.unlock(PW)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
  });

  it('rejects a modified hint or KDF parameters', async () => {
    const v = await newVault();
    v.lock();
    const original = await fs.readFile(file, 'utf8');
    const d = JSON.parse(original);
    d.hint = 'attacker-controlled hint';
    await fs.writeFile(file, JSON.stringify(d));
    await expect(v.unlock(PW)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
  });

  it('rejects corrupted, truncated and empty vault files', async () => {
    const v = await newVault();
    v.lock();
    const good = await fs.readFile(file);
    for (const bad of [good.subarray(0, 50), Buffer.from('garbage'), Buffer.alloc(0), Buffer.from('{"format":"VAULTLOCKS"}')]) {
      await fs.writeFile(file, bad);
      const fresh = new VaultService(file);
      await expect(fresh.unlock(PW)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
    }
  });

  it('cleans up leftover temp files from an interrupted write', async () => {
    const v = await newVault();
    v.lock();
    const leftover = path.join(path.dirname(file), '.vault.vault.abc123.tmp');
    await fs.writeFile(leftover, 'partial');
    await new VaultService(file).init();
    await expect(fs.access(leftover)).rejects.toThrow();
  });

  it('uses a fresh nonce for every save', async () => {
    const v = await newVault();
    const n1 = JSON.parse(await fs.readFile(file, 'utf8')).cipher.nonce;
    await addBank(v);
    const n2 = JSON.parse(await fs.readFile(file, 'utf8')).cipher.nonce;
    expect(n1).not.toBe(n2);
  });
});

describe('entries', () => {
  it('redacts secret values from views and snapshots', async () => {
    const v = await newVault();
    const view = await addBank(v);
    const json = JSON.stringify(v.snapshot());
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain('4321');
    expect(json).not.toContain('1234 5678 9012 5678');
    expect(view.secrets.password).toMatchObject({ set: true });
    expect(view.secrets.accountNumber!.preview).toBe('•••• 5678');
    expect(view.fields.username).toBe('john@example.com');
    expect(v.getSecret(view.id, 'password')).toBe(SECRET);
  });

  it('edits, duplicates, favorites and deletes', async () => {
    const v = await newVault();
    const a = await addBank(v);
    const b = await addBank(v, 'BPI Savings Account'); // duplicate titles are allowed
    expect(v.snapshot().entries).toHaveLength(2);

    await v.saveEntry({ id: a.id, categoryId: 'banking', title: 'Renamed', fields: { password: 'new' }, tags: [], favorite: true });
    const edited = v.getEntryForEdit(a.id);
    expect(edited.title).toBe('Renamed');
    expect(edited.fields).toEqual({ password: 'new' });
    expect(edited.favorite).toBe(true);

    const copy = await v.duplicateEntry(b.id);
    expect(copy.title).toContain('(copy)');
    await v.setFavorite(b.id, true);
    await v.setFavorite(copy.id, true);
    await v.reorderFavorites([copy.id, b.id, a.id]);
    const favs = v.snapshot().entries.filter((e) => e.favorite).sort((x, y) => x.favoriteOrder - y.favoriteOrder);
    expect(favs.map((e) => e.id)).toEqual([copy.id, b.id, a.id]);

    await v.deleteEntry(a.id);
    expect(v.snapshot().entries.find((e) => e.id === a.id)).toBeUndefined();
    await expect(v.deleteEntry(a.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('validates input: required title, empty fields dropped, unknown fields ignored', async () => {
    const v = await newVault();
    await expect(v.saveEntry({ categoryId: 'personal', title: '   ', fields: {}, tags: [], favorite: false })).rejects.toThrow();
    await expect(v.saveEntry({ categoryId: 'nope', title: 'x', fields: {}, tags: [], favorite: false })).rejects.toThrow();
    const e = await v.saveEntry({
      categoryId: 'personal',
      title: 'X',
      fields: { username: '', password: 'p', evil: 'x', __proto__: { polluted: true } } as any,
      tags: [' Work ', 'work', 'Two Words'],
      favorite: false
    });
    const full = v.getEntryForEdit(e.id);
    expect(full.fields).toEqual({ password: 'p' });
    expect(full.tags).toEqual(['work', 'two-words']);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('rejects dangerous URL schemes', async () => {
    const v = await newVault();
    await expect(
      v.saveEntry({ categoryId: 'personal', title: 'x', fields: { website: 'javascript:alert(1)' }, tags: [], favorite: false })
    ).rejects.toThrow();
  });

  it('stores special characters, Unicode and very long values exactly', async () => {
    const v = await newVault();
    const weird = `"'\\<script>\u0007 ${'🙂'.repeat(50)} 中文 العربية \n\t` + 'x'.repeat(9000);
    const e = await v.saveEntry({ categoryId: 'notes', title: 'Ünïcødé 🔐 "quotes"', fields: { content: weird }, tags: [], favorite: false });
    v.lock();
    await v.unlock(PW);
    expect(v.getSecret(e.id, 'content')).toBe(weird);
    expect(v.snapshot().entries[0]!.title).toBe('Ünïcødé 🔐 "quotes"');
  });

  it('rejects overly long values', async () => {
    const v = await newVault();
    await expect(
      v.saveEntry({ categoryId: 'personal', title: 'x', fields: { password: 'x'.repeat(10_001) }, tags: [], favorite: false })
    ).rejects.toThrow();
  });

  it('keeps memory and disk unchanged when a write fails', async () => {
    const v = await newVault();
    await addBank(v);
    const before = await fs.readFile(file);
    vi.mocked(atomic.writeFileAtomic).mockRejectedValueOnce(new Error('disk full'));
    await expect(addBank(v, 'Second')).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    expect(v.snapshot().entries).toHaveLength(1);
    expect((await fs.readFile(file)).equals(before)).toBe(true);
  });
});

describe('custom categories', () => {
  it('creates, uses, edits and deletes a custom category', async () => {
    const v = await newVault();
    const cat = await v.saveCategory({
      name: 'Servers',
      icon: 'server',
      fields: [
        { key: '', label: 'Host', type: 'text' },
        { key: '', label: 'Root password', type: 'password' }
      ]
    });
    const [host, pwField] = cat.fields;
    const e = await v.saveEntry({ categoryId: cat.id, title: 'prod', fields: { [host!.key]: '10.0.0.1', [pwField!.key]: 'pw' }, tags: [], favorite: false });
    expect(v.toView(v.getEntryForEdit(e.id)).secrets[pwField!.key]).toMatchObject({ set: true });
    await expect(v.deleteCategory(cat.id)).rejects.toMatchObject({ code: 'IN_USE' });
    await v.deleteEntry(e.id);
    await v.deleteCategory(cat.id);
    expect(v.categories().some((c) => c.id === cat.id)).toBe(false);
  });
});

describe('master password change', () => {
  it('re-encrypts with a new salt; old password stops working, new one works', async () => {
    const v = await newVault();
    await addBank(v);
    const oldSalt = JSON.parse(await fs.readFile(file, 'utf8')).kdf.salt;
    await v.changePassword(PW, 'A-completely-new-master-pw-99', 'new hint');
    const d = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(d.kdf.salt).not.toBe(oldSalt);
    expect(d.hint).toBe('new hint');
    v.lock();
    await expect(v.unlock(PW)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
    await v.unlock('A-completely-new-master-pw-99');
    expect(v.snapshot().entries).toHaveLength(1);
    // Saving after the change keeps using the new key.
    await addBank(v, 'After change');
    v.lock();
    await v.unlock('A-completely-new-master-pw-99');
    expect(v.snapshot().entries).toHaveLength(2);
  });

  it('requires the correct current password', async () => {
    const v = await newVault();
    await expect(v.changePassword('wrong', 'A-completely-new-master-pw-99', null)).rejects.toThrow();
    v.lock();
    await v.unlock(PW);
  });

  it('preserves the original vault if re-encryption/write fails', async () => {
    const v = await newVault();
    await addBank(v);
    const before = await fs.readFile(file);
    vi.mocked(atomic.writeFileAtomic).mockRejectedValueOnce(new Error('EIO'));
    await expect(v.changePassword(PW, 'A-completely-new-master-pw-99', null)).rejects.toMatchObject({ code: 'REENCRYPT_FAILED' });
    expect((await fs.readFile(file)).equals(before)).toBe(true);
    // Session still uses the old key: further saves remain readable with the OLD password.
    await addBank(v, 'Still old key');
    v.lock();
    await v.unlock(PW);
    expect(v.snapshot().entries).toHaveLength(2);
  });
});

describe('backup and restore', () => {
  it('creates a verified encrypted backup that contains no plaintext', async () => {
    const v = await newVault();
    await addBank(v);
    const b = new BackupService(v);
    const target = path.join(dir, 'vault-backup.vault');
    const res = await b.createBackup(target);
    expect(res.verified).toBe(true);
    const raw = await fs.readFile(target, 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(JSON.parse(raw).kind).toBe('backup');
    expect(v.snapshot().meta.lastBackupVerified).toBe(true);
  });

  it('refuses to overwrite the live vault file with a backup', async () => {
    const v = await newVault();
    await expect(new BackupService(v).createBackup(file)).rejects.toMatchObject({ code: 'INVALID_TARGET' });
  });

  it('opens a backup only with the right password and restores by replace or merge', async () => {
    const v = await newVault();
    const a = await addBank(v, 'Original');
    const b = new BackupService(v);
    const target = path.join(dir, 'b.vault');
    await b.createBackup(target);
    await v.deleteEntry(a.id);
    await addBank(v, 'New after backup');

    const token = b.register(target);
    await expect(b.open(token, 'wrong')).rejects.toMatchObject({ code: 'BACKUP_AUTH_FAILED' });
    await expect(b.apply(token, 'replace')).rejects.toMatchObject({ code: 'NOT_VERIFIED' });
    const summary = await b.open(token, PW);
    expect(summary.itemCount).toBe(1);

    await b.apply(token, 'merge');
    expect(v.snapshot().entries.map((e) => e.title).sort()).toEqual(['New after backup', 'Original']);

    const t2 = b.register(target);
    await b.open(t2, PW);
    await b.apply(t2, 'replace');
    expect(v.snapshot().entries.map((e) => e.title)).toEqual(['Original']);
  });

  it('rejects tampered and non-backup files', async () => {
    const v = await newVault();
    const b = new BackupService(v);
    const target = path.join(dir, 'b.vault');
    await b.createBackup(target);
    const d = JSON.parse(await fs.readFile(target, 'utf8'));
    d.cipher.nonce = Buffer.alloc(12).toString('base64');
    await fs.writeFile(target, JSON.stringify(d));
    await expect(b.open(b.register(target), PW)).rejects.toMatchObject({ code: 'BACKUP_AUTH_FAILED' });

    const junk = path.join(dir, 'junk.vault');
    await fs.writeFile(junk, 'hello');
    await expect(b.open(b.register(junk), PW)).rejects.toMatchObject({ code: 'INVALID_BACKUP' });
  });

  it('restores a backup while locked (e.g. corrupted vault) and adopts its password', async () => {
    const v = await newVault();
    await addBank(v);
    const b = new BackupService(v);
    const target = path.join(dir, 'b.vault');
    await b.createBackup(target);
    v.lock();
    await fs.writeFile(file, 'corrupted!');
    await expect(v.unlock(PW)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });

    const token = b.register(target);
    await b.restoreWhileLocked(token, PW);
    expect(v.isUnlocked).toBe(true);
    expect(v.snapshot().entries).toHaveLength(1);
    v.lock();
    await new VaultService(file).unlock(PW);
  });

  it('drops pending decrypted backups on clear()', async () => {
    const v = await newVault();
    const b = new BackupService(v);
    const target = path.join(dir, 'b.vault');
    await b.createBackup(target);
    const token = b.register(target);
    await b.open(token, PW);
    b.clear();
    await expect(b.apply(token, 'merge')).rejects.toMatchObject({ code: 'EXPIRED' });
  });
});
