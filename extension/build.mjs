/**
 * Build the TritonPlan MV3 extension into ./dist with esbuild.
 *
 *   node build.mjs           one-shot PRODUCTION build (planner = GitHub Pages)
 *   node build.mjs --dev     DEV build: planner = http://localhost:5173 (defines
 *                            __TP_DEV__ for src/config.ts and injects the localhost
 *                            matches into the dist manifest — the source manifest.json
 *                            stays production-only, so the store zip never carries
 *                            localhost permissions)
 *   node build.mjs --watch   rebuild on change (combine with --dev for local work)
 *
 * Content scripts are bundled as self-contained IIFEs (no import/export — Chrome loads
 * them as classic scripts). The background service worker is bundled as an ES module
 * (manifest declares `"type": "module"`). Static files (manifest, popup.html) are copied
 * and simple placeholder PNG icons are generated with no network access.
 */

import * as esbuild from 'esbuild';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev');

/** Planner the build targets: production GitHub Pages, or the local Vite server (--dev). */
const PLANNER_URL = dev ? 'http://localhost:5173/' : 'https://hfjddjksaj.github.io/tritonplan/';
const PLANNER_MATCH = `${PLANNER_URL}*`;

/** Planner match the --dev build adds so the bridge also runs on the local Vite server. */
const DEV_PLANNER_MATCH = 'http://localhost:5173/*';

const SHARED_ENTRY = resolve(root, '../shared/src/index.ts');

/** Options common to every esbuild call. */
const common = {
  bundle: true,
  target: 'chrome110',
  platform: 'browser',
  sourcemap: true,
  logLevel: 'info',
  alias: { '@triton/shared': SHARED_ENTRY },
  define: {
    __PLANNER_URL__: JSON.stringify(PLANNER_URL),
    __PLANNER_MATCH__: JSON.stringify(PLANNER_MATCH),
  },
};

/* ---- brand icons, rasterised here (no image library, no network) ----------
 *
 * The mark is `docs/brand/icon-collision.svg`: two class blocks that overlap,
 * and the overlap is the same red the calendar paints a conflict in. Keep the
 * two in sync — the SVG is what a designer would open, this is what ships.
 *
 * Deliberately NOT the old placeholder (a gold trident on navy): that borrows
 * UCSD Tritons' athletic mark, which contradicts the listing's own "not
 * affiliated with UCSD" line. Do not put the trident back.
 * -------------------------------------------------------------------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
// The planner's own tokens (web/src/styles/tokens.css), so the icon and the
// calendar it opens are literally the same four colours.
const INK = [0x0b, 0x1f, 0x3a]; // --ink       the rounded-square ground
const GOLD = [0xff, 0xc7, 0x2c]; // gold        the first class block
const PALE = [0xee, 0xf2, 0xf7]; // --canvas    the second class block
const CLASH = [0xe5, 0x48, 0x4d]; // --conflict  where the two overlap

/**
 * Point-in-rounded-rectangle. `dx`/`dy` measure how far the point sticks out of
 * the inner (un-rounded) box, so they are 0 everywhere except in a corner —
 * which reduces the whole test to one circle check, in the corner only.
 */
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const dx = Math.max(x + r - px, 0, px - (x + w - r));
  const dy = Math.max(y + r - py, 0, py - (y + h - r));
  return dx * dx + dy * dy <= r * r;
}

/**
 * Rasterise the mark at `size`, 4x4 supersampled.
 *
 * The old generator sampled one point per pixel, so every edge was a staircase
 * and 16px was mush. Here each pixel averages 16 samples: colour is the mean of
 * the covered samples and alpha is the coverage itself, which is ordinary
 * (un-premultiplied) RGBA and antialiases the rounded corners for free.
 *
 * The conflict wedge is not drawn as its own shape — it is simply "in both
 * blocks", so its corners inherit the blocks' radii and can never drift out of
 * register with them the way a hand-written path would.
 */
function iconPng(size) {
  const S = size;
  const N = 4; // samples per axis
  const SS = N * N;
  const u = 128 / S; // design units per device pixel
  const raw = Buffer.alloc((S * 4 + 1) * S);
  let p = 0;
  for (let y = 0; y < S; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < S; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const px = (x + (sx + 0.5) / N) * u;
          const py = (y + (sy + 0.5) / N) * u;
          if (!inRoundRect(px, py, 0, 0, 128, 128, 28)) continue; // outside the tile
          const gold = inRoundRect(px, py, 22, 28, 52, 52, 10);
          const pale = inRoundRect(px, py, 54, 48, 52, 52, 10);
          const col = gold && pale ? CLASH : pale ? PALE : gold ? GOLD : INK;
          r += col[0];
          g += col[1];
          b += col[2];
          hits++;
        }
      }
      if (hits === 0) {
        raw[p++] = 0;
        raw[p++] = 0;
        raw[p++] = 0;
        raw[p++] = 0;
      } else {
        raw[p++] = Math.round(r / hits);
        raw[p++] = Math.round(g / hits);
        raw[p++] = Math.round(b / hits);
        raw[p++] = Math.round((hits / SS) * 255);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Copy manifest.json into dist; --dev builds additionally get the localhost planner matches. */
function writeManifest() {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  if (dev) {
    manifest.host_permissions.push(DEV_PLANNER_MATCH);
    const bridge = manifest.content_scripts.find((cs) =>
      cs.js.includes('content/planner-bridge.js'),
    );
    bridge.matches.push(DEV_PLANNER_MATCH);
  }
  writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

function copyStatic() {
  mkdirSync(dist, { recursive: true });
  mkdirSync(resolve(dist, 'icons'), { recursive: true });
  writeManifest();
  copyFileSync(resolve(root, 'src/popup/popup.html'), resolve(dist, 'popup.html'));
  for (const size of [16, 48, 128]) {
    writeFileSync(resolve(dist, `icons/icon${size}.png`), iconPng(size));
  }
}

async function run() {
  rmSync(dist, { recursive: true, force: true });
  copyStatic();

  // IIFE bundles: content scripts + popup (no ESM import/export at runtime).
  const iifeConfig = {
    ...common,
    format: 'iife',
    outdir: dist,
    entryPoints: {
      'content/interceptor': resolve(root, 'src/content/interceptor.ts'),
      'content/tss-relay': resolve(root, 'src/content/tss-relay.ts'),
      'content/tss-inject': resolve(root, 'src/content/tss-inject.ts'),
      'content/soc-sort': resolve(root, 'src/content/soc-sort.ts'),
      'content/planner-bridge': resolve(root, 'src/content/planner-bridge.ts'),
      popup: resolve(root, 'src/popup/popup.ts'),
    },
  };
  // ESM bundle: the service worker (manifest: background.type = "module").
  const esmConfig = {
    ...common,
    format: 'esm',
    outdir: dist,
    entryPoints: {
      'background/service-worker': resolve(root, 'src/background/service-worker.ts'),
    },
  };

  if (watch) {
    const c1 = await esbuild.context(iifeConfig);
    const c2 = await esbuild.context(esmConfig);
    await Promise.all([c1.watch(), c2.watch()]);
    console.log('[tritonplan] watching for changes…');
  } else {
    await Promise.all([esbuild.build(iifeConfig), esbuild.build(esmConfig)]);
    console.log(`[tritonplan] ${dev ? 'DEV' : 'production'} build complete → extension/dist`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
