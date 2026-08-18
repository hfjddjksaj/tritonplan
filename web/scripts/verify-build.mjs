#!/usr/bin/env node
/**
 * Post-build guard: does the thing we shipped actually have the files it will
 * ask for at runtime, on our own origin?
 *
 * This exists because of QA C1. `maplibre-gl@6` resolves its web worker at
 * runtime, from `import.meta.url` of whatever chunk it landed in, and that
 * worker statically imports a sibling `maplibre-gl-shared.mjs`. Neither file is
 * in the module graph Rollup sees, so for nine tasks the build emitted neither —
 * and NOTHING NOTICED. Not the type checker, not 451 unit tests, not the
 * console: a worker that fails to load raises no MapLibre `error` event, so the
 * map simply sat on "Loading campus…" forever. `vite preview` even hid the 404
 * behind its SPA fallback; only GitHub Pages would have shown it as a 404.
 *
 * So this check runs against the emitted directory, which is the only place the
 * defect is visible. It is deliberately specific rather than clever: it names
 * the exact shape the fix has to keep.
 *
 * Run automatically by `npm run build -w @triton/web`.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const problems = [];
const fail = (msg) => problems.push(msg);

async function jsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await jsFiles(p)));
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error('verify-build: no dist/ — run `vite build` first.');
  process.exit(1);
}

const files = await jsFiles(DIST);
const assets = await readdir(join(DIST, 'assets'));

/* ---- 1. MapLibre's worker is emitted, exactly once ---------------------- */
const workers = assets.filter((f) => /maplibre-gl-worker.*\.(js|mjs)$/.test(f));
if (workers.length !== 1) {
  fail(
    `expected exactly one emitted MapLibre worker in dist/assets, found ${workers.length}` +
      (workers.length ? `: ${workers.join(', ')}` : '') +
      ' — see src/lib/map-worker.ts',
  );
}

/* ---- 2. It is self-contained ------------------------------------------- */
// The trap a plain `?url` import falls into: the worker is copied verbatim
// under a hashed name, and its own `import './maplibre-gl-shared.mjs'` then
// points at a sibling that was never emitted. `?worker&url` gives the worker
// its own Rollup build, so the shared chunk is bundled INTO it and no import
// survives.
for (const w of workers) {
  const src = await readFile(join(DIST, 'assets', w), 'utf8');
  if (/from\s*["'][^"']*maplibre-gl-shared/.test(src) || /import\s*["'][^"']*maplibre-gl-shared/.test(src)) {
    fail(`${w} still imports maplibre-gl-shared as a separate file — that sibling is never emitted`);
  }
}

/* ---- 3. Something actually points at it -------------------------------- */
const referenced = files.some(
  (f) => f.endsWith('.js') || f.endsWith('.mjs'),
);
if (referenced && workers.length === 1) {
  const anyRefs = (
    await Promise.all(files.map(async (f) => (await readFile(f, 'utf8')).includes(workers[0])))
  ).some(Boolean);
  if (!anyRefs) fail(`nothing in the build references ${workers[0]} — setWorkerUrl() is not wired up`);
}

/* ---- 4. Every statically-named runtime URL resolves --------------------- */
// `new URL("thing", import.meta.url)` is how Vite emits an asset reference
// under `base: './'`. Each one must land on a file that exists, or it is a
// same-origin 404 waiting to happen on GitHub Pages.
for (const f of files) {
  const src = await readFile(f, 'utf8');
  for (const m of src.matchAll(/new URL\(\s*"([^"]+)"\s*,\s*import\.meta\.url\s*\)/g)) {
    const spec = m[1];
    if (/^[a-z]+:/i.test(spec) || spec.startsWith('/')) {
      fail(`${relative(DIST, f)} builds a runtime URL from a non-relative specifier ${JSON.stringify(spec)}`);
      continue;
    }
    const target = resolve(dirname(f), spec);
    if (!existsSync(target)) {
      fail(`${relative(DIST, f)} points at ${JSON.stringify(spec)}, which is not in the build`);
    }
  }
}

/* ---- 5. The glyph PBFs the style names are there ------------------------ */
for (const stack of ['Inter-Regular', 'Inter-SemiBold']) {
  const pbf = join(DIST, 'map', 'fonts', stack, '0-255.pbf');
  if (!existsSync(pbf)) fail(`missing glyph range ${stack}/0-255.pbf — map labels would render as nothing`);
  else if ((await stat(pbf)).size === 0) fail(`${stack}/0-255.pbf is empty`);
}

if (problems.length) {
  console.error('\nverify-build FAILED:');
  for (const p of problems) console.error('  • ' + p);
  console.error('');
  process.exit(1);
}
console.log(`verify-build: ok (worker ${workers[0]}, ${files.length} emitted scripts checked)`);
