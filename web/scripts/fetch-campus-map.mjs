#!/usr/bin/env node
/**
 * Dev-time only, network-required: regenerates both campus-map bundles —
 * `web/src/data/ucsd-campus-geo.json` (building footprints + heights, named
 * districts, orientation lines) and `web/src/data/ucsd-campus-map.json`
 * (ground surfaces, trees, campus boundary, OSM land use). Heights are joined
 * onto footprints here, so the two files are always produced together. The
 * planner never fetches any of this at runtime — both JSONs are bundled
 * statically. Rerun (needs network) and commit when campus geometry, ground
 * surfaces, trees or building heights change:
 *   npm run fetch:campus-map -w @triton/web
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { rdp, encodeRing, encodeShape, vertexCount, queryAll, GEO_SCALE } from './geo-encode.mjs';

const today = new Date().toISOString().slice(0, 10);

/* ---------------------------------------------------------------------------
 * Building footprints (layer 1 of UCSD's Buildings_Public service) + named
 * campus districts. Simplified and delta-encoded so the whole basemap bundles
 * small (roads included).
 * ------------------------------------------------------------------------- */

const FOOTPRINTS =
  'https://admin-enterprise-gis.ucsd.edu/server/rest/services/AdministrationServices/Buildings_Public/MapServer/1';
const DISTRICTS =
  'https://admin-enterprise-gis.ucsd.edu/server/rest/services/AdministrationServices/Areas_and_Boundaries/MapServer/4';

async function queryPolygons(layer, nameField) {
  const url =
    `${layer}/query?where=1%3D1&outFields=${nameField}` +
    '&returnGeometry=true&outSR=4326&f=json';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${layer}`);
  const j = await r.json();
  if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error)}`);
  if (j.exceededTransferLimit) throw new Error(`exceededTransferLimit on ${layer}`);
  return j.features
    .filter((f) => f.geometry?.rings?.length)
    .map((f) => ({ name: (f.attributes[nameField] ?? '').trim(), rings: f.geometry.rings }));
}

const rawFootprints = await queryPolygons(FOOTPRINTS, 'FacilityLongName');
const rawDistricts = await queryPolygons(DISTRICTS, 'District');

/* ---- UCSD's own campus basemap layers (the data behind maps.ucsd.edu's campus tiles) ---- */
const CAMPUS_MAP = 'https://admin-enterprise-gis.ucsd.edu/server/rest/services/BaseData/Campus_Map_Vector/MapServer';
const GROUND = `${CAMPUS_MAP}/21`;   // Ground Level Basemap: 26 surface types
const TREES = `${CAMPUS_MAP}/24`;    // tree points, height in feet
const BOUNDARY = `${CAMPUS_MAP}/15`; // campus boundary polygon(s)
const BUILDINGS_3D = 'https://services9.arcgis.com/mXNwDpiENQiMIzRv/arcgis/rest/services/Campus_Buildings_3D_Object/FeatureServer/0';

// Curbs and gutters only appear at z ≥ 18 in the official style — 15k vertices we never draw.
const GROUND_SKIP = new Set(['Curb', 'Curb Hydrant', 'Curb Passenger Loading Zone', 'Curb Shuttle Stop', 'Gutter']);

const boundaryFeats = await queryAll(BOUNDARY, { outFields: 'OBJECTID', returnGeometry: 'true' });
const boundaryRings = boundaryFeats.flatMap((f) => f.geometry?.rings ?? []);
if (boundaryRings.length === 0) throw new Error('no campus boundary ring');
// The main La Jolla campus is the ring with the largest area (Hillcrest and the outliers are small).
const ringAreaDeg = (r) => Math.abs(r.reduce((a, [x, y], i, arr) => { const [nx, ny] = arr[(i + 1) % arr.length]; return a + x * ny - nx * y; }, 0) / 2);
const mainRing = boundaryRings.slice().sort((a, b) => ringAreaDeg(b) - ringAreaDeg(a))[0];
const bbox = mainRing.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
const envelope = { geometry: bbox.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };

const groundFeats = await queryAll(GROUND, { ...envelope, outFields: 'Type', returnGeometry: 'true', geometryPrecision: '6', maxAllowableOffset: '0.000005' });
const groundTypes = [...new Set(groundFeats.map((f) => (f.attributes.Type ?? '').trim()))].filter((t) => t && !GROUND_SKIP.has(t)).sort();
const ground = groundFeats
  .filter((f) => f.geometry?.rings?.length && groundTypes.includes((f.attributes.Type ?? '').trim()))
  .map((f) => [groundTypes.indexOf(f.attributes.Type.trim()), f.geometry.rings.map((r) => encodeRing(r, 0.75))]);

const treeFeats = await queryAll(TREES, { ...envelope, outFields: 'height', returnGeometry: 'true', geometryPrecision: '6' });
// Official height buckets (feet): 4–15, 15–27, 27–38, 38–60, 60–132.
const treeClass = (ft) => (ft < 15 ? 0 : ft < 27 ? 1 : ft < 38 ? 2 : ft < 60 ? 3 : 4);
const trees = [];
{ let px = 0, py = 0;
  for (const f of treeFeats) {
    if (!f.geometry) continue;
    const x = Math.round(f.geometry.x * GEO_SCALE), y = Math.round(f.geometry.y * GEO_SCALE);
    trees.push(x - px, y - py, treeClass(Number(f.attributes.height) || 20)); px = x; py = y;
  } }

/* ---- building heights from the 3D building objects (z is absolute feet) ---- */
const b3d = await queryAll(BUILDINGS_3D, { outFields: 'OBJECTID', returnGeometry: 'true', returnZ: 'true' });
const b3dFoot = await queryAll(BUILDINGS_3D, { outFields: 'OBJECTID', returnGeometry: 'true', multipatchOption: 'xyFootprint' });
const heightById = new Map();
for (const f of b3d) {
  const zs = (f.geometry?.rings ?? []).flat().map((p) => p[2]).filter((z) => typeof z === 'number');
  if (zs.length) heightById.set(f.attributes.OBJECTID, Math.round((Math.max(...zs) - Math.min(...zs)) * 0.3048));
}
const pointInRing = (x, y, ring) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };
const centroid = (ring) => ring.reduce((a, [x, y]) => [a[0] + x / ring.length, a[1] + y / ring.length], [0, 0]);
function heightFor(footprintRings) {
  const [cx, cy] = centroid(footprintRings[0]);
  for (const f of b3dFoot) if ((f.geometry?.rings ?? []).some((r) => pointInRing(cx, cy, r))) return heightById.get(f.attributes.OBJECTID) ?? null;
  return null;
}

// The extrusion layer omits buildings the official campus scene renders as a
// separate detailed mesh instead of a boxy extrusion — confirmed live: the
// BUILDINGS_3D layer returns no feature anywhere near Geisel's footprint
// centroid (nearest candidate is a different building, 139 m away), and OSM
// carries no height for it either. Overrides apply only when the 3D join
// found nothing (see `?? HEIGHT_OVERRIDES[...]` below); a footprint with a
// real 3D height is never replaced.
const HEIGHT_OVERRIDES = { 'Geisel Library': 34 }; // the extrusion layer omits buildings the official scene renders as detailed meshes; ≈8 storeys — measured value, not from the data

const footprints = rawFootprints.map((s) => {
  const h = heightFor(s.rings) ?? HEIGHT_OVERRIDES[s.name] ?? null;
  const e = encodeShape(s);
  return h && h >= 3 && h <= 120 ? [...e, h] : e;
});
const districts = rawDistricts.map((s) => encodeShape(s));

const fpVerts = vertexCount(footprints);

// Drift guard, same doctrine as ambiguousKeyCount(): if the upstream layer is
// reshaped, fail loudly here instead of shipping a mutilated basemap.
if (footprints.length < 550 || footprints.length > 700)
  throw new Error(`footprint count out of band: ${footprints.length} (expected ~609)`);
if (districts.length < 20 || districts.length > 40)
  throw new Error(`district count out of band: ${districts.length} (expected ~25)`);
if (fpVerts < 8000 || fpVerts > 16000)
  throw new Error(`footprint vertex count out of band: ${fpVerts} (expected ~10800)`);

const named = new Map(rawFootprints.map((s) => [s.name, s]));
const tiogaH = heightFor(named.get('Tioga Hall').rings);
if (!(tiogaH >= 30 && tiogaH <= 50)) throw new Error(`Tioga Hall height off (${tiogaH} m)`);
const withHeight = footprints.filter((f) => f.length === 3).length;
if (withHeight < 350) throw new Error(`only ${withHeight} footprints got a height (expected ~450+)`);
// For the controller to judge whether any other landmark needs a HEIGHT_OVERRIDES entry.
const missingHeight = footprints.filter((f) => f.length === 2).map((f) => f[0]).sort();
// Band widened from the spec's 8000–14000 estimate: the live envelope-clipped
// query (after dropping GROUND_SKIP curb/gutter types) returns ~5066 features,
// not ~11000 — observed value ±25%, per the drift-guard doctrine (not a spec).
if (ground.length < 3800 || ground.length > 6400) throw new Error(`ground polygon count out of band: ${ground.length}`);
if (trees.length / 3 < 2000 || trees.length / 3 > 4000) throw new Error(`tree count out of band: ${trees.length / 3}`);

footprints.sort((a, b) => a[0].localeCompare(b[0]));
districts.sort((a, b) => a[0].localeCompare(b[0]));

/* ---------------------------------------------------------------------------
 * Orientation layers from OpenStreetMap (Overpass API): the roads everyone
 * navigates by (N Torrey Pines Rd, Gilman Dr, La Jolla Village Dr, Voigt Dr,
 * I-5), the named campus walkways (Ridge Walk, Library Walk, Warren Mall) and
 * the coastline, so "west" reads as the Pacific. UCSD's own GIS carries only
 * the private campus roads and no coast — that is why a second source exists.
 * Also carries park/wood/beach land use (for ground fill under the trees and
 * along the coast) — UCSD's own ground layer (21) doesn't tag those either.
 * ODbL attribution ("© OpenStreetMap contributors") is rendered on the map.
 * ------------------------------------------------------------------------- */

const OVERPASS = 'https://overpass-api.de/api/interpreter';
// Wide enough to cover the desktop canvas zoomed out one notch (≈4.5 km square).
const ROAD_BBOX = '32.858,-117.264,32.902,-117.212';
// Minor streets only around campus: the La Jolla Shores / UTC residential
// grids are bytes and clutter, not orientation.
const MINOR_BBOX = '32.862,-117.254,32.898,-117.220';
// Walkways only inside the academic core: elsewhere they are clutter.
const WALK_BBOX = '32.868,-117.247,32.894,-117.225';
// The coast west of campus, extended south so the ocean fill closes cleanly.
const COAST_BBOX = '32.850,-117.290,32.905,-117.240';

const OSM_QUERY = `[out:json][timeout:60];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${ROAD_BBOX});
  way["highway"~"^(unclassified|residential|living_street)$"]["name"](${MINOR_BBOX});
  way["highway"~"^(pedestrian|footway|cycleway)$"]["name"](${WALK_BBOX});
  way["natural"="coastline"](${COAST_BBOX});
  way["leisure"~"^(park|golf_course)$"](${ROAD_BBOX});
  way["natural"~"^(wood|scrub|beach)$"](${ROAD_BBOX});
);
out geom tags;`;

/** OSM tags → the line kinds the renderer knows how to weight. Land-use tags
 * (park/golf_course/wood/scrub/beach) return null: they're ground fill, split
 * off into `landuse` below, and must never enter the `lines` pipeline. */
function lineKind(tags) {
  if (tags.natural === 'coastline') return 'coast';
  if (tags.leisure === 'park' || tags.leisure === 'golf_course') return null;
  if (tags.natural === 'wood' || tags.natural === 'scrub' || tags.natural === 'beach') return null;
  const h = tags.highway;
  if (h === 'motorway') return 'hwy';
  if (h === 'trunk' || h === 'primary' || h === 'secondary') return 'major';
  if (h === 'tertiary' || h === 'unclassified' || h === 'residential' || h === 'living_street')
    return 'minor';
  return 'walk';
}

// The public Overpass instances shed load with 504s; try each mirror a few
// times before giving up. This is a dev-time script — no student ever runs it.
const OVERPASS_MIRRORS = [OVERPASS, 'https://overpass.kumi.systems/api/interpreter'];
async function queryOverpass() {
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass answers 406 to a bare Node fetch; it wants to know who is asking.
          'User-Agent': 'TritonPlan build script (github.com/hfjddjksaj/tritonplan)',
        },
        body: 'data=' + encodeURIComponent(OSM_QUERY),
      });
      if (r.ok) return await r.json();
      lastErr = new Error(`HTTP ${r.status} from ${url}`);
    } catch (e) {
      lastErr = e;
    }
    console.warn(`Overpass attempt ${attempt + 1} failed (${lastErr.message}); retrying…`);
    await new Promise((res) => setTimeout(res, 8000 * (attempt + 1)));
  }
  throw lastErr;
}
const osm = await queryOverpass();
if (osm.remark) console.warn('Overpass remark:', osm.remark);

const allWays = (osm.elements ?? [])
  .filter((e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length > 1)
  .map((e) => ({
    name: (e.tags?.name ?? '').trim(),
    kind: lineKind(e.tags ?? {}),
    tags: e.tags ?? {},
    pts: e.geometry.map((g) => [g.lon, g.lat]),
  }));

// Closed ways tagged park/golf_course/wood/scrub/beach are ground-fill
// polygons, not orientation lines — split them off before the road-name
// filtering below (`lineKind` already returned null for these tags above,
// so `ways` below never contains them).
function landuseKind(tags) {
  if (tags.leisure === 'park' || tags.leisure === 'golf_course') return 'park';
  if (tags.natural === 'wood' || tags.natural === 'scrub') return 'wood';
  if (tags.natural === 'beach') return 'beach';
  return null;
}
const isClosedRing = (pts) =>
  pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
const landuse = allWays
  .filter((w) => landuseKind(w.tags) && isClosedRing(w.pts))
  .map((w) => [landuseKind(w.tags), [encodeRing(w.pts, 2)]]);
const ways = allWays.filter((w) => w.kind !== null);

// A walkway that carries a road's name is that road's sidewalk — drop it.
const roadNames = new Set(
  ways.filter((w) => w.kind !== 'walk' && w.kind !== 'coast').map((w) => w.name),
);
const kept = ways.filter((w) => !(w.kind === 'walk' && roadNames.has(w.name)));

/**
 * Join ways that share name+kind end-to-end into the longest possible
 * polylines: OSM splits "Gilman Drive" into a dozen ways, and a road label
 * needs one continuous path to sit on.
 */
function mergeWays(list) {
  const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const groups = new Map();
  for (const w of list) {
    const k = `${w.kind}|${w.name}`;
    if (!groups.has(k)) groups.set(k, { kind: w.kind, name: w.name, lines: [] });
    groups.get(k).lines.push([...w.pts]);
  }
  const out = [];
  for (const { kind, name, lines } of groups.values()) {
    let pool = lines;
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < pool.length; i++) {
        for (let j = 0; j < pool.length; j++) {
          if (i === j) continue;
          const a = pool[i];
          const b = pool[j];
          let joined = null;
          if (key(a[a.length - 1]) === key(b[0])) joined = [...a, ...b.slice(1)];
          else if (key(b[b.length - 1]) === key(a[0])) joined = [...b, ...a.slice(1)];
          else if (key(a[a.length - 1]) === key(b[b.length - 1]))
            joined = [...a, ...b.slice(0, -1).reverse()];
          else if (key(a[0]) === key(b[0])) joined = [...a.slice(1).reverse(), ...b];
          if (joined) {
            pool = pool.filter((_, idx) => idx !== i && idx !== j);
            pool.push(joined);
            merged = true;
            break outer;
          }
        }
      }
    }
    for (const pts of pool) out.push({ name, kind, pts });
  }
  return out;
}

// The coast comes back as one long chain plus a few closed rings (offshore
// rocks). Keep the chain: the renderer closes it westward into the ocean fill.
const mergedAll = mergeWays(kept);
const coastChain = mergedAll
  .filter((l) => l.kind === 'coast')
  .sort((x, y) => y.pts.length - x.pts.length)[0];
const mergedLines = mergedAll.filter((l) => l.kind !== 'coast' || l === coastChain);
if (!coastChain) throw new Error('no coastline in the OSM result');
const coastLat = coastChain.pts.map((p) => p[1]);
if (Math.max(...coastLat) - Math.min(...coastLat) < 0.04)
  throw new Error('coastline chain is too short to span the map — did the ways stop joining?');

/** [name, kind, [x0, y0, dx, dy, …]] — same integer/delta scheme as the rings. */
function encodeLine({ name, kind, pts }, eps) {
  const out = [];
  let px = 0;
  let py = 0;
  for (const [lon, lat] of rdp(pts, eps)) {
    const x = Math.round(lon * GEO_SCALE);
    const y = Math.round(lat * GEO_SCALE);
    if (out.length && x === px && y === py) continue; // rounding collapsed a step
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return [name, kind, out];
}

const KIND_ORDER = { coast: 0, hwy: 1, major: 2, minor: 3, walk: 4 };
const lines = mergedLines
  .map((l) => encodeLine(l, l.kind === 'coast' ? 3 : 1.5))
  .filter(([, , w]) => w.length >= 4)
  .sort((a, b) => KIND_ORDER[a[1]] - KIND_ORDER[b[1]] || a[0].localeCompare(b[0]));

const lineVerts = lines.reduce((n, [, , w]) => n + w.length / 2, 0);
const coastCount = lines.filter(([, k]) => k === 'coast').length;
if (lines.length < 150 || lines.length > 900)
  throw new Error(`OSM line count out of band: ${lines.length} (expected ~240)`);
if (lineVerts < 1500 || lineVerts > 12000)
  throw new Error(`OSM vertex count out of band: ${lineVerts} (expected ~2700)`);
if (coastCount !== 1)
  throw new Error(`expected exactly one coastline chain, got ${coastCount}`);
for (const must of [
  'North Torrey Pines Road',
  'Gilman Drive',
  'La Jolla Village Drive',
  'Ridge Walk',
  'Library Walk',
])
  if (!lines.some(([n]) => n === must)) throw new Error(`OSM result is missing ${must}`);

const geo = `{
  "source": "${FOOTPRINTS} + ${DISTRICTS} + ${BUILDINGS_3D} + ${OVERPASS} (© OpenStreetMap contributors, ODbL)",
  "fetched": "${today}",
  "footprints": [
${footprints.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}
  ],
  "districts": [
${districts.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}
  ],
  "lines": [
${lines.map((l) => `    ${JSON.stringify(l)}`).join(',\n')}
  ]
}
`;
const geoDest = fileURLToPath(new URL('../src/data/ucsd-campus-geo.json', import.meta.url));
await writeFile(geoDest, geo);
console.log(
  `Wrote ${footprints.length} footprints (${fpVerts} verts, ${withHeight} with height) + ` +
    `${districts.length} districts + ${lines.length} OSM lines (${lineVerts} verts) to ${geoDest}`,
);
console.log(
  `${missingHeight.length} footprints with no 3D-layer match and no HEIGHT_OVERRIDES entry:\n` +
    missingHeight.map((n) => `  - ${n}`).join('\n'),
);

/* ---------------------------------------------------------------------------
 * ucsd-campus-map.json: ground surfaces, trees, campus boundary, OSM land use.
 * Size budget: ≤ 350 KB gzipped. If this trips, first raise the ground RDP
 * tolerance in the `encodeRing(r, 0.75)` call above to 1 m, then drop the
 * `Gravel`, `Mulch` and `Rock` ground types from `groundTypes`/`ground`.
 * ------------------------------------------------------------------------- */

const mapOut = { source: `${CAMPUS_MAP} (layers 21, 24, 15) + ${BUILDINGS_3D} + OpenStreetMap (© OpenStreetMap contributors, ODbL)`, fetched: today, groundTypes, ground, trees, boundary: [encodeRing(mainRing, 1)], landuse };
const mapDest = fileURLToPath(new URL('../src/data/ucsd-campus-map.json', import.meta.url));
const mapJson = JSON.stringify(mapOut);
await writeFile(mapDest, mapJson);

const groundVerts = vertexCount(ground);
const mapBytes = Buffer.byteLength(mapJson);
const mapGzip = gzipSync(mapJson).length;
console.log(
  `Wrote ${ground.length} ground polygons (${groundVerts} verts, ${groundTypes.length} types: ${groundTypes.join(', ')}) + ` +
    `${trees.length / 3} trees + ${landuse.length} land-use polygons + boundary to ${mapDest}`,
);
console.log(
  `  ${mapBytes} bytes / ${mapGzip} bytes gzipped (budget: 358400 bytes / 350 KB gzipped)` +
    (mapGzip > 358400 ? ' — OVER BUDGET' : ''),
);
