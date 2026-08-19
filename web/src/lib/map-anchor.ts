/**
 * Where a pin sits on a building.
 *
 * The map draws a building from its FOOTPRINT polygon (`ucsd-campus-geo.json`,
 * the ArcGIS outline layer) but pinned it at the coordinates of UCSD's building
 * POINT record (`ucsd-buildings.json`, what `matchBuilding` resolves to). Those
 * are two different datasets and they do not agree. Measured across the 562
 * buildings in both, the pin moves a median of 4.1 m by switching to the
 * polygon — invisible — but 153 of them move more than 10 m and 69 more than
 * 20 m: York Hall 39.4 m, Mandeville Center 32.0 m, Price Center West 22.5 m,
 * Pepper Canyon Hall 18.8 m.
 *
 * At the home framing (1.85 m/px) even 39 m is ~21 px and the pin still lands
 * somewhere on a large building. Stand the map up and zoom in — 0.76 m/px at
 * z17.4 — and it is 52 px: the pin sits beside an unmistakable 3D block it is
 * visibly not on, which is the whole reason 3D exposed this and 2D did not.
 *
 * The point record stays the answer for everything OUTSIDE the map (the
 * popover, the Google Maps link): it is UCSD's own official position, and a
 * building with no bundled footprint still needs it.
 *
 * A centroid would not do. The plain average of a footprint's corners falls
 * OUTSIDE the building itself for 37 of the 608 bundled outlines — Frankfurter
 * Hall, Che Cafe, Grassroots and other courtyard and L shapes — and where it
 * does land inside it can still hug a wall. {@link polygonAnchor} finds the
 * pole of inaccessibility instead: the interior point farthest from any edge,
 * i.e. the middle of the widest part of the mass, which is also where a pin
 * looks deliberate rather than dropped.
 */
import type { CampusShape } from './campus-geo';

/** Metres per degree of latitude; longitude is scaled by cos(lat) at the site. */
const M_PER_DEG = 111_320;

/** Flat [lng, lat, …] ring → [x, y] pairs, so the maths below reads normally. */
function pairs(flat: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
}

/** Squared distance from p to segment ab. */
function segDistSq(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/**
 * Signed distance from p to the polygon: positive inside, negative outside,
 * magnitude = distance to the nearest edge of any ring. Rings after the first
 * are holes, and because this measures distance to the nearest EDGE of any
 * ring, a hole repels the anchor exactly like an outer wall does.
 */
function signedDist(p: readonly [number, number], rings: readonly [number, number][][]): number {
  let inside = false;
  let minSq = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
        inside = !inside;
      }
      minSq = Math.min(minSq, segDistSq(p, a, b));
    }
  }
  const d = Math.sqrt(minSq);
  return inside ? d : -d;
}

/**
 * The point inside a polygon farthest from its edges — the "pole of
 * inaccessibility", the same thing a label placer wants.
 *
 * Quadtree search: split the bounding box into cells, keep the most promising
 * (its centre's clearance plus the cell's own half-diagonal bounds the best any
 * point in it could do), and subdivide until no cell could beat the best found
 * by more than `precision`. Deterministic, no dependency, and it terminates on
 * concave, multi-ring and self-touching rings alike — all of which the ArcGIS
 * footprints contain.
 *
 * Works in metres, not degrees: at UCSD's latitude a degree of longitude is
 * 16% shorter than a degree of latitude, and searching in raw degrees would
 * quietly bias the anchor along the short axis.
 *
 * @param rings outer ring first, holes after; each flat [lng, lat, lng, lat, …]
 * @param precision metres; 1 m is far below what a pin can express
 */
export function polygonAnchor(rings: readonly number[][], precision = 1): [number, number] | null {
  const outer = rings[0];
  if (!outer || outer.length < 6) return null;

  const lat0 = outer[1]!;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const ky = M_PER_DEG;
  const toM = (r: readonly number[]): [number, number][] => pairs(r).map(([lng, lat]) => [lng * kx, lat * ky]);
  const metric = rings.map(toM);
  const ring0 = metric[0]!;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring0) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const cellSize = Math.min(w, h);
  if (cellSize === 0) return [outer[0]!, outer[1]!];

  interface Cell {
    x: number;
    y: number;
    half: number;
    d: number;
    max: number;
  }
  const cell = (x: number, y: number, half: number): Cell => {
    const d = signedDist([x, y], metric);
    return { x, y, half, d, max: d + half * Math.SQRT2 };
  };

  // Seed with a grid over the bounding box, plus the box centre as a floor.
  const queue: Cell[] = [];
  let half = cellSize / 2;
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) queue.push(cell(x + half, y + half, half));
  }
  let best = cell(minX + w / 2, minY + h / 2, 0);

  // A hard cap on work: these are building footprints, not coastlines, but a
  // pathological ring must not be able to spin here forever.
  let budget = 20_000;
  while (queue.length && budget-- > 0) {
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i]!.max > queue[bestIdx]!.max) bestIdx = i;
    const c = queue.splice(bestIdx, 1)[0]!;
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    half = c.half / 2;
    queue.push(cell(c.x - half, c.y - half, half));
    queue.push(cell(c.x + half, c.y - half, half));
    queue.push(cell(c.x - half, c.y + half, half));
    queue.push(cell(c.x + half, c.y + half, half));
  }
  return [best.x / kx, best.y / ky];
}

/**
 * Footprint name → the point on it a pin should sit, for every bundled
 * building. Names repeat in the source (one building can be several polygons —
 * "Asante House East" and its neighbours are separate records, and a few names
 * appear twice outright); the LARGEST ring wins, because that is the piece a
 * student sees and the piece the 3D extrusion is dominated by.
 */
export function footprintAnchors(footprints: readonly CampusShape[]): Map<string, [number, number]> {
  const bestArea = new Map<string, number>();
  const out = new Map<string, [number, number]>();
  for (const f of footprints) {
    const outer = f.rings[0];
    if (!f.name || !outer) continue;
    // Shoelace, in degrees — only ever compared against other rings at the same
    // latitude, so the missing cos(lat) cancels.
    let a2 = 0;
    const pts = pairs(outer);
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a2 += pts[j]![0] * pts[i]![1] - pts[i]![0] * pts[j]![1];
    }
    const area = Math.abs(a2) / 2;
    if (area <= (bestArea.get(f.name) ?? -1)) continue;
    const anchor = polygonAnchor(f.rings);
    if (!anchor) continue;
    bestArea.set(f.name, area);
    out.set(f.name, anchor);
  }
  return out;
}

/**
 * Move a pin onto the building the map draws for it.
 *
 * `parts` (a complex like Asante House, which is several wings and no polygon
 * of its own) averages the wings' anchors, so the pin lands in the middle of
 * the complex rather than on whichever wing sorted first. A pin whose building
 * has no bundled footprint keeps the coordinates it came with — the point
 * record is still the best answer there.
 */
export function anchorOnFootprint(
  pin: { place?: string; parts?: readonly string[]; coords: { lat: number; lng: number } | null },
  anchors: ReadonlyMap<string, [number, number]>,
): { lat: number; lng: number } | null {
  if (!pin.coords) return pin.coords;
  const names = pin.parts?.length ? pin.parts : pin.place ? [pin.place] : [];
  const hits = names.map((n) => anchors.get(n)).filter((a): a is [number, number] => !!a);
  if (hits.length === 0) return pin.coords;
  const lng = hits.reduce((t, [x]) => t + x, 0) / hits.length;
  const lat = hits.reduce((t, [, y]) => t + y, 0) / hits.length;
  return { lat, lng };
}
