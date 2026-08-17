#!/usr/bin/env node
/**
 * Dev-time only: regenerate web/src/data/ucsd-buildings.json from UCSD's
 * official campus-map GIS layer (the data source behind the university's
 * public ArcGIS campus map). The planner never fetches this at runtime —
 * the JSON is bundled statically. Rerun (needs network) and commit when
 * campus buildings change:  npm run fetch:buildings -w @triton/web
 *
 * Campus geometry for the campus map (footprints, districts, roads, ground
 * surfaces, trees, boundary, land use) lives in `fetch-campus-map.mjs`.
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
