// Storage used by the vault core. Implemented by the desktop app (Node file
// system, src/main/vault/nodeStorage.ts) and the Android app (native plugin,
// src/mobile/nativeStorage.ts). All files live in ONE private vault folder:
//
//   vault.vault        the encrypted vault (JSON, see core/crypto.ts)
//   att-<id>.att       one encrypted attachment (base64 of nonce‖ciphertext‖tag)
//   att-<id>.new       attachment re-encrypted during a password change (transient)

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
const STORAGE_NAME = /^(vault\.vault|att-[A-Za-z0-9-]{8,64}\.(att|new))$/;

/** Every storage implementation accepts only these names (no paths, no traversal). */
export function assertStorageName(name: string): void {
  if (!STORAGE_NAME.test(name)) throw new Error('Invalid storage name');
}
