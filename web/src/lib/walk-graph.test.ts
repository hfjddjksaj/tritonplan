import { describe, expect, it } from 'vitest';
import { decodeWalkGraph, metresBetween } from './walk-graph';

/** A 3-node chain: 0 —100m— 1 —(steps)— 2 */
const WIRE = {
  source: 't',
  fetched: '2026-08-21',
  bbox: [0, 0, 1, 1],
  // lon/lat at 1e6, delta encoded: (-117.240000, 32.880000), then +0.001 lon, then +0.001 lon
  nodes: [-117_240_000, 32_880_000, 1000, 0, 1000, 0],
  elev: [100, 5, -3], // 100, 105, 102
  edges: [0, 1, 1, 2], // (0,1) then delta a=+1 -> (1,2)
  steps: [1], // edge index 1 is steps
};

describe('decodeWalkGraph', () => {
  it('restores coordinates, elevations and a symmetric CSR adjacency', () => {
    const g = decodeWalkGraph(WIRE);
    expect(g.n).toBe(3);
    expect(g.lon[0]).toBeCloseTo(-117.24, 6);
    expect(g.lat[0]).toBeCloseTo(32.88, 6);
    expect(g.lon[2]).toBeCloseTo(-117.238, 6);
    expect([...g.elev]).toEqual([100, 105, 102]);
    // undirected: node 1 sees both neighbours
    const nbrs = (i: number) => [...g.to.slice(g.head[i]!, g.head[i + 1]!)].sort();
    expect(nbrs(0)).toEqual([1]);
    expect(nbrs(1)).toEqual([0, 2]);
    expect(nbrs(2)).toEqual([1]);
  });

  it('marks the steps edge on both directions of that adjacency', () => {
    const g = decodeWalkGraph(WIRE);
    const flagOf = (from: number, to: number) => {
      for (let k = g.head[from]!; k < g.head[from + 1]!; k++) if (g.to[k] === to) return g.steps[k];
      throw new Error('no such edge');
    };
    expect(flagOf(1, 2)).toBe(1);
    expect(flagOf(2, 1)).toBe(1);
    expect(flagOf(0, 1)).toBe(0);
  });

  it('measures edge length in metres', () => {
    const g = decodeWalkGraph(WIRE);
    for (let k = g.head[0]!; k < g.head[1]!; k++) {
      expect(g.len[k]).toBeGreaterThan(80);
      expect(g.len[k]).toBeLessThan(110);
    }
  });
});

describe('metresBetween', () => {
  it('is symmetric and zero for a point against itself', () => {
    expect(metresBetween(32.88, -117.24, 32.88, -117.24)).toBe(0);
    const a = metresBetween(32.88, -117.24, 32.881, -117.241);
    const b = metresBetween(32.881, -117.241, 32.88, -117.24);
    expect(a).toBeCloseTo(b, 9);
  });
});
