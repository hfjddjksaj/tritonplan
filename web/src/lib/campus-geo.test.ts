import { describe, it, expect } from 'vitest';
import { decodeRing, decodeShapes, type WireShape } from './campus-geo';

describe('decodeRing', () => {
  it('expands an integer delta ring back into lon/lat degrees', () => {
    // First pair is absolute (scaled by 1e5), the rest are deltas.
    const wire = [-11725333, 3286645, -1, -3, 5, 2];
    expect(decodeRing(wire)).toEqual([
      -117.25333, 32.86645,
      -117.25334, 32.86642,
      -117.25329, 32.86644,
    ]);
  });

  it('returns an empty array for an empty ring', () => {
    expect(decodeRing([])).toEqual([]);
  });

  it('ignores a trailing unpaired value rather than emitting NaN', () => {
    expect(decodeRing([-11725333, 3286645, 7])).toEqual([-117.25333, 32.86645]);
  });
});

describe('decodeShapes', () => {
  it('keeps names and decodes every ring of every shape', () => {
    const wire: WireShape[] = [
      ['Geisel Library', [[-11723700, 3288100, 10, 0], [-11723600, 3288000, -5, 5]]],
      ['Center Hall', [[-11724100, 3287800]]],
    ];
    const out = decodeShapes(wire);
    expect(out.map((s) => s.name)).toEqual(['Geisel Library', 'Center Hall']);
    expect(out[0]!.rings).toHaveLength(2);
    expect(out[0]!.rings[0]).toEqual([-117.237, 32.881, -117.2369, 32.881]);
    expect(out[1]!.rings[0]).toEqual([-117.241, 32.878]);
  });
});
