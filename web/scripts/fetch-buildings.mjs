#!/usr/bin/env node
/**
 * Dev-time only: regenerate web/src/data/ucsd-buildings.json from UCSD's
 * official campus-map GIS layer (the data source behind the university's
 * public ArcGIS campus map). The planner never fetches this at runtime —
 * the JSON is bundled statically. Rerun (needs network) and commit when
 * campus buildings change:  npm run fetch:buildings -w @triton/web
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const LAYER =
  'https://admin-enterprise-gis.ucsd.edu/server/rest/services/AdministrationServices/Buildings_Public/MapServer/0';
const QUERY =
  `${LAYER}/query?where=1%3D1&outFields=FacilityLongName,BuildingAliases,Latitude,Longitude` +
  '&returnGeometry=false&f=json';

const res = await fetch(QUERY);
if (!res.ok) throw new Error(`HTTP ${res.status} from ${LAYER}`);
const data = await res.json();
if (data.error) throw new Error(`ArcGIS error: ${JSON.stringify(data.error)}`);
// maxRecordCount is 2000 and the layer holds ~752 points; bail loudly if that changes.
if (data.exceededTransferLimit) throw new Error('exceededTransferLimit: implement paging');

const round5 = (n) => Math.round(n * 1e5) / 1e5;
const rows = [];
for (const feat of data.features) {
  const a = feat.attributes;
  const name = (a.FacilityLongName ?? '').trim();
  if (!name || typeof a.Latitude !== 'number' || typeof a.Longitude !== 'number') continue;
  const aliases = [
    ...new Set(
      (a.BuildingAliases ?? '')
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s && s !== name),
    ),
  ];
  rows.push([name, aliases, round5(a.Latitude), round5(a.Longitude)]);
}
rows.sort((x, y) => x[0].localeCompare(y[0]));

const out = `{
  "source": "${LAYER}",
  "fetched": "${new Date().toISOString().slice(0, 10)}",
  "buildings": [
${rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}
  ]
}
`;
const dest = fileURLToPath(new URL('../src/data/ucsd-buildings.json', import.meta.url));
await writeFile(dest, out);
console.log(`Wrote ${rows.length} buildings to ${dest}`);

/* ---------------------------------------------------------------------------
 * Campus geometry for the campus map: building footprints (layer 1 of the same
 * service) + named campus districts. Simplified and delta-encoded so the whole
 * basemap bundles at ~124 KB raw / ~39 KB gzip (roads included).
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

// Ramer–Douglas–Peucker with the tolerance expressed in metres. 1 m is far
// below one screen pixel at the scale the map draws, so this is lossless to
// the eye while cutting the vertex count by ~60%.
const M_PER_DEG_LAT = 111132;
const M_PER_DEG_LON = 93500; // 111320 * cos(32.88°)

function perpDist(p, a, b) {
  const px = (p[0] - a[0]) * M_PER_DEG_LON;
  const py = (p[1] - a[1]) * M_PER_DEG_LAT;
  const bx = (b[0] - a[0]) * M_PER_DEG_LON;
  const by = (b[1] - a[1]) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

const GEO_SCALE = 1e5;

/** [name, [ring, …]] with each ring delta-encoded from its first point. */
function encodeShape({ name, rings }) {
  return [
    name,
    rings.map((ring) => {
      const out = [];
      let px = 0;
      let py = 0;
      for (const [lon, lat] of rdp(ring, 1)) {
        const x = Math.round(lon * GEO_SCALE);
        const y = Math.round(lat * GEO_SCALE);
        out.push(x - px, y - py);
        px = x;
        py = y;
      }
      return out;
    }),
  ];
}

const footprints = (await queryPolygons(FOOTPRINTS, 'FacilityLongName')).map(encodeShape);
const districts = (await queryPolygons(DISTRICTS, 'District')).map(encodeShape);

const vertexCount = (shapes) =>
  shapes.reduce((n, [, rings]) => n + rings.reduce((m, r) => m + r.length / 2, 0), 0);
const fpVerts = vertexCount(footprints);

// Drift guard, same doctrine as ambiguousKeyCount(): if the upstream layer is
// reshaped, fail loudly here instead of shipping a mutilated basemap.
if (footprints.length < 550 || footprints.length > 700)
  throw new Error(`footprint count out of band: ${footprints.length} (expected ~609)`);
if (districts.length < 20 || districts.length > 40)
  throw new Error(`district count out of band: ${districts.length} (expected ~25)`);
if (fpVerts < 8000 || fpVerts > 16000)
  throw new Error(`footprint vertex count out of band: ${fpVerts} (expected ~10800)`);

footprints.sort((a, b) => a[0].localeCompare(b[0]));
districts.sort((a, b) => a[0].localeCompare(b[0]));

/* ---------------------------------------------------------------------------
 * Orientation layers from OpenStreetMap (Overpass API): the roads everyone
 * navigates by (N Torrey Pines Rd, Gilman Dr, La Jolla Village Dr, Voigt Dr,
 * I-5), the named campus walkways (Ridge Walk, Library Walk, Warren Mall) and
 * the coastline, so "west" reads as the Pacific. UCSD's own GIS carries only
 * the private campus roads and no coast — that is why a second source exists.
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
);
out geom tags;`;

/** OSM tags → the line kinds the renderer knows how to weight. */
function lineKind(tags) {
  if (tags.natural === 'coastline') return 'coast';
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

const ways = (osm.elements ?? [])
  .filter((e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length > 1)
  .map((e) => ({
    name: (e.tags?.name ?? '').trim(),
    kind: lineKind(e.tags ?? {}),
    pts: e.geometry.map((g) => [g.lon, g.lat]),
  }));

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
  "source": "${FOOTPRINTS} + ${DISTRICTS} + ${OVERPASS} (© OpenStreetMap contributors, ODbL)",
  "fetched": "${new Date().toISOString().slice(0, 10)}",
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
  `Wrote ${footprints.length} footprints (${fpVerts} verts) + ${districts.length} districts + ` +
    `${lines.length} OSM lines (${lineVerts} verts) to ${geoDest}`,
);
