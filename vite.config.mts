import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * SECURITY: inject a strict Content-Security-Policy into the production build only.
 * - no remote origins of any kind (connect-src 'none' blocks fetch/XHR/WebSocket)
 * - no eval, no inline scripts
 * The dev server needs inline HMR scripts + a websocket, so the CSP is relaxed there.
 */
function cspPlugin(): Plugin {
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'"
  ].join('; ');
  return {
    name: 'vaultlocks-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
      );
    }
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), cspPlugin()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome140',
    // Never inline assets as remote URLs; everything ships inside the app.
    assetsInlineLimit: 0
  },
  server: { port: 5199, strictPort: true, host: '127.0.0.1' }
});
