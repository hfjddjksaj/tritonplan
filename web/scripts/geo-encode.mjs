/**
 * Shared geometry helpers for the campus-map fetch scripts
 * (`fetch-buildings.mjs`, `fetch-campus-map.mjs`): Ramer–Douglas–Peucker
 * simplification, the integer/delta wire encoding both scripts' output JSON
 * uses for rings and polylines, and a paged ArcGIS query helper.
 */

// Ramer–Douglas–Peucker with the tolerance expressed in metres. 1 m is far
// below one screen pixel at the scale the map draws, so this is lossless to
// the eye while cutting the vertex count by ~60%.
export const M_PER_DEG_LAT = 111132;
export const M_PER_DEG_LON = 93500; // 111320 * cos(32.88°)

export function perpDist(p, a, b) {
  const px = (p[0] - a[0]) * M_PER_DEG_LON;
  const py = (p[1] - a[1]) * M_PER_DEG_LAT;
  const bx = (b[0] - a[0]) * M_PER_DEG_LON;
  const by = (b[1] - a[1]) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

export function rdp(pts, eps) {
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

export const GEO_SCALE = 1e5;

/** One ring → integers at GEO_SCALE, delta-encoded, after RDP at `epsM` metres. */
export function encodeRing(ring, epsM = 1) {
  const out = [];
  let px = 0, py = 0;
  for (const [lon, lat] of rdp(ring, epsM)) {
    const x = Math.round(lon * GEO_SCALE), y = Math.round(lat * GEO_SCALE);
    out.push(x - px, y - py); px = x; py = y;
  }
  return out;
}
export function encodeShape({ name, rings }, epsM = 1) { return [name, rings.map((r) => encodeRing(r, epsM))]; }
/** Total vertices of encoded shapes — rings are always at index 1 ([name|type, rings, …]). */
export function vertexCount(shapes) { return shapes.reduce((n, s) => n + s[1].reduce((m, r) => m + r.length / 2, 0), 0); }

/** Every feature of an ArcGIS layer, following resultOffset paging past maxRecordCount. */
export async function queryAll(layerUrl, params) {
  const out = [];
  for (let offset = 0; ; ) {
    const q = new URLSearchParams({ where: '1=1', outSR: '4326', f: 'json', resultRecordCount: '2000', resultOffset: String(offset), ...params });
    const r = await fetch(`${layerUrl}/query?${q}`);
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${layerUrl}`);
    const j = await r.json();
    if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error)}`);
    out.push(...j.features);
    if (!j.exceededTransferLimit || j.features.length === 0) return out;
    offset += j.features.length;
  }
}
