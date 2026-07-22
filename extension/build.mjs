/**
 * Build the TritonPlan MV3 extension into ./dist with esbuild.
 *
 *   node build.mjs           one-shot build
 *   node build.mjs --watch   rebuild on change (TS entries)
 *
 * Content scripts are bundled as self-contained IIFEs (no import/export — Chrome loads
 * them as classic scripts). The background service worker is bundled as an ES module
 * (manifest declares `"type": "module"`). Static files (manifest, popup.html) are copied
 * and simple placeholder PNG icons are generated with no network access.
 *
 * TODO(prod): the planner origin is hardcoded to http://localhost:5173 in manifest.json
 * (content_scripts + host_permissions) and src/config.ts. Update BOTH for the real
 * deployed planner domain before publishing — see docs/deployment.md.
 */

import * as esbuild from 'esbuild';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

const SHARED_ENTRY = resolve(root, '../shared/src/index.ts');

/** Options common to every esbuild call. */
const common = {
  bundle: true,
  target: 'chrome110',
  platform: 'browser',
  sourcemap: true,
  logLevel: 'info',
  alias: { '@triton/shared': SHARED_ENTRY },
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
  const bg = [0x1a, 0x4b, 0x8c, 0xff]; // brand blue
  const fg = [0xff, 0xff, 0xff, 0xff]; // white "+"
  const margin = Math.round(size * 0.24);
  const half = Math.max(1, Math.round(size * 0.09));
  const c = size / 2;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const vBar = Math.abs(x - c) <= half && y >= margin && y < size - margin;
      const hBar = Math.abs(y - c) <= half && x >= margin && x < size - margin;
      const col = vBar || hBar ? fg : bg;
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

function copyStatic() {
  mkdirSync(dist, { recursive: true });
  mkdirSync(resolve(dist, 'icons'), { recursive: true });
  copyFileSync(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));
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
    console.log('[tritonplan] build complete → extension/dist');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
