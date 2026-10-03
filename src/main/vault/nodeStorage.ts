// Desktop implementation of the vault storage: one private folder on disk.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assertStorageName, type StoredFile, type VaultStorage } from '../../core/storage';
import { cleanupTempFiles, writeFileAtomic } from '../storage/atomicFile';

export class NodeStorage implements VaultStorage {
  constructor(readonly dir: string) {}

  get location(): string {
    return path.join(this.dir, 'vault.vault');
  }

  private file(name: string): string {
    assertStorageName(name);
    return path.join(this.dir, name);
  }

  async read(name: string): Promise<string | null> {
    try {
      return await fs.readFile(this.file(name), 'utf8');
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null;
      throw e;
    }
  }

  async writeAtomic(name: string, data: string): Promise<void> {
    await writeFileAtomic(this.file(name), Buffer.from(data, 'utf8'));
  }

  async remove(name: string): Promise<void> {
    await fs.rm(this.file(name), { force: true });
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.rename(this.file(from), this.file(to));
  }

  async stat(name: string): Promise<{ size: number; mtime: number } | null> {
    try {
      const s = await fs.stat(this.file(name));
      return { size: s.size, mtime: s.mtimeMs };
    } catch {
      return null;
    }
  }

  async list(): Promise<StoredFile[]> {
    let names: string[] = [];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const out: StoredFile[] = [];
    for (const name of names) {
      if (!/^(vault\.vault|att-[A-Za-z0-9-]{8,64}\.(att|new))$/.test(name)) continue;
      const s = await fs.stat(path.join(this.dir, name)).catch(() => null);
      if (s?.isFile()) out.push({ name, size: s.size });
    }
    return out;
  }

  async freeSpace(): Promise<number | null> {
    try {
      const s = await fs.statfs(this.dir);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return null;
    }
  }

  /** Remove leftover temp files from an interrupted write. */
  async cleanup(): Promise<void> {
    await cleanupTempFiles(this.location);
  }
}
