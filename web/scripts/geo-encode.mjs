/**
 * Shared geometry helpers for the campus-map fetch scripts
 * (`fetch-buildings.mjs`, `fetch-campus-map.mjs`): Ramer–Douglas–Peucker
 * simplification, the integer/delta wire encoding both scripts' output JSON
 * uses for rings and polylines, and a paged ArcGIS query helper.
 */

// Ramer–Douglas–Peucker with the tolerance expressed in metres. The map draws
// to CAMERA.maxZoom 19, where one screen pixel is ≈ 0.25 m at UCSD's
// latitude — the old 1 m default tolerance was ≈ 4 px, which sliced right
// angles into diagonals and collapsed narrow wings into slivers. Every
// fetch-script call site now passes `eps = 0`: the wire format carries the
// source geometry unsimplified, quantised only by GEO_SCALE's own grid
// (≈ 0.11 m — see below), which is below what a screen pixel can show even
// at z19.
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
  // eps <= 0 means "no simplification" — without this short-circuit, `maxD
  // <= eps` still fires whenever maxD is exactly 0 (collinear or duplicate
  // vertices), silently dropping real points from a supposedly lossless pass.
  if (eps <= 0) return pts;
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

// Integer quantisation grid: 1/GEO_SCALE degree ≈ 0.093 m of longitude /
// 0.111 m of latitude at UCSD's latitude — below the ≈ 0.25 m one screen
// pixel covers at the map's max zoom (19), so this is the only rounding the
// wire format applies.
export const GEO_SCALE = 1e6;

/** One ring → integers at GEO_SCALE, delta-encoded, after RDP at `epsM` metres. */
export function encodeRing(ring, epsM = 0) {
  const out = [];
  let px = 0, py = 0;
  for (const [lon, lat] of rdp(ring, epsM)) {
    const x = Math.round(lon * GEO_SCALE), y = Math.round(lat * GEO_SCALE);
    out.push(x - px, y - py); px = x; py = y;
  }
  return out;
}
export function encodeShape({ name, rings }, epsM = 0) { return [name, rings.map((r) => encodeRing(r, epsM))]; }
/** Total vertices of encoded shapes — rings are always at index 1 ([name|type, rings, …]). */
export function vertexCount(shapes) { return shapes.reduce((n, s) => n + s[1].reduce((m, r) => m + r.length / 2, 0), 0); }

/** Point-in-polygon test (ray casting), lon/lat or any consistent 2D unit. */
export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Vertex-average centroid of a single ring (good enough for containment tests, not a true area centroid). */
export function centroid(ring) {
  return ring.reduce((a, [x, y]) => [a[0] + x / ring.length, a[1] + y / ring.length], [0, 0]);
}
/** True if `ring`'s centroid falls inside any ring of any shape in `shapes` ({ rings } objects). */
export function centroidInsideAny(ring, shapes) {
  const [cx, cy] = centroid(ring);
  return shapes.some((s) => s.rings.some((r) => pointInRing(cx, cy, r)));
}

/**
 * One page, retried a few times: a heavy query (e.g. the ground layer at full
 * `geometryPrecision` with no `maxAllowableOffset`) is slow enough for UCSD's
 * server or an intervening proxy to reset the connection mid-response
 * (`ECONNRESET`/"terminated") well before it is actually down. Same doctrine
 * as `queryOverpass`'s mirror retry below.
 */
async function fetchJsonRetrying(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
      const j = await r.json();
      if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error)}`);
      return j;
    } catch (e) {
      lastErr = e;
      console.warn(`queryAll attempt ${attempt + 1} failed (${e.message}) for ${url}; retrying…`);
      await new Promise((res) => setTimeout(res, 4000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Every feature of an ArcGIS layer, following resultOffset paging past maxRecordCount. */
export async function queryAll(layerUrl, params) {
  const out = [];
  for (let offset = 0; ; ) {
    const q = new URLSearchParams({ where: '1=1', outSR: '4326', f: 'json', resultRecordCount: '2000', resultOffset: String(offset), ...params });
    const j = await fetchJsonRetrying(`${layerUrl}/query?${q}`);
    out.push(...j.features);
    if (!j.exceededTransferLimit || j.features.length === 0) return out;
    offset += j.features.length;
  }
}
