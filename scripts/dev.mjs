// Development runner: Vite dev server for the renderer + Electron pointing at it.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

process.env.NODE_ENV = 'development';
await import('./build-main.mjs');

const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = 'http://127.0.0.1:5199';

const electronPath = (await import('electron')).default;
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')), VAULTLOCKS_DEV_SERVER_URL: url, NODE_ENV: 'development' }
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
