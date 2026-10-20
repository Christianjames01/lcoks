// Android implementation of the vault storage: the app's private internal
// storage (Context.getFilesDir()/vault) through the native plugin.

import { VAULT_FILE, VAULT_FILE_NAMES, assertStorageName, type StoredFile, type VaultStorage } from '../core/storage';
import type { NativeVault } from './native';

export class NativeStorage implements VaultStorage {
  readonly location = `App private storage / ${VAULT_FILE}`;

  constructor(private readonly native: NativeVault) {}

  read(name: string): Promise<string | null> {
    assertStorageName(name);
    return this.native.read(name);
  }

  writeAtomic(name: string, data: string): Promise<void> {
    assertStorageName(name);
    return this.native.writeAtomic(name, data);
  }

  remove(name: string): Promise<void> {
    assertStorageName(name);
    return this.native.remove(name);
  }

  rename(from: string, to: string): Promise<void> {
    assertStorageName(from);
    assertStorageName(to);
    return this.native.rename(from, to);
  }

  stat(name: string): Promise<{ size: number; mtime: number } | null> {
    assertStorageName(name);
    return this.native.stat(name);
  }

  async list(): Promise<StoredFile[]> {
    // The folder also holds quick-unlock records; only report vault files.
    return (await this.native.list()).filter((f) => VAULT_FILE_NAMES.test(f.name));
  }

  freeSpace(): Promise<number | null> {
    return this.native.freeSpace();
  }
}
