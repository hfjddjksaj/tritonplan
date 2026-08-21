#!/usr/bin/env node
/**
 * Dev-time only, network-required: builds the pedestrian routing graph the
 * campus map's Distance bar walks over, into `src/data/ucsd-walk-graph.json`.
 *
 * Same contract as fetch-campus-map.mjs: run by hand, commit the result, and
 * the page NEVER fetches any of this at runtime — the graph ships as a bundled
 * static JSON, like the campus geometry and the glyphs. Rerun and commit when
 * the campus path network changes:
 *   npm run fetch:walk-graph -w @triton/web
 *
 * ⚠ The query includes campus SERVICE/RESIDENTIAL roads, not just footways.
 * Measured 2026-08-21: footways alone fragment into 53 components (89.4% in
 * the largest, 16.6% of building pairs unroutable); adding campus roads gives
 * 39 components, 95.0% in the largest, 3.6% failure — and 0.00% between
 * teaching buildings. UCSD tags a lot of walkable campus lanes `service`.
 *
 * Elevation is sampled from the terrarium tiles fetch-terrain.mjs already put
 * on disk under `public/map/terrain/` — this script downloads no tiles of its
 * own, so the only network traffic it makes is the one Overpass query.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const BBOX = '32.868,-117.247,32.894,-117.225';   // same WALK_BBOX as fetch-campus-map.mjs
/**
 * Coordinate quantisation, matching geo-encode.mjs's GEO_SCALE: a 1e6 integer
 * grid is ~0.11 m, far finer than anything routing can resolve, and delta
 * encoding turns it into one- or two-digit numbers. Drop to 1e5 (~1.1 m, still
 * well under the 8 m DEM) if the gzipped payload ever grows past ~100 KB.
 */
const SCALE = 1e6;

const FOOT = 'footway|path|steps|pedestrian|corridor|cycleway|track';
const ROAD = 'service|residential|living_street|unclassified|tertiary';

const OSM_QUERY = `[out:json][timeout:180];
(
  way["highway"~"^(${FOOT})$"](${BBOX});
  way["highway"~"^(${ROAD})$"](${BBOX});
);
out geom tags;`;

// The public Overpass instances shed load with 500s/504s; try each mirror a few
// times before giving up. This is a dev-time script — no student ever runs it.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function queryOverpass() {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass answers 406 to a bare Node fetch; it wants to know who is asking.
          'User-Agent': 'TritonPlan build script (github.com/hfjddjksaj/tritonplan)',
        },
        body: 'data=' + encodeURIComponent(OSM_QUERY),
      });
      // A shed request answers with an HTML or plain-text error page, not JSON —
      // sniffing the first byte catches that even when the status says 200.
      const text = await res.text();
      if (text[0] !== '{') throw new Error(`${res.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      console.warn(`Overpass attempt ${attempt + 1} failed (${err.message}); retrying…`);
      // Back off rather than hammering a mirror that just told us it is busy.
      await new Promise((res) => setTimeout(res, 8000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Metres between two lat/lon, flat-earth — fine over one campus. */
const M_LAT = 111_320;
const M_LON = M_LAT * Math.cos((32.881 * Math.PI) / 180);
const metres = (aLat, aLon, bLat, bLon) => Math.hypot((aLat - bLat) * M_LAT, (aLon - bLon) * M_LON);

/**
 * Node identity is the QUANTISED COORDINATE, not an OSM node id: `out geom`
 * gives geometry without ids, and OSM's shared nodes come back byte-identical
 * in every way that references them. Ways split into edges at those shared
 * points on their own.
 */
function buildGraph(elements) {
  const index = new Map();
  const lat = []; const lon = []; const adj = [];
  const nodeOf = (p) => {
    const key = `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
    let n = index.get(key);
    if (n === undefined) {
      n = lat.length;
      index.set(key, n);
      lat.push(p.lat); lon.push(p.lon); adj.push([]);
    }
    return n;
  };
  const edges = [];
  for (const w of elements) {
    if (w.type !== 'way' || !w.geometry) continue;
    const isSteps = w.tags?.highway === 'steps';
    const g = w.geometry.filter(Boolean);
    for (let i = 1; i < g.length; i++) {
      const a = nodeOf(g[i - 1]);
      const b = nodeOf(g[i]);
      if (a === b) continue;
      edges.push({ a, b, steps: isSteps });
      adj[a].push(edges.length - 1);
      adj[b].push(edges.length - 1);
    }
  }
  return { lat, lon, adj, edges };
}

/** Connected components; returns the size of the largest and the count. */
function componentStats(adj, edges) {
  const comp = new Int32Array(adj.length).fill(-1);
  let count = 0; let largest = 0;
  for (let s = 0; s < adj.length; s++) {
    if (comp[s] !== -1) continue;
    let size = 0;
    const stack = [s];
    comp[s] = count;
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (const ei of adj[u]) {
        const e = edges[ei];
        const v = e.a === u ? e.b : e.a;
        if (comp[v] === -1) { comp[v] = count; stack.push(v); }
      }
    }
    if (size > largest) largest = size;
    count++;
  }
  return { count, largest };
}

/* ---- terrarium DEM, from the tiles fetch-terrain.mjs already put on disk ---- */
const TERRAIN_DIR = fileURLToPath(new URL('../public/map/terrain/', import.meta.url));
/**
 * z14 is ~8 m/px at this latitude, and it is the deepest level on disk. Coarse
 * against a single 20 m footway, but the routing engine only reads elevation
 * for slope trend and total ascent — the smoothing bilinear sampling adds is
 * wanted, not tolerated.
 */
const DEM_ZOOM = 14;
const tileCache = new Map();

const lonToTileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToTileY = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
};

async function tile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (!tileCache.has(key)) {
    const buf = await readFile(`${TERRAIN_DIR}${z}/${x}/${y}.png`);
    tileCache.set(key, PNG.sync.read(buf));
  }
  return tileCache.get(key);
}

/** Bilinear sample of terrarium elevation: h = R*256 + G + B/256 - 32768. */
async function elevationAt(lat, lon) {
  const fx = lonToTileX(lon, DEM_ZOOM);
  const fy = latToTileY(lat, DEM_ZOOM);
  const tx = Math.floor(fx); const ty = Math.floor(fy);
  const png = await tile(DEM_ZOOM, tx, ty);
  const px = (fx - tx) * png.width - 0.5;
  const py = (fy - ty) * png.height - 0.5;
  const x0 = Math.max(0, Math.min(png.width - 1, Math.floor(px)));
  const y0 = Math.max(0, Math.min(png.height - 1, Math.floor(py)));
  const x1 = Math.min(png.width - 1, x0 + 1);
  const y1 = Math.min(png.height - 1, y0 + 1);
  const wx = Math.max(0, Math.min(1, px - x0));
  const wy = Math.max(0, Math.min(1, py - y0));
  const at = (x, y) => {
    const i = (y * png.width + x) << 2;
    return png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
  };
  return (
    at(x0, y0) * (1 - wx) * (1 - wy) + at(x1, y0) * wx * (1 - wy) +
    at(x0, y1) * (1 - wx) * wy + at(x1, y1) * wx * wy
  );
}

const deltaEncode = (values) => {
  const out = []; let prev = 0;
  for (const v of values) { out.push(v - prev); prev = v; }
  return out;
};

async function main() {
  const json = await queryOverpass();
  const g = buildGraph(json.elements);
  const stats = componentStats(g.adj, g.edges);
  const stepsCount = g.edges.filter((e) => e.steps).length;

  console.log(`nodes ${g.lat.length}  edges ${g.edges.length}`);
  console.log(`components ${stats.count}  largest ${stats.largest} (${((100 * stats.largest) / g.lat.length).toFixed(1)}%)`);
  console.log(`steps edges ${stepsCount}`);

  // Loud failure, not a silent bad graph: a fragmented source would ship a map
  // that fails to route between buildings that are plainly next to each other.
  const share = stats.largest / g.lat.length;
  if (share < 0.9) {
    console.error(`FATAL: largest component ${(100 * share).toFixed(1)}% < 90%`);
    process.exit(1);
  }
  if (stepsCount < 250 || stepsCount > 400) {
    console.error(`FATAL: steps edge count ${stepsCount} outside 250–400 — query or bbox drifted`);
    process.exit(1);
  }

  // Row-major spatial sort so the delta encoding sees small numbers. Hilbert
  // would be tighter but costs a curve mapping we have not needed yet.
  const order = [...g.lat.keys()].sort((a, b) => {
    const ra = Math.floor(g.lat[a] * 2000); const rb = Math.floor(g.lat[b] * 2000);
    return ra !== rb ? ra - rb : g.lon[a] - g.lon[b];
  });
  const rank = new Int32Array(g.lat.length);
  order.forEach((old, i) => { rank[old] = i; });

  const nodes = [];
  let px = 0; let py = 0;
  const elevs = [];
  for (const old of order) {
    const x = Math.round(g.lon[old] * SCALE);
    const y = Math.round(g.lat[old] * SCALE);
    nodes.push(x - px, y - py);
    px = x; py = y;
    elevs.push(Math.round(await elevationAt(g.lat[old], g.lon[old])));
  }

  const remapped = g.edges
    .map((e) => ({ a: Math.min(rank[e.a], rank[e.b]), b: Math.max(rank[e.a], rank[e.b]), steps: e.steps }))
    .sort((m, n) => (m.a !== n.a ? m.a - n.a : m.b - n.b));

  const edgeFlat = [];
  let pa = 0;
  for (const e of remapped) { edgeFlat.push(e.a - pa, e.b); pa = e.a; }
  const steps = deltaEncode(remapped.map((e, i) => (e.steps ? i : -1)).filter((i) => i >= 0));

  const payload = {
    source: 'OpenStreetMap via Overpass API',
    fetched: new Date().toISOString().slice(0, 10),
    bbox: BBOX.split(',').map(Number),
    nodes,
    elev: deltaEncode(elevs),
    edges: edgeFlat,
    steps,
  };
  const text = JSON.stringify(payload);
  const out = fileURLToPath(new URL('../src/data/ucsd-walk-graph.json', import.meta.url));
  await writeFile(out, text);
  console.log(`wrote ${(text.length / 1024).toFixed(0)} KB raw, ${(gzipSync(text).length / 1024).toFixed(0)} KB gzip`);
}

main();
