/**
 * A building is not a point on the network — it is a set of DOORS, and which
 * door you leave by is part of the route, not a precondition for it.
 *
 * Measured 2026-08-21 over 50 UCSD teaching buildings: snapping to
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
 *
 * ⚠ And the same is true of the OTHER leg.
 * A door costs `indoor × INDOOR + hop × OFFPATH`, and `hop` — the straight
 * line from the footprint out to the node — was charged at 1.0 with a 45 m
 * reach behind it. Same failure, other half of the formula: free movement the
 * router can spend, over ground nobody paved and the map never draws. Any new
 * term added to seedCost has to answer the same question before it lands: what
 * does a metre of it buy, and is that metre real?
 */
import { type WalkGraph, metresBetween } from './walk-graph';

/** A way onto the network, and what it costs to reach it from inside. */
export interface Portal {
  node: number;
  /** Equivalent metres: `indoor × INDOOR + hop × OFFPATH`. */
  seedCost: number;
  /**
   * `[lat, lon]` of the outline sample this door was priced from — the spot on
   * the wall the route steps out of.
   *
   * Carried because the hop from here to `node` is REAL WALKING, charged in
   * `seedCost` and therefore owed a place on the drawn line. Leaving it out is
   * what made the gold line start out in a field.
   */
  at: readonly [number, number];
}

/**
 * How far from the footprint a node may sit and still count as that
 * building's door.
 *
 * ⚠ Do not widen this: a 45 m reach here was the whole of the "the gold line
 * starts nowhere near my building" bug. See OFFPATH below for why a generous
 * reach is not the harmless safety margin it looks like.
 *
 * 8 m is set from a measurement, not a guess: over the 22 teaching buildings
 * the nearest network node sits a median of 1.0 m from the footprint and at
 * worst 7.7 m (York Hall). The pavement genuinely runs against the walls —
 * the graph carries every polyline vertex, so its nodes are a median 7.7 m
 * apart. Not one teaching building has to fall back to RESCUE_REACH_M.
 *
 * Tightening further does not pay: at 6 m a building drops through to the
 * rescue radius and the worst-case gap rebounds from 8 m to 27 m.
 */
export const PORTAL_REACH_M = 8;

/**
 * How far ONE FACE may reach when it has no node inside PORTAL_REACH_M.
 *
 * A wide courtyard is a real thing to walk across, and refusing to is its own
 * lie. Mayer Hall's York-facing wall has no mapped path within 15 m, so a flat
 * 8 m reach left that whole side doorless and sent the route 221 m around the
 * block: 4.8 minutes to a building whose walls are 26 m away, against a
 * straight-line floor of 1.2. Letting that one face reach 16 m puts it back to
 * 2.7 minutes, which is what walking across the courtyard actually costs.
 *
 * ⚠ PER FACE, and that is the whole point. Granting every sample 16 m instead
 * would hand a wall that already has pavement against it a second, further
 * door to be tempted by — the exact comparison OFFPATH exists to stop. Only a
 * sample that found nothing looks further.
 *
 * 16 m is 2 × PORTAL_REACH_M, and the sweep on 2026-08-23 puts the knee there:
 * it fixes every detour among the 22 teaching buildings, and 20 m does not fix
 * anything more but does reopen one false "next door".
 */
export const FACE_RESCUE_M = 16;

/**
 * Whole-building last resort, and only when the two passes above find NOTHING
 * anywhere on the outline.
 *
 * Peripheral addresses — Lebon Drive, North Torrey Pines Court, the Coast
 * Apartments — sit 39–45 m from the nearest mapped path, and 88 of the 608
 * bundled footprints need this. None of them hosts a lecture. A rescued door
 * still pays OFFPATH on every metre of its hop, so widening the search is not
 * the same as making the jump cheap.
 */
export const RESCUE_REACH_M = 45;

/** Corridors bend; 50 m of building is more walking than 50 m of pavement. */
export const INDOOR = 1.2;

/**
 * What a metre of `hop` costs, against a metre of pavement.
 *
 * ⚠ This is the other half of the lesson in the header, and leaving it at 1.0
 * is exactly that failure. The indoor leg was charged
 * honestly at INDOOR while the hop — a STRAIGHT LINE from the footprint to a
 * network node, across whatever happens to be there — was charged at 1.0, i.e.
 * free.
 *
 * The damage is not the metres it hands out; it is what those metres BUY. A
 * free 45 m jump does not merely save 45 m of walking, it lets a route skip a
 * real detour: a door hard against the wall whose path winds 120 m around the
 * building loses to a door out on the main spine that a straight line reaches
 * over a lawn. Measured over all 462 ordered teaching-building pairs, the
 * router took the second one almost every time — median door 32 m from the
 * footprint, worst 41 m — and drew a gold line that started there, because
 * the jump itself is not part of the path and is never drawn.
 *
 * 4 is chosen so a metre of open ground can never undercut a metre of
 * pavement, and it still does real work at the tightened reach: dropping it
 * back to 1.0 with PORTAL_REACH_M at 8 takes the median gap from 2.6 m to
 * 5.1 m. Do not "simplify" it away.
 */
export const OFFPATH = 4;

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
  const best = new Map<number, { cost: number; at: readonly [number, number] }>();

  /** Doors for one outline sample. False when nothing at all is in reach. */
  const doorsAt = (la: number, lo: number, reach: number): boolean => {
    const indoor = metresBetween(centroid.lat, centroid.lon, la, lo) * INDOOR;
    let found = false;
    for (const i of nodesNear(g, la, lo, reach)) {
      const hop = metresBetween(la, lo, g.lat[i]!, g.lon[i]!);
      if (hop > reach) continue;
      found = true;
      const cost = indoor + hop * OFFPATH;
      const cur = best.get(i);
      if (cur === undefined || cost < cur.cost) best.set(i, { cost, at: [la, lo] });
    }
    return found;
  };

  // Three tiers, each a FALLBACK and never a widening. A face with pavement
  // against it must never ALSO be offered a door across the lawn, because then
  // the router weighs the two against each other — and that comparison is the
  // bug this file was rewritten to remove. So a sample only looks further when
  // its own first look came back empty, and the building only looks further
  // when every sample did.
  for (const [la, lo] of outline) {
    if (!doorsAt(la, lo, PORTAL_REACH_M)) doorsAt(la, lo, FACE_RESCUE_M);
  }
  if (best.size === 0) {
    for (const [la, lo] of outline) doorsAt(la, lo, RESCUE_REACH_M);
  }

  return [...best].map(([node, { cost, at }]) => ({ node, seedCost: cost, at }));
}
