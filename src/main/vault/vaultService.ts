// Desktop vault: the shared vault core (src/core/vault.ts) on the local file system.

import path from 'node:path';
import { AppError, VaultCore } from '../../core/vault';
import { NodeStorage } from './nodeStorage';

export { AppError as VaultError, UNLOCK_FAILED_MESSAGE } from '../../core/vault';

export class VaultService extends VaultCore {
  private readonly nodeStorage: NodeStorage;

  constructor(
    /** Full path of vault.vault; attachments are stored next to it. */
    readonly vaultPath: string,
    now?: () => Date
  ) {
    const storage = new NodeStorage(path.dirname(vaultPath));
    super(storage, now);
    this.nodeStorage = storage;
  }

  async init(): Promise<void> {
    await this.nodeStorage.cleanup();
  }

  vaultExists(): Promise<boolean> {
    return this.exists();
  }
}

export { AppError };
