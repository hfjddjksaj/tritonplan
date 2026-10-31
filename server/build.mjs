/**
 * Bundle the API server into one file, dist/main.mjs. Production only ever has
 * Node + this file (no npm install on the box), so every dependency is inlined.
 * The banner gives bundled CJS deps a working `require` under ESM output.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [resolve(root, 'src/main.ts')],
  outfile: resolve(root, 'dist/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  alias: { '@triton/shared': resolve(root, '../shared/src/index.ts') },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
