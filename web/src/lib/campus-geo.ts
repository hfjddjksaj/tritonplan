/**
 * Bundled UCSD campus geometry — building footprints and named districts, used
 * as the basemap under the campus map's pins.
 *
 * Generated at dev time by `npm run fetch:buildings -w @triton/web` from UCSD's
 * public ArcGIS layers. The page NEVER fetches this at runtime; it is bundled
 * and pulled in by a dynamic import so it stays out of the first-paint chunk.
 *
 * Wire format keeps the file small enough to bundle: coordinates are integers
 * at 1e5 scale (~1.1 m, well under a pixel at display scale) and delta-encoded
 * within each ring, so most values are one or two digits.
 */

/** One drawable outline: a building footprint or a district boundary. */
export interface CampusShape {
  name: string;
  /** Rings as flat [lon, lat, lon, lat, …] degree pairs. */
  rings: number[][];
}

export interface CampusGeo {
  footprints: CampusShape[];
  districts: CampusShape[];
}

/** `[name, [ring, …]]`; ring = `[x0, y0, dx, dy, …]` integers at SCALE. */
export type WireShape = [string, number[][]];

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
