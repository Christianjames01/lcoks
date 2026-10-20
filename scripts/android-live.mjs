// Live reload on a phone over USB (like Expo Go): npm run android:live
//
//   1. Vite dev server for the mobile UI on this PC (127.0.0.1 only).
//   2. `adb reverse` maps the phone's localhost:PORT to it through the USB cable.
//   3. Installs the DEBUG build "VaultLocks Dev" (com.vaultlocks.app.dev): a separate
//      app with its own empty vault, so the real VaultLocks and its data are untouched.
//   4. Its WebView loads the UI from the dev server; saving a file reloads the phone.
//
// The live-reload URL is written only into the debug source set
// (android/app/src/debug/assets), so release builds never contain it.
// Needs JAVA_HOME and ANDROID_HOME (or ANDROID_SDK_ROOT) and USB debugging on the phone.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const PORT = 5180;
const APP_ID = 'com.vaultlocks.app.dev';
const root = path.resolve(import.meta.dirname, '..');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk || !process.env.JAVA_HOME) {
  console.error('Set JAVA_HOME and ANDROID_HOME first.');
  process.exit(1);
}
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

// Phone connected and authorised?
const devices = execFileSync(adb, ['devices'], { encoding: 'utf8' })
  .split('\n')
  .slice(1)
  .map((l) => l.trim().split(/\s+/))
  .filter((p) => p[0]);
const ready = devices.filter((p) => p[1] === 'device');
if (!ready.length) {
  const unauth = devices.some((p) => p[1] === 'unauthorized');
  console.error(unauth ? 'Phone found but not authorised: tap "Allow" on the USB debugging prompt on the phone.' : 'No phone found. Connect it by USB with USB debugging on.');
  process.exit(1);
}
const serial = ready[0][0];
console.log(`Phone: ${serial}`);

// 1. dev server
const server = await createServer({ configFile: path.join(root, 'vite.mobile.config.mts'), server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
console.log(`Dev server: http://127.0.0.1:${PORT}`);

// 2. USB tunnel
run(adb, ['-s', serial, 'reverse', `tcp:${PORT}`, `tcp:${PORT}`]);

// 3. sync native project, point the debug build at the dev server, install
if (!fs.existsSync(path.join(root, 'dist-mobile', 'index.html'))) run('npm', ['run', 'build:mobile'], { shell: true });
run('npx', ['cap', 'sync', 'android'], { shell: true });
const main = JSON.parse(fs.readFileSync(path.join(root, 'android/app/src/main/assets/capacitor.config.json'), 'utf8'));
const debugAssets = path.join(root, 'android/app/src/debug/assets');
fs.mkdirSync(debugAssets, { recursive: true });
fs.writeFileSync(
  path.join(debugAssets, 'capacitor.config.json'),
  JSON.stringify({ ...main, server: { ...(main.server ?? {}), url: `http://localhost:${PORT}`, cleartext: true } }, null, 2)
);
const gradlew = path.join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const r = spawnSync(`"${gradlew}" installDebug --no-daemon -q`, { cwd: path.join(root, 'android'), stdio: 'inherit', shell: true, env: { ...process.env, ANDROID_SERIAL: serial } });
if (r.status !== 0) {
  await server.close();
  process.exit(r.status ?? 1);
}

// 4. open it
run(adb, ['-s', serial, 'shell', 'am', 'start', '-n', `${APP_ID}/com.vaultlocks.app.MainActivity`]);
console.log('\nVaultLocks Dev is open on the phone. Edits reload it automatically. Ctrl+C to stop.');

const stop = async () => {
  try {
    execFileSync(adb, ['-s', serial, 'reverse', '--remove', `tcp:${PORT}`]);
  } catch {
    /* phone unplugged */
  }
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
