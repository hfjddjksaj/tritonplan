/**
 * A building is not a point on the network — it is a set of DOORS, and which
 * door you leave by is part of the route, not a precondition for it.
 *
 * Measured 2026-08-21 over 50 UCSD teaching buildings (spec §5.1): snapping to
 * one node was the single largest error source in this feature — bigger than
 * the routing itself by an order of magnitude. Center Hall ↔ Student Services
 * came out 424 m single-node against 186 m door-to-door, because the one node
 * chosen sat on the wrong face of a 95 m-wide building.
 *
 * ⚠ The indoor cost is NOT optional. Seeding every door at zero looks like it
 * saves a median 129 m, but that is free teleportation to whichever door faces
 * the destination — a lie for Biomedical Sciences, which is 143 m across. With
 * the indoor leg charged honestly the gain is a median 42 m, and 20% of pairs
 * come out LONGER than single-node. That 20% is exactly where the zero-seed
 * version was cheating.
 */
import { type WalkGraph, metresBetween } from './walk-graph';

/** A way onto the network, and what it costs to reach it from inside. */
export interface Portal {
  node: number;
  /** Equivalent metres: indoor leg × INDOOR, plus the outdoor hop to the node. */
  seedCost: number;
}

/** How far from the footprint a node may sit and still count as that building's door. */
export const PORTAL_REACH_M = 45;

/** Corridors bend; 50 m of building is more walking than 50 m of pavement. */
export const INDOOR = 1.2;

/**
 * Points every `stepM` along a footprint's outline, as [lat, lon].
 *
 * ⚠ Axis flip on purpose: rings arrive flat and [lon, lat, …] the way
 * `campus-geo.ts` stores them, and leave [lat, lon] the way `metresBetween`
 * and the graph's own arrays read them.
 *
 * Resampled, not filtered: footprint vertices are spaced very unevenly — a
 * straight 60 m wall is often just two of them — so picking vertices would
 * leave whole faces of a building with no candidate door beside them.
 */
export function resampleOutline(rings: number[][], stepM = 10): [number, number][] {
  const pts: [number, number][] = [];
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const lo1 = ring[2 * i]!;
      const la1 = ring[2 * i + 1]!;
      // Wrap to vertex 0 on the last edge: a ring is closed even when the wire
      // does not repeat its first point.
      const j = (i + 1) % n;
      const lo2 = ring[2 * j]!;
      const la2 = ring[2 * j + 1]!;
      pts.push([la1, lo1]);
      const d = metresBetween(la1, lo1, la2, lo2);
      const steps = Math.floor(d / stepM);
      for (let k = 1; k <= steps; k++) {
        const t = (k * stepM) / d;
        pts.push([la1 + (la2 - la1) * t, lo1 + (lo2 - lo1) * t]);
      }
    }
  }
  return pts;
}

/* ------------------------------------------------------------ spatial index */

const CELL = 0.0005; // ~56 m of latitude — one cell is a little over PORTAL_REACH_M

interface Grid {
  cells: Map<string, number[]>;
}

/**
 * Built once per graph and thrown away with it. A building has ~100 outline
 * samples and every one of them asks "what is within 45 m", so a linear scan
 * of 15.6k nodes per sample would be a million distance checks per building.
 */
const gridCache = new WeakMap<WalkGraph, Grid>();

function gridFor(g: WalkGraph): Grid {
  let grid = gridCache.get(g);
  if (grid) return grid;
  const cells = new Map<string, number[]>();
  for (let i = 0; i < g.n; i++) {
    const key = `${Math.floor(g.lat[i]! / CELL)},${Math.floor(g.lon[i]! / CELL)}`;
    let bucket = cells.get(key);
    if (!bucket) cells.set(key, (bucket = []));
    bucket.push(i);
  }
  grid = { cells };
  gridCache.set(g, grid);
  return grid;
}

/**
 * Candidates, not answers: everything in the cells the radius can touch. The
 * span is measured in degrees of LATITUDE, which is the narrower axis here —
 * a cell of longitude is shorter on the ground, so the same span over-covers
 * east-west rather than under-covering it.
 */
function nodesNear(g: WalkGraph, lat: number, lon: number, radius: number): number[] {
  const { cells } = gridFor(g);
  const span = Math.ceil(radius / (CELL * 111_320)) + 1;
  const ci = Math.floor(lat / CELL);
  const cj = Math.floor(lon / CELL);
  const out: number[] = [];
  for (let i = ci - span; i <= ci + span; i++) {
    for (let j = cj - span; j <= cj + span; j++) {
      const bucket = cells.get(`${i},${j}`);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

/**
 * The doors of one building: every network node within PORTAL_REACH_M of its
 * outline, each priced with the walk from the building's centre out to it.
 *
 * The centroid stands in for "where the classroom is", because we do not know
 * — TSS gives a room number and there are no indoor coordinates. It is the
 * expected position, which is what makes a far door cost more than a near one.
 *
 * A node reachable from several outline samples keeps the cheapest of them:
 * one door, one price, and the router decides whether it is worth using.
 */
export function buildPortals(
  g: WalkGraph,
  outline: readonly [number, number][],
  centroid: { lat: number; lon: number },
): Portal[] {
  const best = new Map<number, number>();
  for (const [la, lo] of outline) {
    const indoor = metresBetween(centroid.lat, centroid.lon, la, lo) * INDOOR;
    for (const i of nodesNear(g, la, lo, PORTAL_REACH_M)) {
      const hop = metresBetween(la, lo, g.lat[i]!, g.lon[i]!);
      if (hop > PORTAL_REACH_M) continue;
      const cost = indoor + hop;
      const cur = best.get(i);
      if (cur === undefined || cost < cur) best.set(i, cost);
    }
  }
  return [...best].map(([node, seedCost]) => ({ node, seedCost }));
}
