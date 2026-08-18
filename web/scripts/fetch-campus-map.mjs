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
import { rdp, encodeRing, encodeShape, vertexCount, queryAll, GEO_SCALE, pointInRing, centroid, centroidInsideAny } from './geo-encode.mjs';

const today = new Date().toISOString().slice(0, 10);

/* ---------------------------------------------------------------------------
 * Building footprints (layer 1 of UCSD's Buildings_Public service) + named
 * campus districts. RDP-simplified at 0.25 m (explicit at every call site in
 * this file, see the comment above `footprintsRaw` below) and delta-encoded
 * at GEO_SCALE (~0.11 m) — the user's own precision/payload trade-off: the
 * map draws to z19, where 1 screen pixel is ≈ 0.25 m, so the combined
 * worst-case deviation (≈ 0.3 m, see geo-encode.mjs) stays under 1.2 px,
 * comfortably below where the original 1 m tolerance visibly bevelled
 * corners and collapsed narrow wings.
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

// No `maxAllowableOffset` (that was 0.000005° ≈ 0.55 m of server-side
// generalisation) and `geometryPrecision: '7'` instead of '6': the raw layer
// returns ~7419 rings where the generalised query returned ~5066.
const groundFeats = await queryAll(GROUND, { ...envelope, outFields: 'Type', returnGeometry: 'true', geometryPrecision: '7' });
const groundTypes = [...new Set(groundFeats.map((f) => (f.attributes.Type ?? '').trim()))].filter((t) => t && !GROUND_SKIP.has(t)).sort();

// Fix — one building geometry, not two: the ground layer's own `Building`
// polygons are the same buildings the footprints layer already carries,
// surveyed twice through different generalisation pipelines (outlines
// disagree by 1–2 m). Both get painted the identical grey, but only the
// footprint gets a visible outline, so the ground duplicate bleeds out from
// under it and fills the gap between neighbouring buildings. Drop a ground
// `Building` polygon only when its centroid actually falls inside a
// footprint ring — the ~34 that don't (real structures the footprint layer
// is missing) survive as the only ground `Building` polygons left.
const isDuplicateGroundBuilding = (f) => {
  if ((f.attributes.Type ?? '').trim() !== 'Building') return false;
  const ring = f.geometry?.rings?.[0];
  if (!ring || ring.length < 3) return false;
  return centroidInsideAny(ring, rawFootprints);
};
// Evaluated once per feature (not once per filter) — the predicate does a
// point-in-polygon scan over every footprint, not free to run twice.
const groundIsDup = groundFeats.map(isDuplicateGroundBuilding);
const groundDupesCount = groundIsDup.filter(Boolean).length;
const dedupedGroundFeats = groundFeats.filter((_, i) => !groundIsDup[i]);
const survivingGroundBuildings = dedupedGroundFeats.filter((f) => (f.attributes.Type ?? '').trim() === 'Building').length;

// encodeRing drops a ring that quantised down to fewer than 3 distinct
// vertices (`[]`); filter those out ring-by-ring, then drop any ground
// polygon whose rings all degenerated (nothing left to draw). A ring dropped
// out of a polygon that keeps other rings used to be silent — see the
// ring-drop guard below (with the footprint/district equivalents) for why
// that matters and what counts it into `droppedGroundRings`.
const groundEncoded = dedupedGroundFeats
  .filter((f) => f.geometry?.rings?.length && groundTypes.includes((f.attributes.Type ?? '').trim()))
  .map((f) => ({
    entry: [groundTypes.indexOf(f.attributes.Type.trim()), f.geometry.rings.map((r) => encodeRing(r, 0.25)).filter((r) => r.length > 0)],
    rawRingCount: f.geometry.rings.length,
  }));
const ground = groundEncoded.filter((g) => g.entry[1].length > 0).map((g) => g.entry);
const droppedGroundRings = groundEncoded.reduce(
  (n, g) => (g.entry[1].length > 0 ? n + (g.rawRingCount - g.entry[1].length) : n),
  0,
);

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
// pointInRing / centroid are imported from geo-encode.mjs (shared with the
// ground-Building dedup above) rather than redefined here.
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

// 0.25 passed explicitly (matching every other encodeRing/encodeShape call
// site below) even though it equals encodeRing's own default — so a future
// change to that default can't silently move footprints/districts without
// also touching this file.
const footprintsRaw = rawFootprints.map((s) => {
  const h = heightFor(s.rings) ?? HEIGHT_OVERRIDES[s.name] ?? null;
  const e = encodeShape(s, 0.25);
  return h && h >= 3 && h <= 120 ? [...e, h] : e;
});
const districtsRaw = rawDistricts.map((s) => encodeShape(s, 0.25));

// encodeShape drops a ring that quantised to fewer than 3 distinct vertices
// after RDP. Round 1 assumed a real building/district is always far bigger
// than the tolerance and threw on this — wrong: live-verified, "Torrey
// Pines Center North Parking" is a genuine, named ArcGIS record whose only
// ring is 3 points spanning ~0.15 m, smaller than a single GEO_SCALE cell
// even before RDP touches it. That is a data-digitisation glitch, not
// something worth rendering at any zoom, so it is dropped (and logged) the
// same way a degenerate ground/landuse ring already is. A cap still fails
// loudly if a real upstream break (a reshaped layer, a broken query) starts
// dropping many shapes at once, rather than silently shipping a mutilated
// basemap.
const droppedFootprints = footprintsRaw.filter((f) => f[1].length === 0).map((f) => f[0]);
const footprints = footprintsRaw.filter((f) => f[1].length > 0);
const droppedDistricts = districtsRaw.filter((d) => d[1].length === 0).map((d) => d[0]);
const districts = districtsRaw.filter((d) => d[1].length > 0);
if (droppedFootprints.length > 5)
  throw new Error(`too many degenerate footprints (${droppedFootprints.length}): ${droppedFootprints.join(', ')}`);
if (droppedDistricts.length > 2)
  throw new Error(`too many degenerate districts (${droppedDistricts.length}): ${droppedDistricts.join(', ')}`);
if (droppedFootprints.length || droppedDistricts.length)
  console.log(
    `Dropped ${droppedFootprints.length} degenerate footprint(s) [${droppedFootprints.join(', ')}] and ` +
      `${droppedDistricts.length} degenerate district(s) [${droppedDistricts.join(', ')}] — too small to render after RDP+quantisation.`,
  );

// A ring dropped from a shape/polygon that still has other rings left is a
// DIFFERENT failure mode from the whole-shape drops just above: an inner
// ring is a hole (a courtyard), not a sliver of a lone building. Today every
// such drop is a sub-0.25 m sliver ring, so nothing renders wrong — but if
// an upstream change ever shaped a real hollow building, its hole would
// vanish into a filled polygon with nothing logged and nothing to fail on.
// Counted across footprints, districts and ground (`droppedGroundRings`,
// computed above) — the only three collections where a shape can carry more
// than one ring and so survive losing one. Landuse and the campus boundary
// are each encoded as exactly one ring per shape, so a degenerate ring there
// is definitionally a whole-shape drop already; OSM lines have no rings at
// all. Capped the same way the whole-shape drops above are.
const ringDropsIn = (raws, encoded) =>
  raws.reduce((n, s, i) => (encoded[i][1].length > 0 ? n + (s.rings.length - encoded[i][1].length) : n), 0);
const droppedFootprintRings = ringDropsIn(rawFootprints, footprintsRaw);
const droppedDistrictRings = ringDropsIn(rawDistricts, districtsRaw);
const droppedRings = droppedFootprintRings + droppedDistrictRings + droppedGroundRings;
// Drift guard: printed at ~489 this run (1 footprint + 1 district + ~486
// ground rings), ±30% per this file's usual band convention.
if (droppedRings > 636)
  throw new Error(`too many degenerate rings dropped from surviving shapes/polygons (${droppedRings}, expected ~489)`);
if (droppedRings)
  console.log(
    `Dropped ${droppedRings} degenerate ring(s) from otherwise-surviving shapes/polygons ` +
      `(footprints: ${droppedFootprintRings}, districts: ${droppedDistrictRings}, ground: ${droppedGroundRings}) — ` +
      `too small to render after RDP+quantisation (an inner ring here would be a hole, not a sliver).`,
  );

const fpVerts = vertexCount(footprints);

// Drift guard, same doctrine as ambiguousKeyCount(): if the upstream layer is
// reshaped, fail loudly here instead of shipping a mutilated basemap.
if (footprints.length < 550 || footprints.length > 700)
  throw new Error(`footprint count out of band: ${footprints.length} (expected ~608)`);
if (districts.length < 20 || districts.length > 40)
  throw new Error(`district count out of band: ${districts.length} (expected ~25)`);
// RDP simplification is back (epsM 0.25, the user's precision/
// payload trade-off) — this fell from ~26202 (round 1's eps-0 figure) to
// ~15090. ±30% band per the drift-guard doctrine above.
if (fpVerts < 10560 || fpVerts > 19620)
  throw new Error(`footprint vertex count out of band: ${fpVerts} (expected ~15090)`);

const named = new Map(rawFootprints.map((s) => [s.name, s]));
const tiogaH = heightFor(named.get('Tioga Hall').rings);
if (!(tiogaH >= 30 && tiogaH <= 50)) throw new Error(`Tioga Hall height off (${tiogaH} m)`);
const withHeight = footprints.filter((f) => f.length === 3).length;
if (withHeight < 350) throw new Error(`only ${withHeight} footprints got a height (expected ~450+)`);
// For the controller to judge whether any other landmark needs a HEIGHT_OVERRIDES entry.
const missingHeight = footprints.filter((f) => f.length === 2).map((f) => f[0]).sort();
// RDP at the default 0.25 m also occasionally pushes a small ground sliver
// below the encodeRing degenerate-ring threshold (dropped, same as always).
// This landed at ~4390 (was ~4644 at eps 0) — ±30% band.
if (ground.length < 3070 || ground.length > 5710)
  throw new Error(`ground polygon count out of band: ${ground.length} (expected ~4390)`);
if (trees.length / 3 < 2000 || trees.length / 3 > 4000) throw new Error(`tree count out of band: ${trees.length / 3}`);
// The footprint layer has 609 buildings; the ground layer's own `Building`
// polygons duplicate almost all of them (a second survey, disagreeing by
// 1-2 m) — measured 33 orphans with no matching footprint, ±30% band.
if (survivingGroundBuildings < 23 || survivingGroundBuildings > 43)
  throw new Error(`ground-Building survivor count out of band: ${survivingGroundBuildings} (expected ~33, i.e. real structures the footprint layer is missing)`);
console.log(`Ground-Building dedup: dropped ${groundDupesCount} duplicates of a footprint, kept ${survivingGroundBuildings} orphans (of ${groundFeats.filter((f) => (f.attributes.Type ?? '').trim() === 'Building').length} raw ground Building polygons).`);

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
  .map((w) => [landuseKind(w.tags), [encodeRing(w.pts, 0.25)]])
  .filter(([, rings]) => rings[0].length > 0); // encodeRing() returns [] for a ring that quantised away
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
  .map((l) => encodeLine(l, 0.25))
  .filter(([, , w]) => w.length >= 4)
  .sort((a, b) => KIND_ORDER[a[1]] - KIND_ORDER[b[1]] || a[0].localeCompare(b[0]));

const lineVerts = lines.reduce((n, [, , w]) => n + w.length / 2, 0);
const coastCount = lines.filter(([, k]) => k === 'coast').length;
if (lines.length < 150 || lines.length > 900)
  throw new Error(`OSM line count out of band: ${lines.length} (expected ~240)`);
// encodeLine's default eps went back to 0.25 too — this fell from ~6396
// (round 1's eps-0 figure) to ~4447. ±30% band.
if (lineVerts < 3110 || lineVerts > 5780)
  throw new Error(`OSM vertex count out of band: ${lineVerts} (expected ~4447)`);
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
 * RDP-simplified at the default 0.25 m (geo-encode.mjs) — the branch briefly
 * shipped `eps 0` (fully lossless) after the original 1 m tolerance produced
 * visible bevels, but that traded away more payload than the user wanted for
 * a ~1.5 s map-open cost; 0.25 m is their own considered choice, landing the
 * combined worst-case deviation at ≈ 0.3 m ≈ 1.2 px at z19 — still under a
 * pixel and a half. Do not push the tolerance higher, or drop ground types,
 * to shrink the file further without asking; equally, do not quietly revert
 * to `eps 0` "to be safe" — 0.25 m *is* the considered answer. The console
 * line below just reports the size — it is not a pass/fail budget.
 * ------------------------------------------------------------------------- */

const encodedBoundary = encodeRing(mainRing, 0.25);
// The whole La Jolla campus outline degenerating to `[]` (encodeRing's
// too-few-distinct-vertices signal) would mean the boundary query returned
// garbage — fail loudly rather than ship a map with no campus outline.
if (encodedBoundary.length === 0) throw new Error('campus boundary ring collapsed to nothing after encoding');
const mapOut = { source: `${CAMPUS_MAP} (layers 21, 24, 15) + ${BUILDINGS_3D} + OpenStreetMap (© OpenStreetMap contributors, ODbL)`, fetched: today, groundTypes, ground, trees, boundary: [encodedBoundary], landuse };
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
console.log(`  ${mapBytes} bytes / ${mapGzip} bytes gzipped`);
