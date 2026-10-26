/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `@triton/shared` exports its TS source directly (see shared/package.json `main`).
// Alias it to the source entry so Vite/esbuild compiles it as part of the app graph;
// Vite resolves the package's internal `./x.js` specifiers to their `.ts` siblings.
export default defineConfig({
  // Served at the site root; absolute asset URLs keep /reset and /verify (and any
  // other deep path the server falls back to index.html for) loading the same files.
  base: '/',
  plugins: [react()],
  server: {
    // The API is same-origin in production; in dev the server runs beside Vite.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  resolve: {
    alias: {
      '@triton/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
