import { describe, expect, it } from 'vitest';
import { type WalkGraph, decodeWalkGraph } from './walk-graph';
import { PROFILES, type Profile, edgeSeconds } from './walk-cost';
import type { Portal } from './walk-snap';
import { DETOUR_K, routeBetween, straightLineEstimate } from './walk-route';

/** One node step east, ~100 m at UCSD's latitude. */
const DLON = Math.round((100 / (111_320 * Math.cos((32.881 * Math.PI) / 180))) * 1e6);

/**
 * Four fixed positions every fixture below shares:
 *
 *   0 ——100m—— 1 ——100m—— 2      (the "top" route: 200.1 m)
 *    \                    /
 *     ——— 3 ———                  (node 3 sits 111 m SOUTH of node 1;
 *                                 0–3 and 2–3 are 149.7 m each, so the
 *                                 "bottom" route is 299.3 m)
 */
const NODES = [-117_240_000, 32_880_000, DLON, 0, DLON, 0, -DLON, -1000];

/**
 * Hand-build a wire payload. Delta encoding inline is unreadable and easy to
 * get quietly wrong, so the fixtures name their edges as plain pairs and this
 * does the encoding — including the sort the decoder's delta scheme assumes.
 */
function wire(edges: [number, number][], steps: number[], elev: number[]) {
  const sorted = [...edges].sort((m, n) => (m[0] !== n[0] ? m[0] - n[0] : m[1] - n[1]));
  const flat: number[] = [];
  let prevA = 0;
  for (const [a, b] of sorted) {
    flat.push(a - prevA, b);
    prevA = a;
  }
  const delta = (values: number[]) => {
    const out: number[] = [];
    let prev = 0;
    for (const v of values) {
      out.push(v - prev);
      prev = v;
    }
    return out;
  };
  return { flat, stepDeltas: delta(steps), elevDeltas: delta(elev), sorted };
}

/** `steps` indexes the SORTED edge list — see each fixture's own table. */
function graphOf(edges: [number, number][], steps: number[] = [], elev = [0, 0, 0, 0]): WalkGraph {
  const { flat, stepDeltas, elevDeltas } = wire(edges, steps, elev);
  return decodeWalkGraph({
    source: 't',
    fetched: 'x',
    bbox: [],
    nodes: NODES,
    elev: elevDeltas,
    edges: flat,
    steps: stepDeltas,
  });
}

/**
 * The diamond. Sorted edge order — the indices `steps` refers to — is
 * `0:[0,1]  1:[0,3]  2:[1,2]  3:[2,3]`, i.e. the TOP route is 0 and 2 and the
 * BOTTOM route is 1 and 3. (Not adjacent pairs: the sort is by endpoint, not
 * by route.)
 */
const grid4 = (steps: number[] = [], elev = [0, 0, 0, 0]) =>
  graphOf(
    [
      [0, 1],
      [1, 2],
      [0, 3],
      [2, 3],
    ],
    steps,
    elev,
  );

/** NODES decoded, so a fixture door can be placed exactly on its own node. */
const POS: [number, number][] = (() => {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < NODES.length / 2; i++) {
    x += NODES[2 * i]!;
    y += NODES[2 * i + 1]!;
    out.push([y / 1e6, x / 1e6]);
  }
  return out;
})();

/**
 * A door standing exactly ON its node: zero hop, so these fixtures measure
 * routing and nothing else. Hop pricing belongs to `walk-snap.test.ts`, and
 * what a hop does to a real route belongs to `walk-graph.data.test.ts`; the
 * one test here that cares owns its own portals.
 */
const door = (node: number, seedCost = 0): Portal => ({ node, seedCost, at: POS[node]! });
const at = (node: number, seedCost = 0): Portal[] => [door(node, seedCost)];

/**
 * The optimum by exhaustive enumeration of every simple path, seeds included
 * and the fixed per-trip charge excluded. This is the whole point of choosing
 * Dijkstra over A*: on a graph small enough to enumerate, "shortest" has an
 * answer that owes nothing to a heuristic.
 */
function bruteForceSeconds(
  g: WalkGraph,
  from: readonly Portal[],
  to: readonly Portal[],
  profile: Profile,
): number {
  const spec = PROFILES[profile];
  const targets = new Map(to.map((p) => [p.node, p.seedCost]));
  let best = Infinity;
  const visit = (u: number, cost: number, seen: Set<number>) => {
    const seed = targets.get(u);
    if (seed !== undefined) best = Math.min(best, cost + seed / spec.flat);
    for (let k = g.head[u]!; k < g.head[u + 1]!; k++) {
      const v = g.to[k]!;
      if (seen.has(v)) continue;
      const w = edgeSeconds(spec, g.len[k]!, g.elev[v]! - g.elev[u]!, g.steps[k] === 1);
      if (!Number.isFinite(w)) continue;
      seen.add(v);
      visit(v, cost + w, seen);
      seen.delete(v);
    }
  };
  for (const p of from) visit(p.node, p.seedCost / spec.flat, new Set([p.node]));
  return best;
}

describe('routeBetween', () => {
  it('finds the shortest of two competing routes', () => {
    const g = grid4();
    const r = routeBetween(g, at(0), at(2), 'walk')!;
    expect(r).not.toBeNull();
    expect(r.degraded).toBe(false);
    // top route is 2 x 100 m; the bottom one detours south, so it is 299 m
    expect(r.metres).toBeCloseTo(200, 0);
    expect(r.path).toHaveLength(3);
    expect(r.fromNode).toBe(0);
    expect(r.toNode).toBe(2);
  });

  it('emits the path as [lon, lat], the order MapLibre wants', () => {
    // A flip here would still round-trip through g.lon/g.lat and "work".
    const r = routeBetween(grid4(), at(0), at(2), 'walk')!;
    for (const [lon, lat] of r.path) {
      expect(lon).toBeCloseTo(-117.239, 2);
      expect(lat).toBeCloseTo(32.88, 3);
    }
  });

  it('picks the door that makes the whole trip cheapest, not the nearest door', () => {
    const g = grid4();
    // A door at node 3 is geometrically close but costs 500 to reach from
    // inside; the door at node 0 costs 1. The engine must take node 0.
    const r = routeBetween(
      g,
      [door(3, 500), door(0, 1)],
      at(2),
      'walk',
    )!;
    expect(r.fromNode).toBe(0);
  });

  it('routes a bike around stairs even when that is longer', () => {
    // Stairs on the TOP route: sorted indices 0 = [0,1] and 2 = [1,2].
    const g = grid4([0, 2]);
    const bike = routeBetween(g, at(0), at(2), 'bike')!;
    expect(bike).not.toBeNull();
    expect(bike.stepsRuns).toBe(0);
    // It went the long way round, through node 3.
    expect(bike.path[1]).toEqual([g.lon[3], g.lat[3]]);
    expect(bike.metres).toBeCloseTo(299, 0);
  });

  it('gives up rather than carrying a bike down the only staircase', () => {
    const g = grid4([0, 1, 2, 3]); // every edge is stairs
    expect(routeBetween(g, at(0), at(2), 'bike')).toBeNull();
    expect(routeBetween(g, at(0), at(2), 'walk')).not.toBeNull();
  });

  it('counts a run of consecutive stair edges as one flight', () => {
    // A bare chain 0—1—2 with both edges stairs: no alternative to compare
    // against, so the route really does climb them.
    const g = graphOf(
      [
        [0, 1],
        [1, 2],
      ],
      [0, 1],
    );
    const r = routeBetween(g, at(0), at(2), 'walk')!;
    expect(r.path).toHaveLength(3);
    expect(r.stepsRuns).toBe(1);
    expect(r.seconds).toBeCloseTo(200.06 / PROFILES.walk.stepsUp, 0);
  });

  it('counts two flights when flat ground separates them', () => {
    // Chain 0—1—2—3 with stairs at each end (sorted: 0:[0,1] 1:[1,2] 2:[2,3]).
    const g = graphOf(
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
      [0, 2],
    );
    const r = routeBetween(g, at(0), at(3), 'walk')!;
    expect(r.path).toHaveLength(4);
    expect(r.stepsRuns).toBe(2);
  });

  it('sums only the climbing, never the descent, into ascent', () => {
    const g = grid4([], [0, 10, 4, 0]); // 0 -> 1 climbs 10, 1 -> 2 drops 6
    const r = routeBetween(g, at(0), at(2), 'walk')!;
    expect(r.path).toHaveLength(3);
    expect(r.ascent).toBeCloseTo(10, 5);
  });

  it('keeps metres to the network and seconds inclusive of the indoor seed', () => {
    // ⚠ The two are on different bases on purpose (see walk-route.ts). This
    // test exists to stop anyone "fixing" them into agreement.
    const g = grid4();
    const bare = routeBetween(g, at(0), at(2), 'walk')!;
    const seeded = routeBetween(g, at(0, 130), at(2), 'walk')!;
    expect(seeded.metres).toBeCloseTo(bare.metres, 6); // the line on the map is the same
    expect(seeded.seconds).toBeGreaterThan(bare.seconds); // but the trip is longer
  });

  it('converts a seed from equivalent metres at the profile flat speed', () => {
    const g = grid4();
    const bare = routeBetween(g, at(0), at(2), 'walk')!;
    const seeded = routeBetween(g, at(0, 130), at(2, 65), 'walk')!;
    expect(seeded.seconds - bare.seconds).toBeCloseTo(195 / PROFILES.walk.flat, 6);
  });

  it('adds the bike parking charge once, not per edge', () => {
    const g = grid4();
    const r = routeBetween(g, at(0), at(2), 'bike')!;
    const rideOnly = 200 / PROFILES.bike.flat;
    expect(r.seconds).toBeCloseTo(rideOnly + 120, 0);
  });

  it('matches a brute-force search over every simple path, on every profile', () => {
    // Stairs on the bottom route's 0—3 leg, a hill along the top one, and doors
    // priced differently at both ends: enough asymmetry that a wrong tie-break
    // or a missed relaxation would show up.
    const g = grid4([1], [0, 10, 4, 0]);
    const from: Portal[] = [
      door(0, 12),
      door(3, 40),
    ];
    const to: Portal[] = [
      door(2, 5),
      door(1, 60),
    ];
    for (const profile of ['walk', 'bike', 'scooter'] as const) {
      const r = routeBetween(g, from, to, profile)!;
      expect(r).not.toBeNull();
      expect(r.seconds - PROFILES[profile].fixedSeconds).toBeCloseTo(
        bruteForceSeconds(g, from, to, profile),
        9,
      );
    }
  });

  it('returns a bare indoor walk when both buildings share a door', () => {
    // Rare since the 2026-08-23 door-pricing fix but still real: two footprints
    // that TOUCH can share a node with no hop at either end, and then the
    // cheapest route never reaches the network. The outdoor leg is honestly
    // 0 m and the path is one point — the drawing code has to cope, so the
    // engine must not pretend otherwise.
    const g = grid4();
    const r = routeBetween(g, at(1, 60), at(1, 45), 'walk')!;
    expect(r).not.toBeNull();
    expect(r.metres).toBe(0);
    expect(r.path).toEqual([[g.lon[1], g.lat[1]]]);
    expect(r.fromNode).toBe(1);
    expect(r.toNode).toBe(1);
    expect(r.seconds).toBeCloseTo(105 / PROFILES.walk.flat, 6);
  });

  /**
   * The regression guard for the bug reported 2026-08-23: the gold line began
   * and ended at network NODES, so it floated tens of metres from the very
   * buildings it claimed to join. The hop from the wall to the node is
   * ordinary outdoor walking and is charged in seedCost, so it belongs on the
   * line and in `metres` — draw what you charge for.
   */
  it('starts on the wall it left, not on the node it snapped to', () => {
    const g = grid4();
    // Doors 30 m south of nodes 0 and 2 — a wall set back from the pavement.
    const SOUTH = 30 / 111_320;
    const from: Portal[] = [{ node: 0, seedCost: 40, at: [POS[0]![0] - SOUTH, POS[0]![1]] }];
    const to: Portal[] = [{ node: 2, seedCost: 40, at: [POS[2]![0] - SOUTH, POS[2]![1]] }];

    const r = routeBetween(g, from, to, 'walk')!;
    expect(r).not.toBeNull();
    // Two extra positions, one at each end, ahead of and behind the 3 nodes.
    expect(r.path).toHaveLength(5);
    expect(r.path[0]).toEqual([from[0]!.at[1], from[0]!.at[0]]);
    expect(r.path[4]).toEqual([to[0]!.at[1], to[0]!.at[0]]);
    // 200 m of network plus 30 m of hop at each end.
    expect(r.metres).toBeCloseTo(260, 0);
    // The badges still name the NODES, which is what the router settled on.
    expect(r.fromNode).toBe(0);
    expect(r.toNode).toBe(2);
  });

  it('leaves a hop under half a metre off the line rather than doubling a point', () => {
    const g = grid4();
    // 10 cm of quantisation noise is not a step anybody takes.
    const from: Portal[] = [{ node: 0, seedCost: 1, at: [POS[0]![0] - 0.1 / 111_320, POS[0]![1]] }];
    const r = routeBetween(g, from, at(2), 'walk')!;
    expect(r.path).toHaveLength(3);
    expect(r.metres).toBeCloseTo(200, 0);
  });

  it('returns null when the target is unreachable', () => {
    const g = graphOf([[0, 1]]); // nodes 2 and 3 are islands
    expect(routeBetween(g, at(0), at(2), 'walk')).toBeNull();
  });

  it('returns null for an empty door set on either end', () => {
    const g = grid4();
    expect(routeBetween(g, [], at(2), 'walk')).toBeNull();
    expect(routeBetween(g, at(0), [], 'walk')).toBeNull();
  });
});

describe('straightLineEstimate', () => {
  it('scales the straight line by the measured detour factor', () => {
    const e = straightLineEstimate(
      'walk',
      { lat: 32.88, lon: -117.24 },
      { lat: 32.881, lon: -117.24 },
      'unreachable',
    );
    expect(e.degraded).toBe(true);
    expect(e.reason).toBe('unreachable');
    expect(e.metres).toBeCloseTo(111.32 * DETOUR_K, 0);
    expect(e.seconds).toBeCloseTo((111.32 * DETOUR_K) / PROFILES.walk.flat, 0);
  });

  it('never hands back a line to draw, however plausible one would look', () => {
    const e = straightLineEstimate(
      'walk',
      { lat: 32.88, lon: -117.24 },
      { lat: 32.885, lon: -117.235 },
      'no-snap',
    );
    expect(e.path).toBeNull();
    expect(e.stepsRuns).toBe(0);
    expect(e.ascent).toBe(0);
    expect(e.reason).toBe('no-snap');
  });

  it('still charges a bike for parking, with no path to price', () => {
    const a = { lat: 32.88, lon: -117.24 };
    const b = { lat: 32.881, lon: -117.24 };
    const e = straightLineEstimate('bike', a, b, 'unreachable');
    expect(e.seconds).toBeCloseTo(e.metres / PROFILES.bike.flat + 120, 6);
  });

  it('uses 1.18, the factor fitted against the routing engine', () => {
    expect(DETOUR_K).toBe(1.18);
  });
});
