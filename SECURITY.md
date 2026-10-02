# VaultLocks — Security Design

VaultLocks is an offline, local-only password vault. This document describes the
cryptographic design, the threat model, the security-sensitive code, known
limitations and how the security properties are tested.

## 1. Cryptography

| Purpose            | Primitive                                     | Parameters |
|--------------------|-----------------------------------------------|------------|
| Key derivation     | **Argon2id** (RFC 9106) via `hash-wasm`       | 64 MiB memory, 3 passes, 4 lanes, 256-bit random salt, 256-bit output |
| Encryption         | **AES-256-GCM** via Node.js / BoringSSL       | 96-bit random nonce per encryption, 128-bit tag |
| Randomness         | OS CSPRNG (`crypto.randomBytes`, `crypto.getRandomValues`) | — |
| Password compare   | `crypto.timingSafeEqual` on derived keys       | — |

* No custom cryptography is implemented. No MD5/SHA-1 are used for security.
* The master password is normalized to Unicode NFC before derivation so the same
  visible password always derives the same key.
* KDF parameters read from files are bounds-checked (min 19 MiB / 2 passes to stop
  downgrades; max 1 GiB / 20 passes to stop denial of service from hostile backups).

### Vault file format (`vault.vault`, JSON)

```
{
  "format": "VAULTLOCKS", "version": 1, "kind": "vault" | "backup",
  "createdAt": "...",
  "kdf":    { "name": "argon2id", "memoryKiB", "iterations", "parallelism", "salt" },
  "cipher": { "name": "aes-256-gcm", "nonce", "tag" },
  "hint":   string | null,          // optional, user-chosen, NOT secret
  "ciphertext": "<base64>"           // AES-256-GCM( JSON payload )
}
```

* **Everything** sensitive — entries, titles, usernames, passwords, notes, tags,
  custom categories and settings — is inside `ciphertext`.
* All header fields (format, version, kind, createdAt, KDF params, salt, hint) are
  bound into the GCM **additional authenticated data**. Changing any of them (e.g.
  lowering KDF cost, swapping the hint) makes decryption fail.
* GCM's tag is verified by `decipher.final()` before any plaintext is accepted; a
  wrong password and a tampered file produce the same generic error.
* Every save re-encrypts with a fresh random nonce and is written atomically
  (temp file → fsync → rename), so a crash or power loss leaves either the old or
  the new vault — never a partial one. Leftover temp files are removed on start.

### Master password change

1. Verify the current password (derive + constant-time compare with the session key).
2. Generate a **new salt**, derive a new key, re-encrypt the whole payload.
3. Decrypt the new ciphertext in memory to verify it.
4. Atomically replace the vault file.
5. Only then switch the session to the new key.

If any step fails, the original vault file and session are untouched.

### Backups

Backups are full encrypted vault files (`kind: "backup"`) protected by the master
password at the time of backup. After writing, the backup is read back and
decrypted to verify it. Restoring validates and authenticates the backup **before**
anything is changed, and always asks for confirmation. Plaintext export exists only
behind re-authentication, a typed confirmation phrase and a native save dialog.

## 2. Application hardening (Electron)

* Renderer: `sandbox`, `contextIsolation`, no `nodeIntegration`, no `webview`,
  spellcheck disabled (Chromium's spellchecker would download dictionaries).
* Preload exposes a single typed API (`window.vault`) — no generic IPC access.
* Every IPC handler verifies the sender is our own page and validates all input.
* UI is served from a custom `app://vault/` origin restricted to the `dist/` folder
  (no `file://`), with a strict CSP: `default-src 'none'; script-src 'self';
  connect-src 'none'; …`.
* **Network:** every request that is not a bundled app resource is cancelled at the
  session level. There is no update check, telemetry, analytics or crash reporter.
* Navigation, new windows, permission requests and webviews are all denied.
* No application menu (removes reload/DevTools accelerators); DevTools are disabled
  outside development.
* Packaged builds refuse to start with `--remote-debugging-*`, `--inspect*` or
  `--js-flags`, and Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`
  and Node inspect arguments, enable ASAR integrity validation and load the app
  only from the ASAR.
* Single-instance lock: two processes can never write the vault simultaneously.
* Window content protection is enabled (hidden from screen capture where the OS
  supports it).
* Uncaught main-process errors never show a stack trace; the vault is locked.

## 3. Secrets in memory, UI, clipboard and logs

* The derived key lives only in the main process in a `Buffer` that is overwritten
  on lock. Password bytes are wiped immediately after key derivation.
* The renderer receives **redacted** entries: secret field values are never sent
  for lists, search or the dashboard. A value is sent only when the user clicks
  *Show* (auto-hidden after a configurable timeout) or opens the edit form.
* Copying a secret happens entirely in the main process; the renderer never sees it.
  The clipboard is cleared after 15–90 s (only if it still holds our value). On
  Windows the copy is flagged `ExcludeClipboardContentFromMonitorProcessing`, so it
  is not saved in Clipboard History (Win+V) or synced by Cloud Clipboard.
* Locking (button, Ctrl+L, tray, inactivity, minimize, OS lock/sleep) wipes the key,
  drops the decrypted payload and pending backups, clears our clipboard value, and
  **reloads the renderer**, discarding its entire JavaScript heap.
* The logger accepts only an event name plus allow-listed, short, code-like values.
  It cannot log passwords, titles, field values, search queries or error messages.

## 4. Threat model

**Protected against**

* Theft or copying of the vault file or a backup (offline brute force is slowed by
  Argon2id; strength depends on the master password).
* Tampering with or corrupting the vault/backup (detected by GCM authentication).
* Someone at an unattended, unlocked computer (auto-lock, lock on minimize/OS lock).
* Accidental disclosure through logs, crash dialogs, clipboard history or the network.

**Not protected against**

* Malware or an attacker with code execution as your user while the vault is
  unlocked (keyloggers, memory readers, screen grabbers). No password manager can
  defend against a compromised OS.
* A weak or reused master password. Setup requires at least "Fair" strength;
  a long passphrase is strongly recommended.
* Forgotten master passwords. **There is deliberately no recovery or bypass.**

## 5. Known limitations

* JavaScript strings are immutable and garbage-collected, so plaintext that passes
  through JSON parsing or the UI (e.g. a revealed password) cannot be reliably
  erased; its lifetime is minimized instead. Keys and password bytes are kept in
  wipeable buffers. `hash-wasm` copies the password into WASM memory internally.
* The unlock-attempt throttle is in memory only; it slows interactive guessing,
  not offline attacks on a copied file (that is Argon2id's job).
* The optional password hint is stored unencrypted by design (it must be readable
  before unlocking). The app refuses hints that contain the password.
* Window content protection and clipboard-history exclusion depend on OS support.

## 6. Security-sensitive code

| File | Responsibility |
|------|----------------|
| `src/main/security/crypto.ts`    | Argon2id, AES-256-GCM, parameter validation |
| `src/main/security/vaultFile.ts` | File format, AAD binding, strict parsing |
| `src/main/security/memory.ts`    | Buffer wiping |
| `src/main/vault/vaultService.ts` | Session key, unlock/lock, redaction, password change, backups |
| `src/main/vault/schema.ts`       | Validation of IPC input and decrypted payloads |
| `src/main/vault/backupService.ts`| Backup/restore with opaque file tokens |
| `src/main/storage/atomicFile.ts` | Crash-safe writes |
| `src/main/services/clipboard.ts` | Clipboard copy + auto-clear |
| `src/main/services/logger.ts`    | Secret-free logging |
| `src/main/ipc.ts`                | Trust boundary between renderer and main |
| `src/main/main.ts`               | Electron hardening, network blocking, lock triggers |
| `src/preload/preload.ts`         | The only API exposed to the renderer |
| `src/shared/generator.ts`        | CSPRNG password/passphrase generation |

## 7. Android app

* Same file format and parameters; implemented with WebCrypto (AES-256-GCM) and
  hash-wasm (Argon2id). The session key is a **non-extractable** `CryptoKey`.
* Vault stored in app-private internal storage via a native plugin with atomic
  writes; `allowBackup=false` + data-extraction rules exclude it from Google cloud
  backup and device transfer.
* `FLAG_SECURE` blocks screenshots, screen recording and the recents thumbnail.
* Clipboard: values are flagged `EXTRA_IS_SENSITIVE` and cleared by a native timer
  that keeps running while the app is in the background.
* Locks when the app goes to the background (configurable) and enforces the
  auto-lock timeout on resume; locking reloads the WebView.
* CSP: `connect-src 'none'`; the only extra allowance is `'wasm-unsafe-eval'` for the
  Argon2id WebAssembly module. Cleartext traffic is disabled. The `INTERNET`
  permission remains only because Android WebView needs it to load the app's
  bundled pages; the app makes no network requests.
* Release APKs are signed with a dedicated key stored only as GitHub secrets and
  on the owner's machine (never in the repository).

## 8. Testing

`npm test` runs 73 automated tests, including:

* correct / wrong master password, throttling, Unicode (NFC vs NFD) and ~1000-char
  master passwords, application restart;
* modified ciphertext, invalid tag, modified nonce, modified header/hint/KDF params,
  truncated / empty / garbage files, leftover temp files after interruption;
* no plaintext (secrets, titles, tags, master password) on disk; fresh nonce per save;
* redaction of secrets from snapshots; CRUD, duplicates, favorites order, deletion,
  empty fields, special characters, Unicode, very long and over-long values,
  dangerous URL schemes, prototype-pollution keys;
* failed writes leave memory and disk unchanged; password change re-salts, old
  password stops working, and a failed re-encryption preserves the original vault;
* backup creation/verification, wrong backup password, tampered backups, merge and
  replace restore, restore while locked (corrupted vault);
* generator length/charset/uniformity/passphrases, strength estimation;
* clipboard auto-clear (and not clearing values copied later), auto-lock timer;
* Android vault: unlock/tamper/write-failure/password-change/backup tests and full
  **desktop ⇄ Android file compatibility** in both directions;
* logger redaction, plus static checks that the source contains no console logging,
  no `Math.random`, no MD5/SHA-1 and no network APIs.

The app was also driven end-to-end in Electron (setup, CRUD, search, favorites,
reveal/copy, settings, backup/verify/restore, password change, clipboard clearing,
lock on Ctrl+L / minimize / 60 s inactivity, blocked network, 1024×768 layout), and
the packaged build was checked for fuses and refusal of remote debugging.
