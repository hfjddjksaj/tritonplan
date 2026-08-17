/**
 * Bundled UCSD campus geometry — building footprints and named districts from
 * UCSD's public ArcGIS layers, plus roads, named walkways and the coastline
 * from OpenStreetMap — used as the basemap under the campus map's pins.
 *
 * Generated at dev time by `npm run fetch:buildings -w @triton/web`. The page
 * NEVER fetches this at runtime; it is bundled and pulled in by a dynamic
 * import so it stays out of the first-paint chunk.
 *
 * Wire format keeps the file small enough to bundle: coordinates are integers
 * at 1e5 scale (~1.1 m, well under a pixel at display scale) and delta-encoded
 * within each ring, so most values are one or two digits.
 */
import { fitBounds, project, type Point, type Viewport } from './map-projection';

/** One drawable outline: a building footprint or a district boundary. */
export interface CampusShape {
  name: string;
  /** Rings as flat [lon, lat, lon, lat, …] degree pairs. */
  rings: number[][];
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

/** `[name, [ring, …]]`; ring = `[x0, y0, dx, dy, …]` integers at SCALE. */
export type WireShape = [string, number[][]];
/** `[name, kind, [x0, y0, dx, dy, …]]` — same integer/delta scheme as a ring. */
export type WireLine = [string, LineKind, number[]];

const SCALE = 1e5;

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
  return wire.map(([name, rings]) => ({ name, rings: rings.map(decodeRing) }));
}

export function decodeLines(wire: WireLine[]): CampusLine[] {
  return wire.map(([name, kind, pts]) => ({ name, kind, pts: decodeRing(pts) }));
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

/**
 * Breathing room around the framed core, in canvas pixels: 28 px on the
 * 1100 × 760 desktop canvas, 13 px on the 360 × 560 phone one. A fixed 28 would
 * eat a seventh of the phone canvas.
 */
export function campusPadding(w: number, h: number): number {
  return Math.max(8, Math.round(Math.min(w, h) * 0.037));
}

/**
 * The viewport the map draws through. Framed to the academic core rather than
 * to the pins, so a plan with two neighbouring classes still reads as UCSD —
 * and framed to the core rather than to all 25 districts, so the buildings
 * students actually walk between are big enough to tell apart.
 *
 * Shared by the renderer and by the shell, which needs the same numbers to know
 * which markers land off-canvas.
 */
export function campusViewport(geo: CampusGeo, w: number, h: number): Viewport {
  const pts: Point[] = [];
  for (const shape of coreDistricts(geo)) {
    for (const ring of shape.rings) {
      for (let i = 0; i + 1 < ring.length; i += 2) pts.push(project(ring[i]!, ring[i + 1]!));
    }
  }
  return fitBounds(pts, w, h, campusPadding(w, h));
}
