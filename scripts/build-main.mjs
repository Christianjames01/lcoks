// Bundles the Electron main process and the (sandboxed) preload script.
// The preload MUST be a single self-contained CommonJS file because sandboxed
// preloads cannot `require` local modules.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: false,
  minify: false,
  legalComments: 'inline',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') }
};

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist-electron/main.js' });
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist-electron/preload.js' });
