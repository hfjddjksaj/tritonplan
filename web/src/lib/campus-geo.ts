/**
 * Bundled UCSD campus geometry — building footprints and named districts from
 * UCSD's public ArcGIS layers, plus roads, named walkways and the coastline
 * from OpenStreetMap — used as the basemap under the campus map's pins. A
 * second bundled file (`ucsd-campus-map.json`) carries the ground-surface
 * polygons, trees, campus boundary and land use from the same ArcGIS source.
 *
 * Generated at dev time by `npm run fetch:buildings -w @triton/web`. The page
 * NEVER fetches either file at runtime; both are bundled and pulled in with a
 * dynamic `?raw` import so they stay out of the first-paint chunk.
 *
 * Wire format keeps the files bundle-able without discarding precision: the
 * map draws up to z19, where one screen pixel is ≈ 0.25 m at UCSD's latitude,
 * so the source geometry is carried unsimplified (no RDP) and only quantised
 * onto a 1e6 integer grid (~0.11 m — below a pixel), delta-encoded within each
 * ring so most values are one or two digits.
 */

/** One drawable outline: a building footprint or a district boundary. */
export interface CampusShape {
  name: string;
  /** Rings as flat [lon, lat, lon, lat, …] degree pairs. */
  rings: number[][];
  /** Height in metres, 3D building footprints only. */
  height?: number;
}

/**
 * How a line is drawn. `coast` is the Pacific shoreline (one chain, closed
 * westward into the ocean fill); the rest are OpenStreetMap highway classes
 * collapsed to the four weights the renderer distinguishes.
 */
export type LineKind = 'coast' | 'hwy' | 'major' | 'minor' | 'walk';

/** One drawable polyline: a road, a named walkway, or the coastline. */
export interface CampusLine {
  /** OSM name; empty for unnamed motorway pieces and the coast. */
  name: string;
  kind: LineKind;
  /** Flat [lon, lat, lon, lat, …] degree pairs. */
  pts: number[];
}

export interface CampusGeo {
  footprints: CampusShape[];
  districts: CampusShape[];
  lines: CampusLine[];
}

/**
 * `[name, [ring, …]]` or `[name, [ring, …], height]`; ring = `[x0, y0, dx, dy,
 * …]` integers at SCALE. The height element (metres) is present only for 3D
 * building footprints.
 */
export type WireShape = [string, number[][]] | [string, number[][], number];
/** `[name, kind, [x0, y0, dx, dy, …]]` — same integer/delta scheme as a ring. */
export type WireLine = [string, LineKind, number[]];

/** One ground-surface polygon, e.g. a lawn, a sidewalk, a parking lot. */
export interface GroundShape {
  type: string;
  /** Rings as flat [lon, lat, lon, lat, …] degree pairs. */
  rings: number[][];
}

/** One campus tree. `cls` is the raw upstream size/species class, 0–4. */
export interface Tree {
  lon: number;
  lat: number;
  cls: 0 | 1 | 2 | 3 | 4;
}

/** One land-use polygon: a park, a wooded area, or a beach. */
export interface LanduseShape {
  kind: 'park' | 'wood' | 'beach';
  /** Rings as flat [lon, lat, lon, lat, …] degree pairs. */
  rings: number[][];
}

/** Decoded contents of `ucsd-campus-map.json`. */
export interface CampusMapData {
  ground: GroundShape[];
  trees: Tree[];
  boundary: number[][];
  landuse: LanduseShape[];
}

const SCALE = 1e6;

/** Expand one delta-encoded ring into flat lon/lat degrees. */
export function decodeRing(wire: number[]): number[] {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < wire.length; i += 2) {
    x += wire[i]!;
    y += wire[i + 1]!;
    out.push(x / SCALE, y / SCALE);
  }
  return out;
}

export function decodeShapes(wire: WireShape[]): CampusShape[] {
  return wire.map(([name, rings, height]) =>
    height === undefined ? { name, rings: rings.map(decodeRing) } : { name, rings: rings.map(decodeRing), height },
  );
}

export function decodeLines(wire: WireLine[]): CampusLine[] {
  return wire.map(([name, kind, pts]) => ({ name, kind, pts: decodeRing(pts) }));
}

/** `[typeIndex, [ring, …]]` — the type name is looked up in the sibling `groundTypes` array. */
export function decodeGround(types: string[], wire: [number, number[][]][]): GroundShape[] {
  return wire.map(([t, rings]) => ({ type: types[t] ?? 'Unknown', rings: rings.map(decodeRing) }));
}

/** Flat `[dx, dy, cls, dx, dy, cls, …]` — delta-encoded lon/lat, class carried raw. */
export function decodeTrees(wire: number[]): Tree[] {
  const out: Tree[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 2 < wire.length; i += 3) {
    x += wire[i]!;
    y += wire[i + 1]!;
    out.push({ lon: x / SCALE, lat: y / SCALE, cls: Math.max(0, Math.min(4, wire[i + 2]!)) as Tree['cls'] });
  }
  return out;
}

interface RawCampusGeo {
  footprints: WireShape[];
  districts: WireShape[];
  /** Absent in the pre-roads data file; decoded as an empty layer. */
  lines?: WireLine[];
}

let cached: Promise<CampusGeo> | null = null;

/**
 * Load and decode the bundled campus geometry. Imported dynamically and as a
 * raw string: `?raw` keeps TypeScript from deep-typing ~11k numeric literals,
 * keeps the payload out of the first-paint chunk, and makes JSON.parse the
 * cost instead of evaluating a giant JS array literal. Memoized — reopening
 * the map never re-parses.
 */
export function loadCampusGeo(): Promise<CampusGeo> {
  cached ??= import('../data/ucsd-campus-geo.json?raw').then((mod) => {
    const raw = JSON.parse(mod.default) as RawCampusGeo;
    return {
      footprints: decodeShapes(raw.footprints),
      districts: decodeShapes(raw.districts),
      lines: decodeLines(raw.lines ?? []),
    };
  });
  return cached;
}

interface RawCampusMap {
  groundTypes: string[];
  ground: [number, number[][]][];
  trees: number[];
  boundary: number[][];
  landuse: [LanduseShape['kind'], number[][]][];
}

let cachedMap: Promise<CampusMapData> | null = null;

/**
 * Load and decode the bundled ground surfaces, trees, boundary and land use.
 * Same dynamic `?raw` import scheme as `loadCampusGeo`, and memoized the same
 * way — reopening the map never re-parses.
 */
export function loadCampusMap(): Promise<CampusMapData> {
  cachedMap ??= import('../data/ucsd-campus-map.json?raw').then((mod) => {
    const raw = JSON.parse(mod.default) as RawCampusMap;
    return {
      ground: decodeGround(raw.groundTypes, raw.ground),
      trees: decodeTrees(raw.trees),
      boundary: raw.boundary.map(decodeRing),
      landuse: raw.landuse.map(([kind, rings]) => ({ kind, rings: rings.map(decodeRing) })),
    };
  });
  return cachedMap;
}

/* ------------------------------------------------------------------ framing */

/**
 * The districts that actually host classes — what the map should be framed to.
 *
 * The full 25-district set spans ~3.4 km each way (Scripps on the shore, Torrey
 * Pines to the north, Health Sciences East, Mesa Housing, Preuss, the Science
 * Research Park), none of which hosts a lecture. Fitting all of it put the
 * entire lower-division teaching core inside ~113 × 153 px of an 1100 × 760
 * canvas — markers piled on top of each other with chips wider than the gaps
 * between the buildings they label.
 *
 * Names are the exact `name` values in `ucsd-campus-geo.json` (ArcGIS "Campus
 * Districts", layer 4) — note "Theatre District", not "Theatre".
 */
export const ACADEMIC_CORE_DISTRICTS: readonly string[] = [
  'Muir',
  'Revelle',
  'Warren',
  'Roosevelt',
  'University Center',
  'Ridge Walk North',
  'Pepper Canyon',
  'Theatre District',
  'North Campus',
];

/**
 * The core districts, or — if a future refetch renames them all — every
 * district. A data change then degrades to the old whole-campus framing
 * instead of collapsing the viewport onto nothing. `campus-geo.test.ts`
 * asserts the subset is non-empty so a rename fails loudly first.
 */
export function coreDistricts(geo: CampusGeo): CampusShape[] {
  const wanted = new Set(ACADEMIC_CORE_DISTRICTS);
  const core = geo.districts.filter((d) => wanted.has(d.name));
  return core.length > 0 ? core : geo.districts;
}

/** A lon/lat bounding box: `[[west, south], [east, north]]`. */
export type LngLatBox = [[number, number], [number, number]];

/** The bounding box of {@link coreDistricts}, for framing a MapLibre view. */
export function coreBounds(geo: CampusGeo): LngLatBox {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const d of coreDistricts(geo)) {
    for (const r of d.rings) {
      for (let i = 0; i + 1 < r.length; i += 2) {
        w = Math.min(w, r[i]!);
        e = Math.max(e, r[i]!);
        s = Math.min(s, r[i + 1]!);
        n = Math.max(n, r[i + 1]!);
      }
    }
  }
  return [[w, s], [e, n]];
}

/**
 * Breathing room around the framed core, in canvas pixels: 28 px on the
 * 1100 × 760 desktop canvas, 13 px on the 360 × 560 phone one. A fixed 28 would
 * eat a seventh of the phone canvas.
 */
export function campusPadding(w: number, h: number): number {
  return Math.max(8, Math.round(Math.min(w, h) * 0.037));
}
