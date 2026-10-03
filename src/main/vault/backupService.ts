// Backup / restore orchestration.
//
// SECURITY: the renderer never supplies file-system paths. Files are chosen via
// native dialogs in the main process and referred to by an opaque random token.
// A decrypted backup is held only until the user applies or discards it, and is
// dropped on lock or after a short expiry.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MAX_FILE_CHARS } from '../../core/crypto';
import type { OpenedBackup } from '../../core/vault';
import type { BackupSummary } from '../../shared/types';
import { writeFileAtomic } from '../storage/atomicFile';
import { VaultError, VaultService } from './vaultService';

interface PendingFile {
  path: string;
  createdAt: number;
  decrypted?: OpenedBackup;
}

const TOKEN_TTL_MS = 10 * 60_000;

export function backupFileName(date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return `vault-backup-${d}.vault`;
}

export class BackupService {
  private pending = new Map<string, PendingFile>();

  constructor(private readonly vault: VaultService) {}

  /** Write an encrypted backup and verify it by reading it back and decrypting. */
  async createBackup(target: string): Promise<{ path: string; verified: boolean }> {
    if (path.resolve(target) === path.resolve(this.vault.vaultPath)) {
      throw new VaultError('INVALID_TARGET', 'Choose a different location than the live vault file.');
    }
    const data = await this.vault.buildBackup();
    await writeFileAtomic(target, Buffer.from(data, 'utf8'));
    const readBack = await fs.readFile(target, 'utf8');
    const verified = await this.vault.verifyBackup(readBack);
    await this.vault.markBackup(verified);
    if (!verified) throw new VaultError('BACKUP_VERIFY_FAILED', 'The backup was written but could not be verified. Try another location.');
    return { path: target, verified };
  }

  register(filePath: string): string {
    this.prune();
    const token = randomBytes(16).toString('hex');
    this.pending.set(token, { path: filePath, createdAt: Date.now() });
    return token;
  }

  private get(token: unknown): PendingFile {
    this.prune();
    const p = typeof token === 'string' ? this.pending.get(token) : undefined;
    if (!p) throw new VaultError('EXPIRED', 'This file selection has expired. Please choose the file again.');
    return p;
  }

  private async readFile(p: PendingFile): Promise<string> {
    try {
      const stat = await fs.stat(p.path);
      if (!stat.isFile() || stat.size > MAX_FILE_CHARS) throw new Error();
      return await fs.readFile(p.path, 'utf8');
    } catch {
      throw new VaultError('INVALID_BACKUP', 'This file could not be read.');
    }
  }

  /** Validate + decrypt a backup (authentication verified) and summarize it. */
  async open(token: unknown, password: string): Promise<BackupSummary> {
    const p = this.get(token);
    const raw = await this.readFile(p);
    const opened = await VaultService.decryptFile(raw, password);
    const { payload, file } = opened;
    p.decrypted = opened;
    return {
      token: token as string,
      fileName: path.basename(p.path),
      itemCount: payload.entries.length,
      categoryCount: payload.customCategories.length,
      createdAt: file.createdAt,
      kind: file.kind
    };
  }

  async apply(token: unknown, mode: unknown): Promise<void> {
    const p = this.get(token);
    if (!p.decrypted) throw new VaultError('NOT_VERIFIED', 'Open and verify the backup first.');
    if (mode !== 'replace' && mode !== 'merge') throw new VaultError('INVALID', 'Invalid restore mode.');
    await this.vault.applyBackup(p.decrypted, mode);
    this.pending.delete(token as string);
  }

  async restoreWhileLocked(token: unknown, password: string): Promise<void> {
    const p = this.get(token);
    const raw = await this.readFile(p);
    await this.vault.restoreWhileLocked(raw, password);
    this.pending.delete(token as string);
  }

  discard(token: unknown): void {
    if (typeof token === 'string') this.pending.delete(token);
  }

  /** Drop every pending (possibly decrypted) backup — called on lock. */
  clear(): void {
    this.pending.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [t, p] of this.pending) if (now - p.createdAt > TOKEN_TTL_MS) this.pending.delete(t);
  }
}
