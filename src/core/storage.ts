// Storage used by the vault core. Implemented by the desktop app (Node file
// system, src/main/vault/nodeStorage.ts) and the Android app (native plugin,
// src/mobile/nativeStorage.ts). All files live in ONE private vault folder:
//
//   vault.vault        the encrypted vault (JSON, see core/crypto.ts)
//   att-<id>.att       one encrypted attachment (base64 of nonce‖ciphertext‖tag)
//   att-<id>.new       attachment re-encrypted during a password change (transient)
//   inbox.pub          public key for adding expenses while locked (see core/inbox.ts)
//   inbox.meta         account names (Cash, GCash…) for the locked quick-add pop-up
//   inbox-<id>.box     one expense added while locked, encrypted to inbox.pub

export interface StoredFile {
  name: string;
  size: number;
}

export interface VaultStorage {
  /** Human-readable location (shown in Settings → Database information). */
  readonly location: string;
  read(name: string): Promise<string | null>;
  /** Write via temp file + fsync + rename: the old content survives any crash. */
  writeAtomic(name: string, data: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** Rename, replacing the target if it exists. */
  rename(from: string, to: string): Promise<void>;
  stat(name: string): Promise<{ size: number; mtime: number } | null>;
  list(): Promise<StoredFile[]>;
  /** Free space on the device in bytes, or null if unknown. */
  freeSpace(): Promise<number | null>;
}

export const VAULT_FILE = 'vault.vault';
export const attachmentFile = (id: string) => `att-${id}.att`;
export const pendingAttachmentFile = (id: string) => `att-${id}.new`;
export const INBOX_PUB_FILE = 'inbox.pub';
/** Account names for the locked quick-add pop-up (no balances). */
export const INBOX_META_FILE = 'inbox.meta';
export const inboxFile = (id: string) => `inbox-${id}.box`;
export const INBOX_FILE = /^inbox-([A-Za-z0-9-]{8,64})\.box$/;
/** Every file name the vault folder may hold. */
export const VAULT_FILE_NAMES = /^(vault\.vault|att-[A-Za-z0-9-]{8,64}\.(att|new)|inbox\.(pub|meta)|inbox-[A-Za-z0-9-]{8,64}\.box)$/;
const STORAGE_NAME = VAULT_FILE_NAMES;

/** Every storage implementation accepts only these names (no paths, no traversal). */
export function assertStorageName(name: string): void {
  if (!STORAGE_NAME.test(name)) throw new Error('Invalid storage name');
}
