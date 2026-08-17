/**
 * GeoJSON sources for the MapLibre campus map: turns the bundled, decoded
 * campus geometry (`campus-geo.ts`) into the FeatureCollections a MapLibre
 * style can key layers off of — ground surfaces, building footprints, trees,
 * roads, the ocean fill, the campus boundary, land use, and label points.
 *
 * Also carries the geometry helpers the old SVG renderer used for the same
 * purpose (`ringArea`, `polygonAnchor`, `oceanRing`) — a MapLibre layer still
 * needs a ring's area (draw order / label rank) and a polygon's "read a name
 * here" anchor point, it just consumes them as GeoJSON properties instead of
 * canvas pixels.
 */
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon } from 'geojson';
import type { CampusGeo, CampusLine, CampusMapData, CampusShape } from './campus-geo';
import { LANDMARKS, buildingShortName, districtLabel, districtPriority, roadLabelText } from './map-names';

export interface MapSources {
  // Widened from the brief's literal `Polygon` to `Polygon | MultiPolygon`
  // (Ruling 6): a ground shape's rings can be genuinely disjoint pieces, not
  // just holes, and MapLibre fills/extrudes/places symbols on both the same
  // way, so this costs Task 5's style nothing.
  ground: FeatureCollection<Polygon | MultiPolygon, { type: string; rank: number }>;
  buildings: FeatureCollection<Polygon | MultiPolygon, { name: string; height: number }>;
  trees: FeatureCollection<Point, { cls: number }>;
  roads: FeatureCollection<LineString, { name: string; label: string; kind: 'hwy' | 'major' | 'minor' | 'walk' }>;
  ocean: FeatureCollection<Polygon, {}>;
  campus: FeatureCollection<Polygon, {}>; // boundary
  landuse: FeatureCollection<Polygon, { kind: string }>;
  labels: FeatureCollection<Point, { kind: 'district' | 'landmark' | 'building'; label: string; rank: number }>;
}

/** Building height when the source data carries none (a plain, low box). */
export const DEFAULT_HEIGHT_M = 10;

/* ------------------------------------------------------------ label anchors */

/** Signed area (shoelace) of a flat [lon, lat, …] ring, in degrees². */
export function ringArea(ring: number[]): number {
  let a = 0;
  for (let i = 0, n = ring.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[2 * i]! * ring[2 * j + 1]! - ring[2 * j]! * ring[2 * i + 1]!;
  }
  return a / 2;
}

function pointInRing(x: number, y: number, ring: number[]): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i]!;
    const yi = ring[2 * i + 1]!;
    const xj = ring[2 * j]!;
    const yj = ring[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, y) to the nearest edge of the ring, in the ring's units. */
function edgeDistance(x: number, y: number, ring: number[]): number {
  let best = Infinity;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[2 * j]!;
    const ay = ring[2 * j + 1]!;
    const bx = ring[2 * i]!;
    const by = ring[2 * i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/**
 * Where to put a polygon's name: the interior point farthest from any edge
 * (a coarse pole of inaccessibility). A plain centroid lands outside crescent
 * and L-shaped districts — Warren and Revelle both are — and a name floating in
 * the neighbouring college is worse than no name.
 *
 * Longitude is stretched by cos(lat) first so "farthest" is measured in metres,
 * not degrees. Returns lon/lat degrees.
 */
export function polygonAnchor(rings: number[][]): { lon: number; lat: number } | null {
  let ring: number[] | null = null;
  let best = 0;
  for (const r of rings) {
    const a = Math.abs(ringArea(r));
    if (a > best) {
      best = a;
      ring = r;
    }
  }
  if (!ring || ring.length < 6) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const x = ring[i]!;
    const y = ring[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const kx = Math.cos(((minY + maxY) / 2) * (Math.PI / 180));
  // Work in a stretched frame so distances are isotropic.
  const stretched: number[] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) stretched.push(ring[i]! * kx, ring[i + 1]!);

  const N = 24;
  let bestD = -1;
  let bestX = (minX + maxX) / 2;
  let bestY = (minY + maxY) / 2;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const x = minX + ((maxX - minX) * i) / N;
      const y = minY + ((maxY - minY) * j) / N;
      if (!pointInRing(x, y, ring)) continue;
      const d = edgeDistance(x * kx, y, stretched);
      if (d > bestD) {
        bestD = d;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (bestD < 0) return null; // degenerate sliver: no grid point landed inside
  return { lon: bestX, lat: bestY };
}

/* ----------------------------------------------------------------- ocean */

/**
 * Turn the coastline chain into a closed ring covering the sea: the chain
 * itself, extended past both ends so a zoomed-out canvas is still covered,
 * then closed far to the west. OSM coastlines run with land on the left, and
 * this stretch runs north→south with the Pacific on the right (west) — the
 * closure side is fixed by that, not inferred.
 */
export function oceanRing(coast: CampusLine): number[] {
  const p = coast.pts;
  if (p.length < 4) return [];
  const [x0, y0] = [p[0]!, p[1]!];
  const [x1, y1] = [p[p.length - 2]!, p[p.length - 1]!];
  const north = y0 >= y1;
  const REACH = 0.5; // degrees — well past any canvas the map can show
  const WEST = Math.min(x0, x1) - REACH;
  const top = north ? [x0, y0 + REACH] : [x1, y1 + REACH];
  const bottom = north ? [x1, y1 - REACH] : [x0, y0 - REACH];
  const chain = north ? p : reversePairs(p);
  return [...top, ...chain, ...bottom, WEST, bottom[1]!, WEST, top[1]!];
}

function reversePairs(flat: number[]): number[] {
  const out: number[] = [];
  for (let i = flat.length - 2; i >= 0; i -= 2) out.push(flat[i]!, flat[i + 1]!);
  return out;
}

/* -------------------------------------------------------------- geometry */

/** Flat [lon, lat, …] pairs → GeoJSON ring positions, closed (first repeated last). */
function ringToCoords(ring: number[]): number[][] {
  const coords: number[][] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) coords.push([ring[i]!, ring[i + 1]!]);
  if (coords.length === 0) return coords;
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0]!, first[1]!]);
  return coords;
}

/** Flat [lon, lat, …] pairs → GeoJSON LineString positions (not closed). */
function pairsToCoords(pts: number[]): number[][] {
  const coords: number[][] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) coords.push([pts[i]!, pts[i + 1]!]);
  return coords;
}

/**
 * Group a shape's rings into outer pieces with their holes, by containment
 * rather than by position in the array: largest ring first, then each
 * smaller ring either nests inside an already-placed outer ring (a hole) or
 * starts a new outer piece of its own (a disjoint piece — e.g. two wings of
 * one footprint that only share a `name`). A ring's first vertex is enough to
 * test, since footprint/ground rings never partially overlap in this data.
 * Reuses `pointInRing` rather than a second copy.
 */
function assembleRings(rings: number[][]): number[][][] {
  const byArea = rings
    .map((ring) => ({ ring, area: Math.abs(ringArea(ring)) }))
    .sort((a, b) => b.area - a.area);

  const pieces: number[][][] = []; // each entry: [outerRing, ...holeRings]
  for (const { ring } of byArea) {
    const outerIndex = pieces.findIndex((piece) => pointInRing(ring[0]!, ring[1]!, piece[0]!));
    if (outerIndex >= 0) pieces[outerIndex]!.push(ring);
    else pieces.push([ring]);
  }
  return pieces;
}

/**
 * A shape's rings as a `Polygon` (one outer piece — its holes, if any, as its
 * later rings) or a `MultiPolygon` (several disjoint outer pieces, each with
 * its own holes). Used for both building footprints and ground-surface
 * shapes: both bundled sources mix genuine holes (an atrium, a courtyard)
 * with genuinely disjoint pieces sharing one name/type, and only containment
 * — not just "how many rings" — tells them apart (Ruling 6).
 */
export function shapeGeometry(rings: number[][]): Polygon | MultiPolygon {
  const pieces = assembleRings(rings);
  if (pieces.length <= 1) return { type: 'Polygon', coordinates: (pieces[0] ?? []).map(ringToCoords) };
  return { type: 'MultiPolygon', coordinates: pieces.map((piece) => piece.map(ringToCoords)) };
}

/**
 * Draw order for ground-surface polygons, low first (drawn earliest, so later
 * types paint over them). Unknown types (`groundRank` below) sort mid-stack.
 */
const GROUND_ORDER = [
  'Dirt',
  'Sand',
  'Gravel',
  'Mulch',
  'Rock',
  'Grass',
  'Planter',
  'Athletic Track',
  'Baseball Field',
  'Softball Field',
  'Soccer Field',
  'Tennis Court Exterior',
  'Tennis Court Interior',
  'Hardcourt',
  'Parking Lot',
  'Street',
  'Service Road',
  'Sidewalk',
  'Bike Path',
  'Walking Path',
  'Dock / Pier',
  'Pool / Fountain',
  'Pool/Fountain',
  'Wall',
  'Shed',
  'Miscellaneous Structures',
  'Building',
] as const;

function groundRank(type: string): number {
  const i = (GROUND_ORDER as readonly string[]).indexOf(type);
  return i === -1 ? 5 : i;
}

/* --------------------------------------------------------------- labels */

function districtLabels(geo: CampusGeo): Feature<Point, { kind: 'district'; label: string; rank: number }>[] {
  const out: Feature<Point, { kind: 'district'; label: string; rank: number }>[] = [];
  for (const d of geo.districts) {
    const label = districtLabel(d.name);
    if (!label) continue;
    const a = polygonAnchor(d.rings);
    if (!a) continue;
    out.push({
      type: 'Feature',
      properties: { kind: 'district', label, rank: districtPriority(d.name) },
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
    });
  }
  return out;
}

function landmarkLabels(geo: CampusGeo): Feature<Point, { kind: 'landmark'; label: string; rank: number }>[] {
  const byName = new Map<string, CampusShape>();
  for (const f of geo.footprints) if (!byName.has(f.name)) byName.set(f.name, f);
  const out: Feature<Point, { kind: 'landmark'; label: string; rank: number }>[] = [];
  for (const { footprint, label } of LANDMARKS) {
    const shape = byName.get(footprint);
    if (!shape) continue;
    const a = polygonAnchor(shape.rings);
    if (!a) continue;
    out.push({
      type: 'Feature',
      properties: { kind: 'landmark', label, rank: 0 },
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
    });
  }
  return out;
}

/**
 * One label per footprint name (first occurrence, biggest area wins the
 * rank), skipping the footprints already named as landmarks. `rank` sorts
 * bigger buildings first (more negative), matching MapLibre's ascending
 * symbol-sort-key convention.
 */
function buildingLabels(geo: CampusGeo): Feature<Point, { kind: 'building'; label: string; rank: number }>[] {
  const skip = new Set(LANDMARKS.map((l) => l.footprint));
  const seen = new Set<string>();
  const out: Feature<Point, { kind: 'building'; label: string; rank: number }>[] = [];
  for (const f of geo.footprints) {
    if (seen.has(f.name) || skip.has(f.name)) continue;
    const label = buildingShortName(f.name);
    if (!label) continue;
    const a = polygonAnchor(f.rings);
    if (!a) continue;
    seen.add(f.name);
    let area = 0;
    for (const r of f.rings) area += Math.abs(ringArea(r));
    out.push({
      type: 'Feature',
      properties: { kind: 'building', label, rank: Math.round(-area * 1e8) },
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
    });
  }
  return out;
}

/* ---------------------------------------------------------------- sources */

/**
 * Turn the bundled, decoded campus geometry into the GeoJSON FeatureCollections
 * a MapLibre style keys its layers off of. Pure and synchronous — the caller
 * awaits `loadCampusGeo`/`loadCampusMap` first.
 */
export function buildSources(geo: CampusGeo, map: CampusMapData): MapSources {
  const ground: FeatureCollection<Polygon | MultiPolygon, { type: string; rank: number }> = {
    type: 'FeatureCollection',
    features: map.ground.map((g) => ({
      type: 'Feature',
      properties: { type: g.type, rank: groundRank(g.type) },
      geometry: shapeGeometry(g.rings),
    })),
  };

  const buildings: FeatureCollection<Polygon | MultiPolygon, { name: string; height: number }> = {
    type: 'FeatureCollection',
    features: geo.footprints.map((f) => ({
      type: 'Feature',
      properties: { name: f.name, height: f.height ?? DEFAULT_HEIGHT_M },
      geometry: shapeGeometry(f.rings),
    })),
  };

  const trees: FeatureCollection<Point, { cls: number }> = {
    type: 'FeatureCollection',
    features: map.trees.map((t) => ({
      type: 'Feature',
      properties: { cls: t.cls },
      geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
    })),
  };

  const roads: FeatureCollection<LineString, { name: string; label: string; kind: 'hwy' | 'major' | 'minor' | 'walk' }> = {
    type: 'FeatureCollection',
    features: geo.lines
      .filter((l): l is CampusLine & { kind: 'hwy' | 'major' | 'minor' | 'walk' } => l.kind !== 'coast')
      .map((l) => ({
        type: 'Feature',
        properties: { name: l.name, label: l.name ? roadLabelText(l.name) : '', kind: l.kind },
        geometry: { type: 'LineString', coordinates: pairsToCoords(l.pts) },
      })),
  };

  const coast = geo.lines.find((l) => l.kind === 'coast');
  const ocean: FeatureCollection<Polygon, {}> = {
    type: 'FeatureCollection',
    features: coast
      ? [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [ringToCoords(oceanRing(coast))] },
          },
        ]
      : [],
  };

  const campus: FeatureCollection<Polygon, {}> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: map.boundary.map(ringToCoords) },
      },
    ],
  };

  const landuse: FeatureCollection<Polygon, { kind: string }> = {
    type: 'FeatureCollection',
    features: map.landuse.map((l) => ({
      type: 'Feature',
      properties: { kind: l.kind },
      geometry: { type: 'Polygon', coordinates: l.rings.map(ringToCoords) },
    })),
  };

  const labels: FeatureCollection<Point, { kind: 'district' | 'landmark' | 'building'; label: string; rank: number }> = {
    type: 'FeatureCollection',
    features: [...districtLabels(geo), ...landmarkLabels(geo), ...buildingLabels(geo)],
  };

  return { ground, buildings, trees, roads, ocean, campus, landuse, labels };
}
