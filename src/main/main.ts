// Electron main process: window, OS integration and security hardening.
//
// SECURITY HARDENING SUMMARY
//  * Renderer: sandboxed, contextIsolation on, nodeIntegration off, no webviews,
//    spellcheck off (Chromium's spellchecker would download dictionaries).
//  * Network: every request that is not a local app resource is CANCELLED at the
//    session level — the app cannot talk to the internet even if a bug tried to.
//  * Navigation / new windows / permission requests: all denied.
//  * DevTools: unavailable in production builds; application menu removed (no
//    reload/devtools accelerators).
//  * No crash reporter, no telemetry, no auto-updater.
//  * Single instance: two processes can never write the vault at the same time.

import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  Menu,
  nativeImage,
  powerMonitor,
  protocol,
  session,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { registerIpc } from './ipc';
import { AutoLockTimer } from './services/autoLock';
import { ClipboardManager, electronClipboard } from './services/clipboard';
import { initLogger, log } from './services/logger';
import { APP_ICON_PNG } from './trayIcon';
import { BackupService } from './vault/backupService';
import { VaultService } from './vault/vaultService';

// Dev server is honoured ONLY for unpackaged builds, never in a shipped app.
const DEV_URL = !app.isPackaged ? process.env.VAULTLOCKS_DEV_SERVER_URL : undefined;
const IS_DEV = Boolean(DEV_URL);
// The UI is served from a custom, sandboxed "app://vault/" origin instead of file://
// (recommended by Electron's security checklist): only files inside dist/ can be served.
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const APP_ORIGIN = 'app://vault';
const INDEX_URL = `${APP_ORIGIN}/index.html`;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false } }
]);

// Dev/test only: isolate the profile directory. Ignored in packaged builds.
if (!app.isPackaged && process.env.VAULTLOCKS_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.VAULTLOCKS_USER_DATA));
}

// Refuse remote debugging in shipped builds: it would let another local process
// script the UI. (Node --inspect flags are disabled separately via Electron fuses.)
if (
  app.isPackaged &&
  ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk', 'js-flags'].some((s) => app.commandLine.hasSwitch(s))
) {
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.enableSandbox();
app.setAppUserModelId('local.vaultlocks.app');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const vault = new VaultService(path.join(app.getPath('userData'), 'vault', 'vault.vault'));
const backups = new BackupService(vault);
const clip = new ClipboardManager(electronClipboard(clipboard, ClipboardItem, process.platform));
const autoLock = new AutoLockTimer(() => lockNow('idle'));

// Never show stack traces to users (Electron's default is a native error dialog)
// and never log error details, which could contain data. Fail safe: lock the vault.
process.on('uncaughtException', () => {
  log('main.uncaught_exception');
  try {
    lockNow('system');
  } catch {
    /* ignore */
  }
});
process.on('unhandledRejection', () => log('main.unhandled_rejection'));

function lockNow(reason: 'manual' | 'idle' | 'minimize' | 'system' | 'tray' | 'quit'): void {
  const wasUnlocked = vault.isUnlocked;
  vault.lock(); // wipes key + drops plaintext
  autoLock.stop();
  backups.clear();
  void clip.clearIfOurs();
  if (wasUnlocked) {
    log('vault.locked', { reason });
    // Reloading destroys the renderer's JS heap, discarding any secrets it held.
    if (win && !win.isDestroyed() && reason !== 'quit') win.webContents.reload();
  }
  updateTrayMenu();
}

function onUnlocked(): void {
  applySettings();
  updateTrayMenu();
}

/** Apply the security settings that live in the main process. */
function applySettings(): void {
  autoLock.configure(vault.settings.autoLockMinutes);
  win?.setContentProtection(vault.settings.screenshotProtection);
}

// Background lock: minimized / hidden to tray → lock immediately or after the grace period.
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
function leftApp(): void {
  if (!vault.isUnlocked) return;
  const minutes = vault.settings.backgroundLockMinutes;
  if (minutes === 0) return lockNow('minimize');
  if (minutes > 0) {
    if (backgroundTimer) clearTimeout(backgroundTimer);
    backgroundTimer = setTimeout(() => lockNow('minimize'), minutes * 60_000);
  }
}
function returnedToApp(): void {
  if (backgroundTimer) clearTimeout(backgroundTimer);
  backgroundTimer = null;
}

function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  if (!win || event.sender !== win.webContents) return false;
  const url = event.senderFrame?.url ?? '';
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url.split('#')[0]!.split('?')[0] === INDEX_URL;
}

function isAllowedUrl(url: string): boolean {
  // Only the app's own bundled files (served via app://) — never file:// or remote URLs.
  if (url.startsWith(`${APP_ORIGIN}/`) || url.startsWith('devtools:') || url.startsWith('data:')) return true;
  if (DEV_URL && (url.startsWith(DEV_URL) || url.startsWith(DEV_URL.replace('http', 'ws')))) return true;
  return false;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
};

/** Serve app://vault/<path> strictly from dist/ (no directory traversal). */
function registerAppProtocol(): void {
  session.defaultSession.protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'vault') return new Response('Not found', { status: 404 });
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const file = path.resolve(DIST_DIR, '.' + rel);
    if (!file.startsWith(DIST_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fsp.readFile(file);
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function hardenSession(): void {
  const ses = session.defaultSession;
  // Offline-only: cancel every non-local request (http, https, ws, ftp, …).
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    const allowed = isAllowedUrl(details.url);
    if (!allowed) log('net.blocked');
    cb({ cancel: !allowed });
  });
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setSpellCheckerEnabled(false);
  ses.setSpellCheckerLanguages([]);
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e) => e.preventDefault());
  contents.on('will-redirect', (e) => e.preventDefault());
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// Development builds only: automated UI tests run the window off-screen, out of the taskbar.
const TEST_OFFSCREEN = !app.isPackaged && process.env.VAULTLOCKS_TEST_OFFSCREEN === '1';

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    ...(TEST_OFFSCREEN ? { x: -12000, y: -12000, minWidth: 320, minHeight: 480, skipTaskbar: true, focusable: false } : {}),
    show: false,
    backgroundColor: '#000000',
    title: 'VaultLocks',
    icon: nativeImage.createFromBuffer(Buffer.from(APP_ICON_PNG, 'base64')),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#ffffff', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: IS_DEV,
      safeDialogs: true
    }
  });

  // Hide window contents from screen capture / screen sharing where the OS supports it.
  win.setContentProtection(true);
  win.once('ready-to-show', () => (TEST_OFFSCREEN ? win?.showInactive() : win?.show()));

  win.on('minimize', leftApp);
  win.on('restore', returnedToApp);
  win.on('show', returnedToApp);
  win.on('close', (e) => {
    if (!quitting && vault.isUnlocked && vault.settings.closeToTray && tray) {
      e.preventDefault();
      leftApp();
      win?.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadURL(INDEX_URL);
}

function showWindow(): void {
  if (!win) createWindow();
  if (win?.isMinimized()) win.restore();
  win?.show();
  win?.focus();
}

function updateTrayMenu(): void {
  if (!tray) return;
  tray.setToolTip(vault.isUnlocked ? 'VaultLocks — unlocked' : 'VaultLocks — locked');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open VaultLocks', click: showWindow },
      { label: 'Lock Vault', enabled: vault.isUnlocked, click: () => lockNow('tray') },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
}

function createTray(): void {
  try {
    const icon = nativeImage.createFromBuffer(Buffer.from(APP_ICON_PNG, 'base64')).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.on('click', showWindow);
    updateTrayMenu();
  } catch {
    tray = null; // tray not supported on this desktop
  }
}

app.on('second-instance', showWindow);

app.whenReady().then(async () => {
  initLogger(path.join(app.getPath('userData'), 'logs'));
  log('app.start');
  Menu.setApplicationMenu(null);
  hardenSession();
  registerAppProtocol();
  await vault.init();

  registerIpc({
    vault,
    backups,
    clipboard: clip,
    autoLock,
    getWindow: () => win,
    isTrustedSender,
    onUnlocked,
    lockNow: (reason) => lockNow(reason === 'manual' ? 'manual' : 'tray'),
    onSettingsChanged: applySettings,
    setAppearance: (dark: boolean) => {
      try {
        win?.setTitleBarOverlay({ color: dark ? '#0b0b0f' : '#f2f2f7', symbolColor: dark ? '#ffffff' : '#111111', height: 40 });
        win?.setBackgroundColor(dark ? '#0b0b0f' : '#f2f2f7');
      } catch {
        /* not supported on this platform */
      }
    }
  });

  // Lock when the OS locks the screen, sleeps, or the user switches away (macOS).
  const systemLock = () => {
    if (vault.isUnlocked && vault.settings.lockOnSystemLock) lockNow('system');
  };
  powerMonitor.on('lock-screen', systemLock);
  powerMonitor.on('suspend', systemLock);
  powerMonitor.on('user-did-resign-active', systemLock);

  createWindow();
  createTray();
});

app.on('before-quit', () => {
  quitting = true;
  lockNow('quit');
});

app.on('window-all-closed', () => {
  app.quit();
});
