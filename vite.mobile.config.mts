import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Android (Capacitor) build of the same React UI.
 * CSP: identical to desktop plus 'wasm-unsafe-eval', which the Argon2id
 * WebAssembly module needs (no JavaScript eval is permitted). connect-src 'none'
 * blocks fetch/XHR/WebSocket entirely.
 */
function cspPlugin(): Plugin {
  const csp = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
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
    transformIndexHtml: (html) => html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${csp}" />`)
  };
}

export default defineConfig({
  root: 'src/mobile-web',
  base: './',
  publicDir: '../renderer/public',
  plugins: [react(), cspPlugin()],
  build: {
    outDir: '../../dist-mobile',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome110',
    assetsInlineLimit: 0
  }
});
