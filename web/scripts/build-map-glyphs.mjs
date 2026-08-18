#!/usr/bin/env node
/**
 * Dev-time only, network-required: regenerates the SDF glyph PBFs MapLibre
 * needs to draw map labels — `web/public/map/fonts/Inter-Regular/{0-255,256-511}.pbf`
 * and the same two ranges under `Inter-SemiBold/`. The planner never fetches
 * any of this at runtime — the folders are bundled statically and served
 * from the page's own origin (see `glyphs` in `src/lib/map-style.ts`, whose
 * `MAP_FONT_REGULAR`/`MAP_FONT_BOLD` constants must match the two folder
 * names below, since the fontstack MapLibre requests IS the folder name).
 *
 * Route: maplibre.org/font-maker needs a browser click, which an unattended
 * script can't do. This regenerates the exact same artifact offline instead
 * — parse the TTF with opentype.js, rasterize + signed-distance-transform
 * each glyph ourselves, and hand-encode the protobuf mapbox/maplibre glyph
 * PBFs use. The SDF algorithm and every constant below (24px em, 3px buffer,
 * 0.25 cutoff, 8px search radius, the 255-n inversion, the row-flip) are
 * copied from the reference implementation font-maker/fontnik are built on:
 * mapbox/sdf-glyph-foundry's `RenderSDF()` (the C++ core, normally driven
 * via FreeType). PBF field layout is the `glyphs.proto` schema mapbox-gl and
 * maplibre-gl read (fontstacks -> glyphs), verified against maplibre-gl-js's
 * own `parse_glyph_pbf.ts` reader. See `public/map/fonts/README.md` for the
 * full route writeup.
 *
 * Rerun (needs network) and commit when the Inter version bumps:
 *   npm run build:map-glyphs -w @triton/web
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import opentype from 'opentype.js';
import { PbfWriter } from 'pbf';

const INTER_VERSION = '4.1';
const INTER_ZIP_URL = `https://github.com/rsms/inter/releases/download/v${INTER_VERSION}/Inter-${INTER_VERSION}.zip`;

// fontstack folder name == MAP_FONT_REGULAR / MAP_FONT_BOLD in map-style.ts.
const STACKS = [
  { file: 'extras/ttf/Inter-Regular.ttf', folder: 'Inter-Regular', label: 'Inter Regular' },
  { file: 'extras/ttf/Inter-SemiBold.ttf', folder: 'Inter-SemiBold', label: 'Inter SemiBold' },
];
const RANGES = [
  [0, 255],
  [256, 511],
];

// --- SDF parameters, matching mapbox/sdf-glyph-foundry's RenderSDF() exactly ---
const EM_SIZE = 24; // px — the font size fontnik renders glyphs at (FT_Set_Char_Size(24pt @ 72dpi))
const BUFFER = 3; // px — matches maplibre-gl-js's GLYPH_PBF_BORDER
const CUTOFF = 0.25;
const RADIUS = 8; // px — max SDF search distance
const RADIUS_SCALE = 256 / RADIUS;

const outDir = fileURLToPath(new URL('../public/map/fonts/', import.meta.url));

console.log(`Fetching ${INTER_ZIP_URL} ...`);
const zipRes = await fetch(INTER_ZIP_URL);
if (!zipRes.ok) throw new Error(`HTTP ${zipRes.status} fetching Inter release zip`);
const zipBuf = new Uint8Array(await zipRes.arrayBuffer());
const wanted = new Set([...STACKS.map((s) => s.file), 'LICENSE.txt']);
const entries = unzipSync(zipBuf, { filter: (f) => wanted.has(f.name) });
for (const name of wanted) if (!entries[name]) throw new Error(`Inter zip is missing ${name} — did the release layout change?`);

// Ship the OFL license text alongside the generated glyphs, as required by the license.
await mkdir(outDir, { recursive: true });
await writeFile(new URL('./OFL.txt', `file://${outDir}/`), entries['LICENSE.txt']);

/** Flatten one glyph's raw (unscaled, y-up font-unit) path commands into
 * closed pixel-space rings, replicating FreeType's FT_Outline_Decompose +
 * sdf-glyph-foundry's CloseRing/MoveTo/LineTo/ConicTo/CubicTo. */
function flattenGlyphRings(commands, scale) {
  const rings = [];
  let ring = [];
  let cur = [0, 0];
  const S = (x, y) => [x * scale, y * scale];

  const closeRing = () => {
    if (ring.length === 0) return;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };

  const quadTo = (p1, p2) => {
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      ring.push([mt * mt * cur[0] + 2 * mt * t * p1[0] + t * t * p2[0], mt * mt * cur[1] + 2 * mt * t * p1[1] + t * t * p2[1]]);
    }
    cur = p2;
  };
  const cubicTo = (p1, p2, p3) => {
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      ring.push([
        mt * mt * mt * cur[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
        mt * mt * mt * cur[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    cur = p3;
  };

  for (const cmd of commands) {
    if (cmd.type === 'M') {
      closeRing();
      cur = S(cmd.x, cmd.y);
      ring.push(cur);
    } else if (cmd.type === 'L') {
      cur = S(cmd.x, cmd.y);
      ring.push(cur);
    } else if (cmd.type === 'Q') {
      quadTo(S(cmd.x1, cmd.y1), S(cmd.x, cmd.y));
    } else if (cmd.type === 'C') {
      cubicTo(S(cmd.x1, cmd.y1), S(cmd.x2, cmd.y2), S(cmd.x, cmd.y));
    } else if (cmd.type === 'Z') {
      closeRing();
    }
  }
  closeRing();
  return rings;
}

function squaredDistToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

// Even-odd ray casting over every ring's edges together — equivalent to
// nonzero winding for the non-self-intersecting contours real glyphs have,
// same approach as sdf-glyph-foundry's PolyContainsPoint.
function pointInRings(px, py, edges) {
  let inside = false;
  for (const [ax, ay, bx, by] of edges) {
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function minDistToEdges(px, py, edges, radius) {
  const r2 = radius * radius;
  let best = Infinity;
  for (const [ax, ay, bx, by] of edges) {
    const d2 = squaredDistToSegment(px, py, ax, ay, bx, by);
    if (d2 < best && d2 < r2) best = d2;
  }
  return Math.sqrt(best);
}

/** Renders one codepoint to a {id,width,height,left,top,advance,bitmap} glyph
 * record, or null if the font has no cmap entry for it (skip, matching
 * fontnik's `if (char_index == 0) continue;`). */
function renderGlyph(font, scale, ascenderPx, codepoint) {
  const index = font.charToGlyphIndex(String.fromCodePoint(codepoint));
  if (index === 0) return null;
  const glyph = font.glyphs.get(index);
  const advance = Math.round((glyph.advanceWidth || 0) * scale);
  const rings = flattenGlyphRings(glyph.path.commands, scale);

  if (rings.length === 0) {
    // No outline (space, .null, combining marks with empty contours, …) — still
    // needs an advance-only entry so text shaping can position what follows.
    return { id: codepoint, width: 0, height: 0, left: 0, top: -ascenderPx, advance, bitmap: null };
  }

  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
  xmin = Math.round(xmin);
  ymin = Math.round(ymin);
  xmax = Math.round(xmax);
  ymax = Math.round(ymax);
  const width = xmax - xmin;
  const height = ymax - ymin;
  if (width <= 0 || height <= 0) return { id: codepoint, width: 0, height: 0, left: 0, top: -ascenderPx, advance, bitmap: null };

  const offsetRings = rings.map((ring) => ring.map(([x, y]) => [x - xmin + BUFFER, y - ymin + BUFFER]));
  const edges = [];
  for (const ring of offsetRings) for (let i = 0; i < ring.length - 1; i++) edges.push([ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]]);

  const bw = width + 2 * BUFFER;
  const bh = height + 2 * BUFFER;
  const bitmap = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const ypos = bh - y - 1; // row-flip, matches sdf-glyph-foundry
    for (let x = 0; x < bw; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let d = minDistToEdges(px, py, edges, RADIUS) * RADIUS_SCALE;
      if (pointInRings(px, py, edges)) d = -d;
      d += CUTOFF * 256;
      const n = d > 255 ? 255 : d < 0 ? 0 : d;
      bitmap[ypos * bw + x] = 255 - n;
    }
  }

  return { id: codepoint, width, height, left: xmin, top: ymax - ascenderPx, advance, bitmap };
}

function writeGlyph(g, writer) {
  writer.writeVarintField(1, g.id);
  if (g.bitmap) writer.writeBytesField(2, g.bitmap);
  writer.writeVarintField(3, g.width);
  writer.writeVarintField(4, g.height);
  writer.writeSVarintField(5, g.left);
  writer.writeSVarintField(6, g.top);
  writer.writeVarintField(7, g.advance);
}

function encodeFontstackPbf(label, range, glyphs) {
  const writer = new PbfWriter();
  writer.writeMessage(1, (fontstack, w) => {
    w.writeStringField(1, fontstack.label);
    w.writeStringField(2, fontstack.range);
    for (const g of fontstack.glyphs) w.writeMessage(3, writeGlyph, g);
  }, { label, range, glyphs });
  return writer.finish();
}

for (const stack of STACKS) {
  const ttfBuf = Buffer.from(entries[stack.file]);
  const font = opentype.parse(ttfBuf.buffer.slice(ttfBuf.byteOffset, ttfBuf.byteOffset + ttfBuf.byteLength));
  const scale = EM_SIZE / font.unitsPerEm;
  const ascenderPx = Math.round(font.ascender * scale);
  const stackDir = new URL(`${stack.folder}/`, `file://${outDir}/`);
  await mkdir(stackDir, { recursive: true });

  for (const [start, end] of RANGES) {
    const glyphs = [];
    for (let cp = start; cp <= end; cp++) {
      const g = renderGlyph(font, scale, ascenderPx, cp);
      if (g) glyphs.push(g);
    }
    const buf = encodeFontstackPbf(stack.label, `${start}-${end}`, glyphs);
    const dest = new URL(`${start}-${end}.pbf`, stackDir);
    await writeFile(dest, buf);
    const withBitmap = glyphs.filter((g) => g.bitmap).length;
    console.log(`${stack.folder}/${start}-${end}.pbf: ${glyphs.length} glyphs (${withBitmap} with ink), ${buf.length} bytes`);
  }
}

console.log(`\nDone. Wrote glyph PBFs to ${outDir} (Inter ${INTER_VERSION}, OFL — see OFL.txt).`);
