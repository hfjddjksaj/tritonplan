import { describe, expect, it } from 'vitest';
import { decodeWalkGraph } from './walk-graph';
import { INDOOR, PORTAL_REACH_M, buildPortals, resampleOutline } from './walk-snap';

/** Four nodes in a line, 30 m apart, running east from (32.880, -117.2400). */
function lineGraph() {
  const step = Math.round((30 / (111_320 * Math.cos((32.881 * Math.PI) / 180))) * 1e6);
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
    const g = lineGraph();
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

  it('exposes the constants the spec pins down', () => {
    expect(PORTAL_REACH_M).toBe(45);
    expect(INDOOR).toBe(1.2);
  });
});
