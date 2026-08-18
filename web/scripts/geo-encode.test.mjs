import { describe, it, expect } from 'vitest';
import { rdp, pointInRing, centroid, centroidInsideAny, encodeRing, GEO_SCALE } from './geo-encode.mjs';

describe('rdp', () => {
  it('returns the input unchanged when eps <= 0 — no simplification', () => {
    const pts = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    expect(rdp(pts, 0)).toBe(pts); // same array, not just equal contents
  });

  it('keeps a collinear run intact at eps 0 (the case the short-circuit protects)', () => {
    // Without the `eps <= 0` short-circuit, `maxD <= eps` still fires when
    // maxD is exactly 0 (as it is for perfectly collinear points), silently
    // dropping the middle vertices even though eps asked for no loss at all.
    const collinear = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    expect(rdp(collinear, 0)).toEqual(collinear);
    expect(rdp(collinear, 0)).toHaveLength(5);
  });

  it('still simplifies when eps is positive', () => {
    const collinear = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    // A genuinely positive tolerance still collapses collinear middle points.
    expect(rdp(collinear, 1)).toEqual([
      [0, 0],
      [2, 0],
    ]);
  });
});

describe('encodeRing scale round-trip', () => {
  it('carries a coordinate through encode at GEO_SCALE without losing more than the quantisation grid', () => {
    const ring = [
      [-117.23393, 32.87909],
      [-117.2338, 32.879],
      [-117.23375, 32.87895],
    ];
    const wire = encodeRing(ring, 0);
    // Re-decode by hand the same way campus-geo.ts's decodeRing does.
    const decoded = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i + 1 < wire.length; i += 2) {
      x += wire[i];
      y += wire[i + 1];
      decoded.push([x / GEO_SCALE, y / GEO_SCALE]);
    }
    expect(decoded).toHaveLength(ring.length);
    for (let i = 0; i < ring.length; i++) {
      expect(decoded[i][0]).toBeCloseTo(ring[i][0], 5); // within ~1e-5°, well under the 1e-6 grid's own precision
      expect(decoded[i][1]).toBeCloseTo(ring[i][1], 5);
    }
    expect(GEO_SCALE).toBe(1e6);
  });
});

describe('encodeRing — zero-length segments from quantisation', () => {
  /** Manual decode, same scheme as campus-geo.ts's decodeRing. */
  function decode(wire) {
    const out = [];
    let x = 0, y = 0;
    for (let i = 0; i + 1 < wire.length; i += 2) {
      x += wire[i]; y += wire[i + 1];
      out.push([x / GEO_SCALE, y / GEO_SCALE]);
    }
    return out;
  }

  it('drops a consecutive point that rounds onto the same GEO_SCALE grid cell as the previous one', () => {
    // p1 differs from p0 by 1e-10° — far below the 1e-6 grid, so it quantises
    // to the exact same integer point. This is the 7-digit-precision-vs-1e6
    // -grid collapse the reviewer measured on the real ground layer (12.1%
    // of vertices).
    const ring = [
      [-117.234, 32.879], // p0
      [-117.2340000001, 32.8790000001], // p1 — collapses onto p0, must be dropped
      [-117.233, 32.878], // p2
      [-117.232, 32.877], // p3
    ];
    const wire = encodeRing(ring, 0);
    const decoded = decode(wire);
    expect(decoded).toHaveLength(3); // p1 gone, p0/p2/p3 kept
    expect(decoded[0]).toEqual([-117.234, 32.879]);
    expect(decoded[1]).toEqual([-117.233, 32.878]);
    expect(decoded[2]).toEqual([-117.232, 32.877]);
  });

  it('keeps a closed ring closed: the last point equalling the first is not a "previous point" duplicate', () => {
    // p1 collapses onto p0 exactly as above, but this ring is also closed —
    // its last point is a second, non-adjacent repeat of p0. The guard must
    // only ever compare a point to the one immediately before it in the KEPT
    // stream, never to the ring's first point, or ring closure would silently
    // break whenever a ring happened to shed a vertex near its start.
    const closedRing = [
      [-117.234, 32.879], // p0
      [-117.2340000001, 32.8790000001], // collapses onto p0 — dropped
      [-117.233, 32.878], // p2
      [-117.232, 32.877], // p3
      [-117.234, 32.879], // closes back to p0 — must survive
    ];
    const wire = encodeRing(closedRing, 0);
    const decoded = decode(wire);
    expect(decoded).toHaveLength(4);
    expect(decoded[0]).toEqual([-117.234, 32.879]);
    expect(decoded[decoded.length - 1]).toEqual(decoded[0]); // still closed
  });

  it('returns [] for a ring that quantises down to fewer than 3 distinct vertices', () => {
    // All four points round onto the same two GEO_SCALE grid cells — a
    // sliver too small for the wire format to represent as a polygon.
    const collapsedRing = [
      [-117.234, 32.879],
      [-117.2340000001, 32.8790000001], // same cell as the first
      [-117.2340000002, 32.8790000002], // same cell again
      [-117.234, 32.879], // "closes" back to the same single point
    ];
    expect(encodeRing(collapsedRing, 0)).toEqual([]);
  });

  it('keeps a ring with exactly 3 distinct vertices (the minimum valid polygon)', () => {
    const triangle = [
      [-117.234, 32.879],
      [-117.233, 32.878],
      [-117.232, 32.877],
    ];
    const wire = encodeRing(triangle, 0);
    expect(decode(wire)).toHaveLength(3);
  });
});

describe('pointInRing / centroid', () => {
  const square = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it('finds the centroid of a simple ring', () => {
    expect(centroid(square)).toEqual([5, 5]);
  });

  it('is true for a point inside the ring, false for one outside', () => {
    expect(pointInRing(5, 5, square)).toBe(true);
    expect(pointInRing(50, 50, square)).toBe(false);
  });
});

describe('centroidInsideAny — the ground-Building dedup predicate', () => {
  const footprintA = { name: 'A', rings: [[[0, 0], [10, 0], [10, 10], [0, 10]]] };
  const footprintB = { name: 'B', rings: [[[100, 100], [110, 100], [110, 110], [100, 110]]] };
  const shapes = [footprintA, footprintB];

  it('flags a ground polygon whose centroid sits inside a footprint as a duplicate', () => {
    // A ground "Building" polygon surveyed over the same footprint, offset by
    // ~1-2 units the way the two UCSD pipelines disagree in the real data.
    const duplicateRing = [
      [1, 1],
      [9, 1],
      [9, 9],
      [1, 9],
    ];
    expect(centroidInsideAny(duplicateRing, shapes)).toBe(true);
  });

  it('does not flag an orphan ground Building with no matching footprint', () => {
    const orphanRing = [
      [500, 500],
      [510, 500],
      [510, 510],
      [500, 510],
    ];
    expect(centroidInsideAny(orphanRing, shapes)).toBe(false);
  });
});
