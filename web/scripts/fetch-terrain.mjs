#!/usr/bin/env node
/**
 * Dev-time only, network-required: downloads the elevation tiles the campus map
 * shades its relief from, into `web/public/map/terrain/{z}/{x}/{y}.png`.
 *
 * Why tiles on disk rather than a DEM service at runtime: the same rule the rest
 * of this map lives by — the planner issues no request off its own origin, ever.
 * MapLibre wants a `raster-dem` source, so the source has to be tiles; bundling
 * them keeps the map a static asset like the glyphs and the geometry JSONs.
 *
 * Terrarium encoding (elevation = R*256 + G + B/256 − 32768 metres), which is
 * what MapLibre's `encoding: 'terrarium'` reads. USGS-derived, served from
 * Mapzen's tile set on AWS Open Data — public domain / CC-BY depending on the
 * contributing source, credited in the README this writes and in the map's own
 * attribution line.
 *
 * Zooms 13–14 only, and deliberately: the map's home view sits near z15 and its
 * `CAMERA.maxZoom` is 19, but a DEM is not drawn — it is sampled, for hillshade
 * and for 3D terrain, where one sample per ~5–10 m is already finer than the
 * canyon shapes it has to render. MapLibre overzooms the deepest level it has,
 * so z14 covers everything above it at no cost in bytes. Going to z15 would
 * quadruple the payload for shading nobody can see.
 *
 * Rerun (needs network) and commit only when the covered area changes:
 *   npm run fetch:terrain -w @triton/web
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Mapzen/AWS Open Data terrarium tiles (USGS-derived). */
const SOURCE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/**
 * The box to cover, and why it is bigger than campus: hillshade and terrain are
 * sampled from tiles the camera can see PAST the edges of the framed core, and
 * a DEM that stops where the buildings stop puts a visible cliff at the seam.
 * ~12 × 11 km around the whole campus, which is 58 tiles at z13–14.
 */
const BOUNDS = { west: -117.3, south: 32.83, east: -117.17, north: 32.93 };
const ZOOMS = [13, 14];

/** Web Mercator tile indices — the same formula `map-style.ts` documents. */
const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

const outDir = fileURLToPath(new URL('../public/map/terrain/', import.meta.url));
const today = new Date().toISOString().slice(0, 10);

/** Every tile in `BOUNDS` at every zoom, in a flat list. */
function tileList() {
  const out = [];
  for (const z of ZOOMS) {
    const x0 = lonToX(BOUNDS.west, z);
    const x1 = lonToX(BOUNDS.east, z);
    const y0 = latToY(BOUNDS.north, z);
    const y1 = latToY(BOUNDS.south, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  }
  return out;
}

/**
 * One tile, with retries. A half-written PNG is worse than a missing one — the
 * map would decode garbage elevations into spikes — so the bytes are only
 * written after a 200 with a plausible PNG signature.
 */
async function fetchTile({ z, x, y }, attempt = 1) {
  const url = SOURCE.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      throw new Error(`not a PNG (${buf.length} bytes)`);
    }
    await mkdir(`${outDir}${z}/${x}`, { recursive: true });
    await writeFile(`${outDir}${z}/${x}/${y}.png`, buf);
    return buf.length;
  } catch (err) {
    if (attempt >= 4) throw new Error(`${z}/${x}/${y}: ${err instanceof Error ? err.message : err}`);
    await new Promise((r) => setTimeout(r, 400 * attempt));
    return fetchTile({ z, x, y }, attempt + 1);
  }
}

/** Six at a time: polite to a public bucket, and fast enough for 58 tiles. */
async function fetchAll(tiles, workers = 6) {
  let next = 0;
  let bytes = 0;
  const run = async () => {
    while (next < tiles.length) {
      const tile = tiles[next++];
      // NOT `bytes += await …`: that reads `bytes` before awaiting, so six
      // workers all add to the same stale total and the count comes out an
      // order of magnitude low (0.39 MB reported for 4.2 MB on disk).
      const size = await fetchTile(tile);
      bytes += size;
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, tiles.length) }, run));
  return bytes;
}

const tiles = tileList();
const bytes = await fetchAll(tiles);
const byZoom = ZOOMS.map((z) => `${z}: ${tiles.filter((t) => t.z === z).length}`).join(', ');

await writeFile(
  `${outDir}README.md`,
  `# Campus terrain tiles

Elevation tiles the campus map shades from — hillshade in 2D, real terrain under
the buildings in 3D. **Generated, not hand-edited:** rerun
\`npm run fetch:terrain -w @triton/web\` (needs network) and commit the result.

| | |
| --- | --- |
| Source | \`${SOURCE}\` (Mapzen terrarium tiles on AWS Open Data, USGS-derived) |
| Licence | Public domain / CC-BY by contributing source — see https://github.com/tilezen/joerd/blob/master/docs/attribution.md |
| Fetched | ${today} |
| Encoding | terrarium (elevation m = R × 256 + G + B ÷ 256 − 32768) |
| Bounds | ${BOUNDS.west}, ${BOUNDS.south} → ${BOUNDS.east}, ${BOUNDS.north} (lon/lat) |
| Zooms | ${byZoom} |
| Tiles | ${tiles.length}, ${(bytes / 1024 / 1024).toFixed(2)} MB |

The planner never fetches elevation at runtime: these files ship with the site
and are served from its own origin, like the map glyphs and the campus geometry.
MapLibre overzooms the deepest level available, so z14 also covers z15–19.
`,
  'utf8',
);

console.log(
  `fetch:terrain — ${tiles.length} tiles (${byZoom}), ${(bytes / 1024 / 1024).toFixed(2)} MB → web/public/map/terrain/`,
);
