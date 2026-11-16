/**
 * Bundle the API server into one file, dist/main.mjs. Production only ever has
 * Node + this file (no npm install on the box), so every dependency is inlined.
 * The banner gives bundled CJS deps a working `require` under ESM output.
 */
import * as esbuild from 'esbuild';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import { entryLine } from './deploy/entry.mjs';

const root = dirname(fileURLToPath(import.meta.url));

// A checkout may keep an entry of its own in src/local/ (gitignored): the same server, started with routes that
// are not part of this repository. When there is one, it is what gets built. The bundle names its entry on its
// first line, which deploy.sh reads back off the release in production (deploy/entry.mjs).
const local = resolve(root, 'src/local/main.ts');
const entry = existsSync(local) ? local : resolve(root, 'src/main.ts');
const entryName = relative(root, entry).replaceAll('\\', '/');
console.log(`entry: ${entryName}`);

await esbuild.build({
  entryPoints: [entry],
  outfile: resolve(root, 'dist/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  alias: { '@triton/shared': resolve(root, '../shared/src/index.ts') },
  banner: {
    js: `${entryLine(entryName)}\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`,
  },
  logLevel: 'info',
});
