/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `@triton/shared` exports its TS source directly (see shared/package.json `main`).
// Alias it to the source entry so Vite/esbuild compiles it as part of the app graph;
// Vite resolves the package's internal `./x.js` specifiers to their `.ts` siblings.
export default defineConfig({
  base: './', // static build must work when hosted in a subpath
  plugins: [react()],
  resolve: {
    alias: {
      '@triton/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
