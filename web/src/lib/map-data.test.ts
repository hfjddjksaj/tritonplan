import { describe, it, expect } from 'vitest';
import { buildSources, polygonAnchor, ringArea, shapeGeometry, DEFAULT_HEIGHT_M } from './map-data';
import { loadCampusGeo, loadCampusMap } from './campus-geo';

const sq = [-117.24, 32.88, -117.23, 32.88, -117.23, 32.89, -117.24, 32.89];

describe('polygonAnchor / ringArea', () => {
  it('anchors a square at its middle and measures it', () => {
    const a = polygonAnchor([sq])!;
    expect(a.lon).toBeCloseTo(-117.235, 2); expect(a.lat).toBeCloseTo(32.885, 2);
    expect(Math.abs(ringArea(sq))).toBeCloseTo(0.0001, 6);
  });
});

describe('buildSources', () => {
  it('turns bundled data into closed GeoJSON with the properties the style keys on', async () => {
    const s = buildSources(await loadCampusGeo(), await loadCampusMap());
    const g = s.ground.features[0]!;
    expect(g.geometry.type).toBe('Polygon');
    const ring = g.geometry.coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(typeof g.properties.type).toBe('string'); expect(typeof g.properties.rank).toBe('number');
    const geisel = s.buildings.features.find((f) => f.properties.name === 'Geisel Library')!;
    expect(geisel.properties.height).toBeGreaterThan(20);
    const anyDefault = s.buildings.features.find((f) => f.properties.height === DEFAULT_HEIGHT_M);
    expect(anyDefault).toBeDefined();
    expect(s.trees.features[0]!.geometry.type).toBe('Point');
    expect(s.roads.features.some((f) => f.properties.label === 'N Torrey Pines Rd')).toBe(true);
    expect(s.roads.features.some((f) => f.properties.kind === 'walk')).toBe(true);
    expect(s.ocean.features).toHaveLength(1);
    expect(s.campus.features).toHaveLength(1);
    const kinds = new Set(s.labels.features.map((f) => f.properties.kind));
    expect(kinds).toEqual(new Set(['district', 'landmark', 'building']));
    expect(s.labels.features.find((f) => f.properties.label === 'Muir')).toBeDefined();
    expect(s.labels.features.find((f) => f.properties.label === 'Geisel Library' && f.properties.kind === 'landmark')).toBeDefined();
    expect(s.labels.features.find((f) => f.properties.kind === 'building' && f.properties.label === 'Geisel Library')).toBeUndefined();
  });
  it('labels street-address footprints instead of leaving them a blank grey block', async () => {
    // Fix 3's ruling: a building whose official name is its address (e.g.
    // "134 Dickinson") reads as that address rather than getting dropped —
    // the old digit guard used to blank all of these.
    const s = buildSources(await loadCampusGeo(), await loadCampusMap());
    const addressLabels = s.labels.features.filter(
      (f) => f.properties.kind === 'building' && /^\d/.test(f.properties.label),
    );
    expect(addressLabels.length).toBeGreaterThan(0);
    expect(
      s.labels.features.some((f) => f.properties.kind === 'building' && f.properties.label === '134 Dickinson'),
    ).toBe(true);
  });
});

describe('shapeGeometry ring assembly', () => {
  it('nests a fully-contained inner ring as a hole in one Polygon', () => {
    const outer = [0, 0, 10, 0, 10, 10, 0, 10];
    const inner = [3, 3, 7, 3, 7, 7, 3, 7];
    const g = shapeGeometry([outer, inner]);
    expect(g.type).toBe('Polygon');
    expect(g.coordinates).toHaveLength(2);
    expect(g.coordinates[1]![0]).toEqual([3, 3]);
  });

  it('keeps two disjoint rings as two single-ring polygons', () => {
    const a = [0, 0, 10, 0, 10, 10, 0, 10];
    const b = [20, 20, 30, 20, 30, 30, 20, 30];
    const g = shapeGeometry([a, b]);
    expect(g.type).toBe('MultiPolygon');
    expect(g.coordinates).toHaveLength(2);
    expect(g.coordinates[0]).toHaveLength(1);
    expect(g.coordinates[1]).toHaveLength(1);
  });

  it('groups a hole with its own outer while a disjoint third ring stays separate', () => {
    const outer = [0, 0, 10, 0, 10, 10, 0, 10];
    const hole = [3, 3, 7, 3, 7, 7, 3, 7];
    const third = [20, 20, 30, 20, 30, 30, 20, 30];
    const g = shapeGeometry([outer, hole, third]);
    expect(g.type).toBe('MultiPolygon');
    expect(g.coordinates).toHaveLength(2);
    const withHole = g.coordinates.find((p) => p.length === 2)!;
    const withoutHole = g.coordinates.find((p) => p.length === 1)!;
    expect(withHole).toBeDefined();
    expect(withoutHole).toBeDefined();
  });

  it('produces at least one multi-ring building and one multi-ring ground polygon from the bundled data', async () => {
    const s = buildSources(await loadCampusGeo(), await loadCampusMap());
    const hasHole = (geom: { type: string; coordinates: unknown[] }) =>
      geom.type === 'Polygon'
        ? geom.coordinates.length > 1
        : geom.type === 'MultiPolygon'
          ? (geom.coordinates as unknown[][]).some((p) => p.length > 1)
          : false;

    expect(s.buildings.features.some((f) => hasHole(f.geometry))).toBe(true);
    expect(s.ground.features.some((f) => hasHole(f.geometry))).toBe(true);
  });
});
