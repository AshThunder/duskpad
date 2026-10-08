// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { fileURLToPath } from 'node:url';

// Top-level await and WASM ESM integration are used natively (build target esnext).
// Local services are proxied so the browser talks to one origin:
//   /api        -> DuskPad API (mock issuer + registry)        :8787
//   /dev-wallet -> local dev wallet bridge (undeployed only)  :8797
//   /indexer    -> Midnight indexer (GraphQL + WS)             :8088
//   /prover     -> proof server                                :6300
// A second build (e.g. VITE_NETWORK=preprod) can live beside the local one: DUSKPAD_OUT_DIR picks the
// output folder for both `vite build` and `vite preview`, and DUSKPAD_PREVIEW_PORT the preview port.
const outDir = process.env.DUSKPAD_OUT_DIR ?? 'dist';
const previewPort = Number(process.env.DUSKPAD_PREVIEW_PORT ?? 4173);
// Wallets that prove in the extension (1AM) may fetch prover/verifier keys and ZKIR from another
// origin, so static assets are served with permissive CORS. Nothing here is secret.
const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

export default defineConfig({
  plugins: [react(), wasm()],
  resolve: {
    alias: {
      'isomorphic-ws': fileURLToPath(new URL('./src/shims/isomorphic-ws.ts', import.meta.url)),
      assert: fileURLToPath(new URL('./src/shims/assert.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    cors: true,
    headers: corsHeaders,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/dev-wallet': 'http://127.0.0.1:8797',
      '/indexer': { target: 'http://127.0.0.1:8088', ws: true, rewrite: (p) => p.replace(/^\/indexer/, '') },
      '/prover': { target: 'http://127.0.0.1:6300', rewrite: (p) => p.replace(/^\/prover/, ''), timeout: 600_000, proxyTimeout: 600_000 },
    },
  },
  preview: {
    port: previewPort,
    strictPort: true,
    host: '127.0.0.1',
    cors: true,
    headers: corsHeaders,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/dev-wallet': 'http://127.0.0.1:8797',
      '/indexer': { target: 'http://127.0.0.1:8088', ws: true, rewrite: (p) => p.replace(/^\/indexer/, '') },
      '/prover': { target: 'http://127.0.0.1:6300', rewrite: (p) => p.replace(/^\/prover/, ''), timeout: 600_000, proxyTimeout: 600_000 },
    },
  },
  build: { target: 'esnext', chunkSizeWarningLimit: 4000, outDir },
  optimizeDeps: { esbuildOptions: { target: 'esnext' }, exclude: ['@midnight-ntwrk/onchain-runtime-v3', '@midnight-ntwrk/ledger-v8'] },
  worker: { format: 'es', plugins: () => [wasm()] },
});
