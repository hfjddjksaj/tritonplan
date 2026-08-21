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
import { type Portal, buildPortals, resampleOutline } from './walk-snap';

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
  // A COMPLEX match names its wings in `parts`; its own `name` is a shared
  // label with no polygon of its own (see `buildings.ts`).
  const rings = (hit!.parts ?? [hit!.name]).flatMap((n) => shapes.get(n)?.rings ?? []);
  if (rings.length === 0) return buildPortals(g, [[centroid.lat, centroid.lon]], centroid);
  return buildPortals(g, resampleOutline(rings), centroid);
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

const doors = new Map<string, Portal[]>();

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
    // to 89.4% and takes building-pair failure from 3.6% to 16.6% (spec §2.1).
    expect(largestComponentShare()).toBeGreaterThan(0.9);
  });

  it('still carries UCSD stairs', () => {
    // ⚠ TWO UNITS, DO NOT MIX THEM. The recon in spec §2.3 counted 322 steps
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
    // (spec §2.1, where the same sweep over 51 teaching buildings and 1275
    // pairs also measured 0.00%): degradation to a straight-line estimate is a
    // fuse for peripheral facilities, never something a student in a lecture
    // hall should ever see.
    expect(failures).toEqual([]);
  }, 120_000);

  it('reads Center Hall → Geisel as a real cross-campus walk', () => {
    const a = matchBuilding('Center Hall')!;
    const b = matchBuilding('Geisel Library')!;
    const straight = metresBetween(a.lat, a.lng, b.lat, b.lng);
    const r = routeBetween(g, doors.get('Center Hall')!, doors.get('Geisel Library')!, 'walk');
    expect(r).not.toBeNull();

    // Measured 268 m of network against a 355 m centroid-to-centroid straight
    // line — 0.76×, i.e. SHORTER than the crow flies. That is correct and not a
    // shortcut through a building: `metres` is the door-to-door leg alone
    // (walk-route.ts), and Geisel's south doors are much closer to Center Hall
    // than Geisel's centre is. Do not "fix" this bound back above 1.0× — the
    // failure worth catching is the opposite one, a network leg far LONGER than
    // the straight line, which is what leaving by the wrong face looks like.
    expect(r!.metres).toBeGreaterThan(straight * 0.5);
    expect(r!.metres).toBeLessThan(straight * 1.5);

    // `seconds`, unlike `metres`, is the whole trip including both indoor legs,
    // so crow-flies pace is a hard-ish ceiling on it: measured 307 s over a
    // 355 m straight line is 1.16 m/s, under the profile's 1.30 m/s flat speed.
    // A reading that beat it would mean the indoor cost stopped being charged.
    const pace = straight / r!.seconds;
    expect(pace).toBeLessThan(PROFILES.walk.flat);
    expect(pace).toBeGreaterThan(0.5);
  });
});
