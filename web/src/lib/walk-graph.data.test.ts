/**
 * Guards the SHIPPED graph, not the decoder (`walk-graph.test.ts` does that,
 * against a hand-written three-node wire).
 *
 * A future `npm run fetch:walk-graph` runs against a live OSM that may have
 * changed: an editor can re-tag a campus lane, redraw a staircase, or move a
 * boundary, and the script would happily write a graph that decodes perfectly
 * and cannot route. These assertions are the tripwires that make such a change
 * fail loudly instead of quietly shipping a map nobody can walk across. Same
 * job as the dataset-drift guard in `buildings.test.ts`: bands calibrated on a
 * real measurement, wide enough that ordinary OSM churn passes, tight enough
 * that a structural regression does not.
 *
 * Every number below was measured against the graph fetched 2026-08-21
 * (15,643 nodes / 17,327 edges). Recomputing them after a legitimate refetch is
 * fine; widening a band to make a red test go green is how the guard dies.
 */
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import wire from '../data/ucsd-walk-graph.json';
import { matchBuilding } from './buildings';
import { type CampusShape, loadCampusGeo } from './campus-geo';
import { PROFILES } from './walk-cost';
import { type WalkGraphWire, decodeWalkGraph, metresBetween } from './walk-graph';
import { routeBetween } from './walk-route';
import { FACE_RESCUE_M, type Portal, buildPortals, resampleOutline } from './walk-snap';

const g = decodeWalkGraph(wire as WalkGraphWire);

/**
 * Buildings TSS actually schedules classes into — the promise this feature
 * makes is about these, not about the whole campus.
 *
 * Names are official `FacilityLongName`s (or aliases `buildings.ts` resolves),
 * so `matchBuilding` has to find every one of them; a null here is a broken
 * list, not a reason to skip a pair. Peripheral facilities are deliberately
 * absent: 182 of the 608 bundled footprints sit outside the graph's bbox and
 * get no doors at all — Scripps on the shore is the standing example — and
 * none of those hosts a lecture. A "teaching building" that comes back with no
 * doors is therefore the wrong entry for this list, not a hole in the graph.
 */
const TEACHING = [
  'Center Hall',
  'Peterson Hall',
  'Warren Lecture Hall',
  'York Hall',
  'Solis Hall',
  'Galbraith Hall',
  'Mandeville Center',
  'Pepper Canyon Hall',
  'Computer Science and Engineering Building',
  'Jacobs Hall',
  'Applied Physics and Mathematics Building',
  // ⚠ This entry and `McGill Hall` below are substitutions, made 2026-08-21.
  // The list originally read `Sequoyah Hall` and `Literature Building`, and the
  // official GIS layer in `ucsd-buildings.json` carries no record under either
  // name — not an alias, not a truncated prefix — so `matchBuilding` returned
  // null and the sweep never ran. Both were swapped for a lecture building the
  // dataset does have in the same corner of campus (Ridge Walk, and Muir),
  // because a name nothing resolves tests this list, not the graph.
  'Ridge Walk Academic Building',
  'Humanities and Social Sciences',
  'McGill Hall',
  'Price Center West',
  'Mayer Hall',
  'Urey Hall',
  'Bonner Hall',
  'Natural Sciences Building',
  'Atkinson Hall',
  'Geisel Library',
  'Otterson Hall',
] as const;

/**
 * Doors built the way `useWalkRoute` builds them in the browser: off the real
 * footprint rings, falling back to the bare centroid only when the GIS layer
 * has no polygon under that name.
 *
 * Deliberately not the cheaper centroid-only version. A centroid seeds doors in
 * a 45 m bubble around one point, which is a different — and much easier —
 * question than the one the app asks: Center Hall's footprint yields 75 doors,
 * Geisel 269 and Price Center West 375, and it is those door SETS the router
 * picks between. A guard that never walks an outline could stay green while
 * the shipped feature stopped snapping large buildings entirely.
 */
function doorsFor(name: string, shapes: Map<string, CampusShape>): Portal[] {
  const hit = matchBuilding(name);
  expect(hit, `no building record for ${name}`).not.toBeNull();
  const centroid = { lat: hit!.lat, lon: hit!.lng };
  centroids.set(name, centroid);
  // A COMPLEX match names its wings in `parts`; its own `name` is a shared
  // label with no polygon of its own (see `buildings.ts`).
  const rings = (hit!.parts ?? [hit!.name]).flatMap((n) => shapes.get(n)?.rings ?? []);
  const outline: [number, number][] =
    rings.length === 0 ? [[centroid.lat, centroid.lon]] : resampleOutline(rings);
  outlines.set(name, outline);
  return buildPortals(g, outline, centroid);
}

/** Metres from a point to the nearest sample on that building's outline. */
function toOutline(name: string, lat: number, lon: number): number {
  let best = Infinity;
  for (const [la, lo] of outlines.get(name)!) {
    const d = metresBetween(lat, lon, la, lo);
    if (d < best) best = d;
  }
  return best;
}

/** Share of nodes in the largest connected component, by flood fill. */
function largestComponentShare(): number {
  const seen = new Int32Array(g.n).fill(-1);
  let largest = 0;
  for (let s = 0; s < g.n; s++) {
    if (seen[s] !== -1) continue;
    let size = 0;
    const stack = [s];
    seen[s] = s;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (let k = g.head[u]!; k < g.head[u + 1]!; k++) {
        const v = g.to[k]!;
        if (seen[v] === -1) {
          seen[v] = s;
          stack.push(v);
        }
      }
    }
    if (size > largest) largest = size;
  }
  return largest / g.n;
}

/**
 * How close two footprints must be for "Next door" to be an honest thing to
 * say. Wall to wall — a reader stepping out of one and into the other.
 */
const NEXT_DOOR_M = 25;

const doors = new Map<string, Portal[]>();
const outlines = new Map<string, [number, number][]>();
const centroids = new Map<string, { lat: number; lon: number }>();

beforeAll(async () => {
  const geo = await loadCampusGeo();
  const shapes = new Map(geo.footprints.map((f) => [f.name, f]));
  for (const name of TEACHING) doors.set(name, doorsFor(name, shapes));
}, 60_000);

describe('the shipped walk graph', () => {
  it('is one connected campus, not an archipelago', () => {
    // Measured 95.0% (14,861 of 15,643) on 2026-08-21, over 39 components.
    // Below 90% means the source fragmented — most likely because the fetch
    // query lost the campus SERVICE/RESIDENTIAL roads, which alone drops this
    // to 89.4% and takes building-pair failure from 3.6% to 16.6%.
    expect(largestComponentShare()).toBeGreaterThan(0.9);
  });

  it('still carries UCSD stairs', () => {
    // ⚠ TWO UNITS, DO NOT MIX THEM. The OSM recon counted 322 steps
    // WAYS; the decoded graph only knows EDGES, and those 322 ways carry 430
    // SEGMENTS (273 of the ways are plain 2-point ways, 49 have more geometry).
    // So the fetch script's own health check bands 250–400 on WAYS, and this
    // one bands 350–520 on SEGMENTS — the two numbers are not comparable and
    // copying either band across to the other side is a guaranteed false
    // failure. `g.steps` indexes adjacency SLOTS, of which each edge has two
    // (the graph is undirected), hence the /2.
    const stairs = [...g.steps].reduce<number>((t, s) => t + s, 0) / 2;
    expect(stairs).toBeGreaterThan(350);
    expect(stairs).toBeLessThan(520);
  });

  it('stays small enough to lazy-load without thought', () => {
    // 91,321 bytes gzip on 2026-08-21, at SCALE 1e6 — comfortably inside the
    // 100 KB budget, so there is no reason to coarsen the grid to 1e5.
    expect(gzipSync(JSON.stringify(wire)).length).toBeLessThan(100 * 1024);
  });

  it('has plausible elevations for coastal San Diego', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const e of g.elev) {
      if (e < min) min = e;
      if (e > max) max = e;
    }
    // Measured 18 m to 136 m: the campus runs from the canyon floors up to the
    // Ridge Walk mesa. A DEM read with the wrong byte order or a missing tile
    // shows up here first, as a −32768 or a five-digit peak.
    expect(min).toBeGreaterThan(-15);
    expect(max).toBeLessThan(200);
  });

  it('routes between every pair of teaching buildings', () => {
    const failures: string[] = [];
    for (let i = 0; i < TEACHING.length; i++) {
      for (let j = i + 1; j < TEACHING.length; j++) {
        const a = TEACHING[i]!;
        const b = TEACHING[j]!;
        const from = doors.get(a)!;
        const to = doors.get(b)!;
        if (from.length === 0) failures.push(`${a} (no door)`);
        else if (to.length === 0) failures.push(`${b} (no door)`);
        else if (routeBetween(g, from, to, 'walk') === null) failures.push(`${a} → ${b}`);
      }
    }
    // 0 failures over all 231 pairs. This is the core promise of the feature
    // (a wider sweep over 51 teaching buildings and 1275 pairs also measured
    // 0.00%): degradation to a straight-line estimate is a
    // fuse for peripheral facilities, never something a student in a lecture
    // hall should ever see.
    expect(failures).toEqual([]);
  }, 120_000);

  /**
   * The line a reader sees has to START AT THE BUILDING. This is the guard for
   * the door-pricing bug fixed 2026-08-23: `hop` — the straight jump from the
   * footprint out to a network node — used to be charged at 1.0, i.e. free,
   * while the indoor leg beside it was charged at INDOOR. A free 45 m jump
   * buys more than 45 m: it lets a route SKIP a real detour, so the router
   * preferred a door 32 m out in a field (median over these same pairs) to one
   * against the wall, and drew a gold line starting nowhere near the building.
   *
   * Two bounds, because they fail for different reasons:
   *  - the hard one catches the reach constants being widened again;
   *  - the median catches OFFPATH being dropped back to 1.0, which leaves the
   *    reach intact but goes back to preferring the far door inside it
   *    (measured: p50 2.6 m at OFFPATH 4, 5.1 m at OFFPATH 1).
   */
  it('draws a line that starts and ends AT the buildings', () => {
    const detached: string[] = [];
    const hops: number[] = [];
    const longHops: string[] = [];

    for (let i = 0; i < TEACHING.length; i++) {
      for (let j = 0; j < TEACHING.length; j++) {
        if (i === j) continue;
        const a = TEACHING[i]!;
        const b = TEACHING[j]!;
        const r = routeBetween(g, doors.get(a)!, doors.get(b)!, 'walk');
        if (!r) continue; // the all-pairs test above owns routing failures
        const first = r.path[0]!;
        const last = r.path[r.path.length - 1]!;

        // (1) STRUCTURAL. The ends of the line are outline samples, so this is
        // 0 — or, when the hop rounded away, the node it collapsed onto, which
        // is under half a metre from one. Nothing else may reach this array.
        const gapA = toOutline(a, first[1], first[0]);
        const gapB = toOutline(b, last[1], last[0]);
        if (gapA > 0.6) detached.push(`${a} → ${b} starts ${gapA.toFixed(1)} m off the wall`);
        if (gapB > 0.6) detached.push(`${a} → ${b} ends ${gapB.toFixed(1)} m off the wall`);

        // (2) THE HOP ITSELF, which is what OFFPATH prices. The line reaching
        // the wall is not enough: with the hop free again the door drifts back
        // out into the field and the first segment becomes a long straight
        // stroke over a lawn — the same lie, now drawn instead of hidden.
        const hopA = metresBetween(first[1], first[0], g.lat[r.fromNode]!, g.lon[r.fromNode]!);
        const hopB = metresBetween(last[1], last[0], g.lat[r.toNode]!, g.lon[r.toNode]!);
        hops.push(hopA, hopB);
        if (hopA > FACE_RESCUE_M + 0.5) longHops.push(`${a} → ${b} hops ${hopA.toFixed(0)} m out`);
        if (hopB > FACE_RESCUE_M + 0.5) longHops.push(`${a} → ${b} hops ${hopB.toFixed(0)} m in`);
      }
    }

    expect(detached).toEqual([]);
    // No teaching building needs the whole-building RESCUE_REACH_M (measured
    // 2026-08-23), so FACE_RESCUE_M is the ceiling: a wall with no pavement
    // inside PORTAL_REACH_M may reach twice as far, and nothing further.
    expect(longHops).toEqual([]);

    hops.sort((x, y) => x - y);
    const p50 = hops[Math.floor(hops.length / 2)]!;
    // Measured 2.6 m across all 462 ordered pairs. The door sat 30.1 m out
    // before the fix, and 5.1 m with the reach tightened but OFFPATH left at
    // 1.0 — so 4 m passes ordinary OSM churn and fails a re-freed hop.
    expect(p50).toBeLessThan(4);
  }, 120_000);

  /**
   * "Next door" is a real answer — Mayer Hall and York Hall genuinely share a
   * network node — but it used to fire for buildings a long walk apart, because
   * two 45 m door bubbles could overlap across a whole courtyard. 17 of these
   * 231 pairs read "0 m / Next door" on 2026-08-21; Geisel Library ↔ Price
   * Center West, 208 m apart, was the worst of them.
   */
  it('only says "next door" about buildings that really are next door', () => {
    const liars: string[] = [];
    const seen: string[] = [];
    for (let i = 0; i < TEACHING.length; i++) {
      for (let j = i + 1; j < TEACHING.length; j++) {
        const a = TEACHING[i]!;
        const b = TEACHING[j]!;
        const r = routeBetween(g, doors.get(a)!, doors.get(b)!, 'walk');
        if (!r || r.metres >= 1) continue; // NEAR_M in DistanceBar.tsx
        // Wall to wall, not centre to centre: Mayer Hall and York Hall are 95 m
        // apart by centroid and yet their footprints very nearly touch, which
        // is exactly the case the copy is FOR.
        let apart = Infinity;
        for (const [la, lo] of outlines.get(a)!) {
          const d = toOutline(b, la, lo);
          if (d < apart) apart = d;
        }
        seen.push(`${a} ↔ ${b}: walls ${apart.toFixed(0)} m`);
        if (apart > NEXT_DOOR_M) liars.push(`${a} ↔ ${b} (walls ${apart.toFixed(0)} m apart)`);
      }
    }
    console.log(`"next door" pairs:\n  ${seen.join('\n  ')}`);
    expect(liars).toEqual([]);
  }, 120_000);

  it('reads Center Hall → Geisel as a real cross-campus walk', () => {
    const a = matchBuilding('Center Hall')!;
    const b = matchBuilding('Geisel Library')!;
    const straight = metresBetween(a.lat, a.lng, b.lat, b.lng);
    const r = routeBetween(g, doors.get('Center Hall')!, doors.get('Geisel Library')!, 'walk');
    expect(r).not.toBeNull();

    // Measured 338 m of outdoor leg against a 355 m centroid-to-centroid
    // straight line — 0.95×, i.e. slightly SHORTER than the crow flies. That is
    // correct and not a shortcut through a building: `metres` is the wall-to-
    // wall leg alone (walk-route.ts), and Geisel's south doors are much closer
    // to Center Hall than Geisel's centre is. Do not "fix" this bound back
    // above 1.0× — the failure worth catching is the opposite one, a leg far
    // LONGER than the straight line, which is what leaving by the wrong face
    // looks like. (It read 268 m / 0.76× until 2026-08-23, when the two hops
    // out to the pavement stopped being counted as zero distance.)
    expect(r!.metres).toBeGreaterThan(straight * 0.5);
    expect(r!.metres).toBeLessThan(straight * 1.5);

    // `seconds`, unlike `metres`, is the whole trip including both indoor legs,
    // so crow-flies pace is a hard-ish ceiling on it: measured 341 s over a
    // 355 m straight line is 1.04 m/s, under the profile's 1.30 m/s flat speed.
    // A reading that beat it would mean the indoor cost stopped being charged.
    const pace = straight / r!.seconds;
    expect(pace).toBeLessThan(PROFILES.walk.flat);
    expect(pace).toBeGreaterThan(0.5);
  });
});
