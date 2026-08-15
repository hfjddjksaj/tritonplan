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
 * basemap bundles at ~82 KB raw / ~26 KB gzip.
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

const geo = `{
  "source": "${FOOTPRINTS} + ${DISTRICTS}",
  "fetched": "${new Date().toISOString().slice(0, 10)}",
  "footprints": [
${footprints.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}
  ],
  "districts": [
${districts.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}
  ]
}
`;
const geoDest = fileURLToPath(new URL('../src/data/ucsd-campus-geo.json', import.meta.url));
await writeFile(geoDest, geo);
console.log(
  `Wrote ${footprints.length} footprints (${fpVerts} verts) + ${districts.length} districts to ${geoDest}`,
);
