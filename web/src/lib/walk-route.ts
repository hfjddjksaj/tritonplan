/**
 * Exact multi-source, multi-target Dijkstra over the pedestrian graph.
 *
 * ⚠ Deliberately NOT A*, and please do not "optimise" it into one. Three
 * reasons, in order of weight:
 *
 *  1. Both ends are SETS of doors (walk-snap.ts), so an admissible heuristic
 *     would have to take the minimum over every target door — weak enough that
 *     it saves little.
 *  2. It removes a whole class of silent bug. An A* whose speed upper bound is
 *     even slightly too low returns a SUB-OPTIMAL path without erroring; there
 *     is no such failure mode without a heuristic.
 *  3. We can afford it. A full relaxation of the 15.6k-node graph lands in the
 *     low single-digit milliseconds — slower than A* would be, still far inside
 *     one frame, and the user asked for correct over fast.
 */
import { type WalkGraph, metresBetween } from './walk-graph';
import { PROFILES, type Profile, edgeSeconds } from './walk-cost';
import type { Portal } from './walk-snap';

export interface WalkRoute {
  profile: Profile;
  /**
   * Length of the NETWORK leg only — deliberately EXCLUDING the indoor seed
   * cost. The gold line drawn on the map is exactly this leg, so "910 m" has
   * to match the line a reader can see.
   *
   * ⚠ `metres` and `seconds` are on different bases on purpose. See `seconds`.
   */
  metres: number;
  /**
   * Seconds for the WHOLE trip, indoor legs INCLUDED (plus any once-per-trip
   * charge such as parking a bike).
   *
   * ⚠ Yes, that is a different basis from `metres`, and it is not an
   * inconsistency to fix. Someone will eventually notice and try to make the
   * two agree; both directions of that "fix" are wrong:
   *   - dropping the indoor leg from `seconds` makes every large building read
   *     systematically optimistic (Biomedical Sciences is 143 m across, so its
   *     indoor walk alone is worth ~2 minutes);
   *   - adding the indoor leg into `metres` makes the number disagree with the
   *     line on the map, which is the one thing a reader can check by eye.
   * The two quantities answer different questions, so they count different
   * things.
   */
  seconds: number;
  /** Flights of stairs: a run of consecutive stair edges counts as ONE. */
  stepsRuns: number;
  /** Metres climbed. Descent is not subtracted — going down is not a refund. */
  ascent: number;
  /**
   * `[lon, lat]` pairs, GeoJSON order, fed straight to MapLibre.
   *
   * ⚠ Can hold a SINGLE point, and that is a real answer rather than a
   * failure: two neighbours can share a door. Mayer Hall and York Hall both
   * reach the same network node, so their cheapest route never touches the
   * network at all — 0 m of line, 81 s of indoor walking. Whatever draws this
   * has to survive a one-point path (a LineString needs two positions).
   */
  path: [number, number][];
  /** The door the route actually left by, for the A badge. */
  fromNode: number;
  /** The door it arrived at, for the B badge. */
  toNode: number;
  degraded: false;
}

export interface WalkEstimate {
  profile: Profile;
  metres: number;
  seconds: number;
  stepsRuns: 0;
  ascent: 0;
  /** Never a line. See `straightLineEstimate`. */
  path: null;
  degraded: true;
  reason: 'unreachable' | 'no-snap';
}

export type WalkResult = WalkRoute | WalkEstimate;

/**
 * Straight line → route length, fitted against this engine over 1206 teaching
 * pairs (spec §2.4; p50 detour 1.17, p90 1.28). Only used when routing fails
 * outright.
 */
export const DETOUR_K = 1.18;

/**
 * Binary min-heap of (key, value) pairs over two plain arrays.
 *
 * Lazy deletion rather than decrease-key: a relaxed node is pushed again and
 * the stale entry is skipped on pop. That trades a little memory for dropping
 * the position bookkeeping decrease-key needs, which is the usual win at this
 * size.
 */
class MinHeap {
  private k: number[] = [];
  private v: number[] = [];

  get size(): number {
    return this.k.length;
  }

  push(key: number, val: number): void {
    this.k.push(key);
    this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p]! <= this.k[i]!) break;
      this.swap(p, i);
      i = p;
    }
  }

  /** Caller must check `size` first. */
  pop(): [number, number] {
    const topK = this.k[0]!;
    const topV = this.v[0]!;
    const lastK = this.k.pop()!;
    const lastV = this.v.pop()!;
    if (this.k.length > 0) {
      this.k[0] = lastK;
      this.v[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l]! < this.k[m]!) m = l;
        if (r < this.k.length && this.k[r]! < this.k[m]!) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return [topK, topV];
  }

  private swap(a: number, b: number): void {
    const tk = this.k[a]!;
    this.k[a] = this.k[b]!;
    this.k[b] = tk;
    const tv = this.v[a]!;
    this.v[a] = this.v[b]!;
    this.v[b] = tv;
  }
}

/**
 * Cheapest door-to-door route, or `null` when there is none.
 *
 * `null` rather than a throw: an empty door set and an unreachable target are
 * ordinary outcomes on this data, and it is the CALLER that decides whether to
 * degrade to `straightLineEstimate` (spec §6).
 */
export function routeBetween(
  g: WalkGraph,
  from: readonly Portal[],
  to: readonly Portal[],
  profile: Profile,
): WalkRoute | null {
  if (from.length === 0 || to.length === 0) return null;
  const spec = PROFILES[profile];

  const dist = new Float64Array(g.n).fill(Infinity);
  const prev = new Int32Array(g.n).fill(-1);
  /**
   * Which ADJACENCY SLOT was traversed to reach each node — not just which
   * node it came from. Two ways can join the same pair of nodes (a staircase
   * beside a ramp), and only the slot knows which of them the route took, so
   * looking the edge up again by endpoints could reconstruct a length or a
   * stairs flag the router never used.
   */
  const prevEdge = new Int32Array(g.n).fill(-1);
  const heap = new MinHeap();

  // Seed costs are EQUIVALENT METRES (walk-snap.ts): the indoor leg inflated by
  // INDOOR, plus the hop out to the node. Dividing by the profile's flat speed
  // puts them in seconds, the same units the edge weights carry.
  for (const p of from) {
    const t = p.seedCost / spec.flat;
    if (t < dist[p.node]!) {
      dist[p.node] = t;
      heap.push(t, p.node);
    }
  }

  // Relaxed to exhaustion, with no early stop. Stopping early would mean
  // settling EVERY target door first, which is more code for a saving we do not
  // need at this graph size.
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (d > dist[u]!) continue; // stale entry left behind by a later relaxation
    for (let k = g.head[u]!; k < g.head[u + 1]!; k++) {
      const v = g.to[k]!;
      const w = edgeSeconds(spec, g.len[k]!, g.elev[v]! - g.elev[u]!, g.steps[k] === 1);
      // Infinity means this mode cannot use that edge at all (a bike on
      // stairs). Never relax through it — pricing it high instead would let a
      // desperate route carry a bicycle down a staircase.
      if (!Number.isFinite(w)) continue;
      const nd = d + w;
      if (nd < dist[v]!) {
        dist[v] = nd;
        prev[v] = u;
        prevEdge[v] = k;
        heap.push(nd, v);
      }
    }
  }

  // The arrival door is the one that minimises the WHOLE trip, indoor leg
  // included — not the nearest one on the network.
  let bestNode = -1;
  let bestTotal = Infinity;
  for (const p of to) {
    const total = dist[p.node]! + p.seedCost / spec.flat;
    if (total < bestTotal) {
      bestTotal = total;
      bestNode = p.node;
    }
  }
  if (bestNode < 0 || !Number.isFinite(bestTotal)) return null;

  // Walk `prev` back to whichever seeded door the route really started from.
  const nodes: number[] = [];
  const slots: number[] = [];
  for (let u = bestNode; u !== -1; u = prev[u]!) {
    nodes.push(u);
    if (prev[u] !== -1) slots.push(prevEdge[u]!);
  }
  nodes.reverse();
  slots.reverse(); // slots[i] is now the edge from nodes[i] to nodes[i + 1]

  let metres = 0;
  let ascent = 0;
  let stepsRuns = 0;
  let onStairs = false;
  for (let i = 0; i < slots.length; i++) {
    const k = slots[i]!;
    metres += g.len[k]!;
    const dh = g.elev[nodes[i + 1]!]! - g.elev[nodes[i]!]!;
    if (dh > 0) ascent += dh;
    const stair = g.steps[k] === 1;
    // One flight, not one per segment: OSM splits a single staircase into as
    // many edges as it has geometry points, so counting edges would report a
    // staircase re-drawn in more detail as more stairs to climb.
    if (stair && !onStairs) stepsRuns++;
    onStairs = stair;
  }

  return {
    profile,
    metres,
    seconds: bestTotal + spec.fixedSeconds,
    stepsRuns,
    ascent,
    path: nodes.map((i) => [g.lon[i]!, g.lat[i]!] as [number, number]),
    fromNode: nodes[0]!,
    toNode: bestNode,
    degraded: false,
  };
}

/**
 * The fallback when routing cannot answer: a straight line scaled by the
 * measured detour factor, clearly labelled as an estimate.
 *
 * ⚠ `path` is null and must stay null. Drawing the straight line would put a
 * plausible-looking gold thread across a canyon or through a building — worse
 * than drawing nothing, because the reading already admits the route is
 * unknown while the line would still look authoritative.
 */
export function straightLineEstimate(
  profile: Profile,
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  reason: 'unreachable' | 'no-snap',
): WalkEstimate {
  const spec = PROFILES[profile];
  const metres = metresBetween(a.lat, a.lon, b.lat, b.lon) * DETOUR_K;
  return {
    profile,
    metres,
    // Flat speed only: with no path there is no slope and no staircase to
    // price. The fixed charge still applies — you still have to lock the bike.
    seconds: metres / spec.flat + spec.fixedSeconds,
    stepsRuns: 0,
    ascent: 0,
    path: null,
    degraded: true,
    reason,
  };
}
