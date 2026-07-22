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

/* ---- placeholder icons (a white "+" on the brand blue, no network) -------- */
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
function iconPng(size) {
  const NAVY = [0x0b, 0x1f, 0x3a, 0xff]; // deep navy hexagon (the planner's --ink token)
  const GOLD = [0xff, 0xc7, 0x2c, 0xff]; // gold trident
  const CLEAR = [0, 0, 0, 0];
  const S = size;
  const cx = S / 2;
  const cy = S / 2;
  const f = (v) => v * S;
  // deep-purple pointy-top hexagon (point-in-polygon)
  const R = S * 0.49;
  const verts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    verts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  const inHex = (x, y) => {
    let inside = false;
    for (let i = 0, j = 5; i < 6; j = i++) {
      const [xi, yi] = verts[i];
      const [xj, yj] = verts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  // gold trident: 3 pointed prongs + crossbar + shaft + base foot
  const spike = (x, y, sx, tipY, baseY, half) => {
    if (y < tipY || y > baseY) return false;
    return Math.abs(x - sx) <= (half * (y - tipY)) / (baseY - tipY);
  };
  const rect = (x, y, x0, x1, y0, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const off = f(0.185);
  const sh = f(0.04);
  const inTrident = (x, y) =>
    spike(x, y, cx, f(0.14), f(0.44), f(0.055)) ||
    spike(x, y, cx - off, f(0.22), f(0.44), f(0.052)) ||
    spike(x, y, cx + off, f(0.22), f(0.44), f(0.052)) ||
    rect(x, y, cx - f(0.235), cx + f(0.235), f(0.42), f(0.485)) ||
    rect(x, y, cx - sh, cx + sh, f(0.485), f(0.8)) ||
    rect(x, y, cx - f(0.1), cx + f(0.1), f(0.8), f(0.855));
  const raw = Buffer.alloc((S * 4 + 1) * S);
  let p = 0;
  for (let y = 0; y < S; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < S; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const col = !inHex(px, py) ? CLEAR : inTrident(px, py) ? GOLD : NAVY;
      raw[p++] = col[0];
      raw[p++] = col[1];
      raw[p++] = col[2];
      raw[p++] = col[3];
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
