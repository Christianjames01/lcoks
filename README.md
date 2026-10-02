# VaultLocks

A secure, **offline-only** desktop password vault for bank credentials, passwords,
PINs, recovery codes, Wi-Fi passwords, software licenses and private notes.

* No internet, no account, no cloud, no telemetry — all network access is blocked.
* Argon2id key derivation + AES-256-GCM authenticated encryption.
* Strict black-and-white interface.

See [SECURITY.md](SECURITY.md) for the full security design and threat model.

## Requirements

* Node.js 22+ and npm (development only; the packaged app is self-contained).

## Run

```bash
npm install
npm start          # build and launch the app
npm run dev        # development mode with hot reload (DevTools enabled)
npm test           # 65 automated security & functionality tests
npm run typecheck
npm run dist       # build a Windows installer into release/
```

## Where is my data?

The encrypted vault is stored at:

* Windows: `%APPDATA%\VaultLocks\vault\vault.vault`
* macOS: `~/Library/Application Support/VaultLocks/vault/vault.vault`
* Linux: `~/.config/VaultLocks/vault/vault.vault`

**Make encrypted backups** (Settings → Vault & Backup). Losing both your device and
your backup, or forgetting your master password, makes the data unrecoverable.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+K   | Search |
| Ctrl+N   | New item |
| Ctrl+L   | Lock vault |
| Ctrl+G   | Password generator |
| Ctrl+,   | Settings |
| Esc      | Close dialog / clear search |
| Enter    | Submit form (Ctrl+Enter inside notes) |
| ↑ / ↓    | Move through the item list |

## Architecture

```
src/
├── main/                     Electron main process (trusted)
│   ├── main.ts               window, hardening, network blocking, lock triggers, tray
│   ├── ipc.ts                validated IPC boundary
│   ├── security/             crypto.ts · vaultFile.ts · memory.ts
│   ├── vault/                vaultService.ts · backupService.ts · schema.ts
│   ├── services/             clipboard.ts · autoLock.ts · logger.ts
│   └── storage/              atomicFile.ts
├── preload/preload.ts        the only API exposed to the UI (window.vault)
├── shared/                   types, categories, generator, strength, search
└── renderer/                 React UI (sandboxed, no Node.js, no secrets at rest)
tests/                        Vitest suites
```

Cryptography never lives in UI components: the renderer only calls the narrow
`window.vault` API, and the main process owns the key, the decrypted data, the
clipboard and the file system.

## Licenses

MIT. Third-party: Electron/Chromium (MIT/BSD), React (MIT), hash-wasm (MIT),
Lucide icons (ISC), EFF Large Wordlist (CC BY 3.0 US).
