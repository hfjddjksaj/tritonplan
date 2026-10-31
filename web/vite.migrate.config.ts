import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The old Pages site: a plain-DOM hand-off page; React and the planner's stylesheet load
// afterwards, in their own chunk, only to draw the blurred backdrop. Same @triton/shared alias as the app.
export default defineConfig({
  root: 'migrate',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist-migrate', emptyOutDir: true },
  resolve: {
    alias: {
      '@triton/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
});
