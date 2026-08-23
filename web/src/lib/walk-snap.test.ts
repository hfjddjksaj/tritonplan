import { describe, expect, it } from 'vitest';
import { decodeWalkGraph } from './walk-graph';
import {
  FACE_RESCUE_M,
  INDOOR,
  OFFPATH,
  PORTAL_REACH_M,
  RESCUE_REACH_M,
  buildPortals,
  resampleOutline,
} from './walk-snap';

/** Four nodes in a line, `stepM` apart, running east from (32.880, -117.2400). */
function lineGraph(stepM = 30) {
  const step = Math.round((stepM / (111_320 * Math.cos((32.881 * Math.PI) / 180))) * 1e6);
  return decodeWalkGraph({
    source: 't',
    fetched: 'x',
    bbox: [],
    nodes: [-117_240_000, 32_880_000, step, 0, step, 0, step, 0],
    elev: [0, 0, 0, 0],
    // (a delta, b): (0,1) then a+=1 -> (1,2) then a+=1 -> (2,3) — a plain chain
    edges: [0, 1, 1, 2, 1, 3],
    steps: [],
  });
}

describe('resampleOutline', () => {
  it('inserts points along a long wall instead of only keeping vertices', () => {
    // One 60 m wall as a 2-vertex degenerate ring, lon/lat pairs.
    const dLon = 60 / (111_320 * Math.cos((32.881 * Math.PI) / 180));
    const ring = [
      [-117.24, 32.88],
      [-117.24 + dLon, 32.88],
    ].flat();
    const pts = resampleOutline([ring], 10);
    // 2 vertices -> at least 6 points once 10 m spacing is applied both ways
    expect(pts.length).toBeGreaterThanOrEqual(10);
  });

  it('returns [lat, lon], not the [lon, lat] the ring came in as', () => {
    // A swap here would put every door in Kansas and still "work".
    const pts = resampleOutline([[-117.24, 32.88, -117.2399, 32.8801]], 10);
    expect(pts.length).toBeGreaterThan(0);
    for (const [la, lo] of pts) {
      expect(la).toBeCloseTo(32.88, 3);
      expect(lo).toBeCloseTo(-117.24, 3);
    }
  });
});

describe('buildPortals', () => {
  it('offers every node within reach as a door, not just the nearest one', () => {
    // 6 m spacing: PORTAL_REACH_M is 8 m, so more than one node is in reach.
    const g = lineGraph(6);
    const outline = resampleOutline([[-117.24, 32.88, -117.24, 32.8801]], 10);
    const portals = buildPortals(g, outline, { lat: 32.88, lon: -117.24 });
    expect(portals.length).toBeGreaterThan(1);
    expect(portals.every((p) => p.node >= 0 && p.node < g.n)).toBe(true);
  });

  it('charges an indoor cost that grows with distance from the centroid', () => {
    const g = lineGraph();
    const outline = resampleOutline([[-117.24, 32.88, -117.2396, 32.88]], 10);
    const centroid = { lat: 32.88, lon: -117.24 };
    const portals = buildPortals(g, outline, centroid).sort((a, b) => a.node - b.node);
    // Node 0 sits on the centroid; node 1 is 30 m east. The far door must cost more.
    const near = portals.find((p) => p.node === 0)!;
    const far = portals.find((p) => p.node === 1)!;
    expect(near.seedCost).toBeLessThan(far.seedCost);
    // and the indoor leg is inflated by INDOOR, not counted raw
    expect(far.seedCost).toBeGreaterThan(30 * 0.9);
  });

  it('never seeds a door for free — that would teleport inside the building', () => {
    const g = lineGraph();
    const outline = resampleOutline([[-117.2396, 32.88, -117.2392, 32.88]], 10);
    // centroid far from the outline: every door must carry real cost
    const portals = buildPortals(g, outline, { lat: 32.88, lon: -117.24 });
    expect(portals.length).toBeGreaterThan(0);
    expect(portals.every((p) => p.seedCost > 0)).toBe(true);
  });

  it('returns nothing when no node is within reach', () => {
    const g = lineGraph();
    // 1 km north of the graph
    const outline = resampleOutline([[-117.24, 32.889, -117.2399, 32.889]], 10);
    expect(buildPortals(g, outline, { lat: 32.889, lon: -117.24 })).toEqual([]);
  });

  /**
   * The hop used to be free, and a free 45 m jump is what made the router
   * prefer a door out in a field to one against the wall. These four tests are
   * the unit-level half of that guard; `walk-graph.data.test.ts` owns what it
   * does to real routes.
   */
  it('charges the hop as off-network ground, not as pavement', () => {
    const g = lineGraph(6);
    // Two outline points on the same wall: one right on node 0, one 6 m north
    // of it. Same indoor leg (both are the centroid), so the only difference
    // between their doors is the hop.
    const north = 6 / 111_320;
    const centroid = { lat: 32.88, lon: -117.24 };
    const onNode = buildPortals(g, [[32.88, -117.24]], centroid);
    const setBack = buildPortals(g, [[32.88 + north, -117.24]], centroid);

    const a = onNode.find((p) => p.node === 0)!;
    const b = setBack.find((p) => p.node === 0)!;
    expect(a.seedCost).toBeCloseTo(0, 3);
    // 6 m of hop, billed at OFFPATH — plus the indoor leg out to that sample.
    expect(b.seedCost).toBeCloseTo(6 * INDOOR + 6 * OFFPATH, 0);
  });

  it('remembers the wall it was priced from, so the line can start there', () => {
    const g = lineGraph(6);
    const outline = resampleOutline([[-117.24, 32.88, -117.24, 32.8801]], 10);
    for (const p of buildPortals(g, outline, { lat: 32.88, lon: -117.24 })) {
      expect(outline).toContainEqual([p.at[0], p.at[1]]);
    }
  });

  it('lets a face with nothing in reach look twice as far', () => {
    const g = lineGraph(12);
    const centroid = { lat: 32.88, lon: -117.24 };
    // A wall set back 12 m from the line of nodes: past PORTAL_REACH_M (8),
    // inside FACE_RESCUE_M (16). Without the per-face tier it would be doorless
    // and the route would have to go round.
    const setBack: [number, number][] = [[32.88 + 12 / 111_320, -117.24]];
    expect(buildPortals(g, setBack, centroid).length).toBeGreaterThan(0);

    // 30 m out is past FACE_RESCUE_M too, so only the whole-building last
    // resort can reach it — and it does, because the building has no other face.
    const wayOut: [number, number][] = [[32.88 + 30 / 111_320, -117.24]];
    expect(buildPortals(g, wayOut, centroid).length).toBeGreaterThan(0);

    // Past RESCUE_REACH_M there is genuinely nothing to offer.
    const offCampus: [number, number][] = [[32.88 + 200 / 111_320, -117.24]];
    expect(buildPortals(g, offCampus, centroid)).toEqual([]);
  });

  it('never lets a face that already has a door reach for a second, further one', () => {
    // Node 0 is on the wall; node 1 is 12 m east — inside FACE_RESCUE_M but
    // outside PORTAL_REACH_M. The near face must not pick it up.
    const g = lineGraph(12);
    const doors = buildPortals(g, [[32.88, -117.24]], { lat: 32.88, lon: -117.24 });
    expect(doors.map((p) => p.node)).toEqual([0]);
  });

  it('exposes the constants the spec pins down', () => {
    expect(PORTAL_REACH_M).toBe(8);
    expect(FACE_RESCUE_M).toBe(2 * PORTAL_REACH_M);
    expect(RESCUE_REACH_M).toBe(45);
    expect(INDOOR).toBe(1.2);
    expect(OFFPATH).toBe(4);
  });
});
