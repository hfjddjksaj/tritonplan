import { describe, it, expect } from 'vitest';
import { buildSources, polygonAnchor, ringArea, DEFAULT_HEIGHT_M } from './map-data';
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
  it('drops street-address footprints from the building names', async () => {
    const s = buildSources(await loadCampusGeo(), await loadCampusMap());
    expect(s.labels.features.some((f) => f.properties.kind === 'building' && /^\d/.test(f.properties.label))).toBe(false);
  });
});
