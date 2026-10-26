import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The old Pages site: a React-free hand-off page. Same @triton/shared alias as the app.
export default defineConfig({
  root: 'migrate',
  base: './',
  build: { outDir: '../dist-migrate', emptyOutDir: true },
  resolve: {
    alias: {
      '@triton/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
});
