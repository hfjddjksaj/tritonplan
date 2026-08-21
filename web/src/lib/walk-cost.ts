/**
 * What one edge costs, per travel mode.
 *
 * Walking is the mode this feature stands behind; bike and scooter are
 * ESTIMATES and say so in the UI. OSM tags only 7% of UCSD's ways with
 * `bicycle=*` (spec §2.3), so nothing here may claim to route a bike around a
 * dismount zone. What it CAN do is refuse stairs, which is tagged completely
 * (322 segments) — and carrying a bike down a staircase is a failed route, not
 * a slow one.
 */

export type Profile = 'walk' | 'bike' | 'scooter';

export interface ProfileSpec {
  /** Speed on the flat, m/s. */
  flat: number;
  /** How sharply slope bites. Tobler's own constant is 3.5 for walking. */
  exponent: number;
  stepsUp: number;
  stepsDown: number;
  /** Stairs are impassable for this mode (a bike). */
  stepsBlocked: boolean;
  /** Added once per route, not per edge — parking and locking a bike. */
  fixedSeconds: number;
  label: string;
  /** Show the reading as an estimate, at a lower confidence than walking. */
  estimated: boolean;
}

/**
 * Every number here is a judgement call, so each carries its reasoning:
 *
 * - walk.flat 1.30 — below the 1.4 m/s textbook figure on purpose; this is a
 *   campus at class change, not an empty pavement.
 * - walk.stepsUp 0.45 / stepsDown 0.70 — stairs are priced on their 3-D length
 *   at a fixed speed rather than through the slope curve, whose horizontal
 *   projection is meaningless on a staircase.
 * - bike.exponent 5.0 — a bicycle loses far more to a hill than a walker does.
 * - bike.fixedSeconds 120 — finding a rack, locking, unlocking. Not snapped to
 *   `amenity=bicycle_parking`: 81 points exist but only 11 carry capacity, so
 *   a fixed charge is the honest version.
 * - scooter 3.0 with stairs at walking pace — you get off and carry it.
 */
export const PROFILES: Record<Profile, ProfileSpec> = {
  walk: {
    flat: 1.3, exponent: 3.5,
    stepsUp: 0.45, stepsDown: 0.7, stepsBlocked: false,
    fixedSeconds: 0, label: 'Walk', estimated: false,
  },
  bike: {
    flat: 4.0, exponent: 5.0,
    stepsUp: 0, stepsDown: 0, stepsBlocked: true,
    fixedSeconds: 120, label: 'Bike', estimated: true,
  },
  scooter: {
    flat: 3.0, exponent: 4.0,
    stepsUp: 0.45, stepsDown: 0.45, stepsBlocked: false,
    fixedSeconds: 0, label: 'Scooter', estimated: true,
  },
};

/** Walk first: it is the mode with a defensible number behind it. */
export const PROFILE_ORDER: readonly Profile[] = ['walk', 'bike', 'scooter'];

/**
 * Tobler's hiking function, renormalised so grade 0 gives exactly `flat`.
 *
 * Tobler's raw form peaks at −5% grade and reads 5.04 km/h on the flat, which
 * is faster than a student crossing a busy campus. Subtracting the 0.05 inside
 * the exponent pins the curve to our own flat speed while keeping its shape:
 * still fastest on a gentle downhill, still collapsing on a climb.
 */
export function speedAt(p: ProfileSpec, grade: number): number {
  return p.flat * Math.exp(-p.exponent * (Math.abs(grade + 0.05) - 0.05));
}

/**
 * Seconds to traverse one edge. `Infinity` means this mode cannot use it at all
 * — Dijkstra then simply never relaxes through it.
 *
 * `metres` is the horizontal length and `dh` the rise. On stairs the two are
 * combined into a real 3-D length first: a flight can be 4 m across and 3 m
 * tall, and charging only the 4 m would make a staircase the fastest way up a
 * canyon.
 */
export function edgeSeconds(p: ProfileSpec, metres: number, dh: number, isSteps: boolean): number {
  if (isSteps) {
    if (p.stepsBlocked) return Infinity;
    const length = Math.hypot(metres, dh);
    return length / (dh >= 0 ? p.stepsUp : p.stepsDown);
  }
  if (metres <= 0) return 0;
  return metres / speedAt(p, dh / metres);
}
