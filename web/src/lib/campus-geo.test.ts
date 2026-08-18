import { describe, it, expect } from 'vitest';
import {
  ACADEMIC_CORE_DISTRICTS,
  campusPadding,
  coreBounds,
  coreDistricts,
  decodeGround,
  decodeRing,
  decodeLines,
  decodeShapes,
  decodeTrees,
  loadCampusGeo,
  loadCampusMap,
  type CampusGeo,
  type WireLine,
  type WireShape,
} from './campus-geo';
// Encoder lives in the fetch scripts; decoder lives here. The two GEO_SCALE /
// SCALE constants are declared independently on each side of that boundary —
// a mismatch between them multiplies every coordinate by 10, so this test
// round-trips through the real encoder, not a re-implementation of it.
import { encodeRing, GEO_SCALE } from '../../scripts/geo-encode.mjs';

describe('encodeRing / decodeRing scale round-trip', () => {
  it('agrees with the fetch-script encoder on GEO_SCALE (1e6)', () => {
    expect(GEO_SCALE).toBe(1e6);
    const ring = [
      [-117.23393, 32.87909],
      [-117.2338, 32.879],
      [-117.23375, 32.87895],
    ];
    const wire = encodeRing(ring, 0);
    expect(decodeRing(wire)).toEqual([
      -117.23393, 32.87909, -117.2338, 32.879, -117.23375, 32.87895,
    ]);
  });
});

describe('decodeRing', () => {
  it('expands an integer delta ring back into lon/lat degrees', () => {
    // First pair is absolute (scaled by 1e6), the rest are deltas.
    const wire = [-117253330, 32866450, -10, -30, 50, 20];
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
    expect(decodeRing([-117253330, 32866450, 7])).toEqual([-117.25333, 32.86645]);
  });
});

describe('decodeShapes', () => {
  it('keeps names and decodes every ring of every shape', () => {
    const wire: WireShape[] = [
      ['Geisel Library', [[-117237000, 32881000, 100, 0], [-117236000, 32880000, -50, 50]]],
      ['Center Hall', [[-117241000, 32878000]]],
    ];
    const out = decodeShapes(wire);
    expect(out.map((s) => s.name)).toEqual(['Geisel Library', 'Center Hall']);
    expect(out[0]!.rings).toHaveLength(2);
    expect(out[0]!.rings[0]).toEqual([-117.237, 32.881, -117.2369, 32.881]);
    expect(out[1]!.rings[0]).toEqual([-117.241, 32.878]);
  });
});

describe('bundled campus geometry', () => {
  it('carries the expected number of shapes and plausible UCSD coordinates', async () => {
    const geo = await loadCampusGeo();

    // Bands, not exact counts: campus changes, but a refetch that reshapes the
    // upstream layer should fail here rather than silently ship a broken map.
    expect(geo.footprints.length).toBeGreaterThan(550);
    expect(geo.footprints.length).toBeLessThan(700);
    expect(geo.districts.length).toBeGreaterThan(20);
    expect(geo.districts.length).toBeLessThan(40);

    const verts = geo.footprints.reduce(
      (n, s) => n + s.rings.reduce((m, r) => m + r.length / 2, 0),
      0,
    );
    // Unsimplified (RDP eps 0) since the geometry-precision fix — measured
    // ~27647, up from ~10800 when the fetch script still ran RDP at 1 m.
    expect(verts).toBeGreaterThan(19000);
    expect(verts).toBeLessThan(36000);

    // Every coordinate must land in greater UCSD, not in the ocean or at 0,0
    // (the classic sign of a projection or scaling mistake). The footprints
    // layer also carries the Hillcrest medical campus (~32.75N), a real UCSD
    // Health site ~13 km south of La Jolla and already present in the
    // frozen ucsd-buildings.json point data — so the latitude floor is wider
    // than "main campus only" on purpose.
    for (const shape of [...geo.footprints, ...geo.districts]) {
      for (const ring of shape.rings) {
        for (let i = 0; i + 1 < ring.length; i += 2) {
          expect(ring[i]).toBeGreaterThan(-117.30);
          expect(ring[i]).toBeLessThan(-117.10);
          expect(ring[i + 1]).toBeGreaterThan(32.70);
          expect(ring[i + 1]).toBeLessThan(32.92);
        }
      }
    }
  });

  it('includes landmark buildings and named colleges', async () => {
    const geo = await loadCampusGeo();
    const names = new Set(geo.footprints.map((s) => s.name));
    for (const n of ['Geisel Library', 'Center Hall', 'York Hall', 'Price Center West']) {
      expect(names, `missing footprint: ${n}`).toContain(n);
    }
    const districts = new Set(geo.districts.map((s) => s.name));
    for (const d of ['Muir', 'Revelle', 'Warren', 'Roosevelt']) {
      expect(districts, `missing district: ${d}`).toContain(d);
    }
  });

  it('memoizes — a second load returns the same object', async () => {
    expect(await loadCampusGeo()).toBe(await loadCampusGeo());
  });
});

describe('academic-core framing', () => {
  it('still matches every named core district in the committed data', async () => {
    const geo = await loadCampusGeo();
    const names = new Set(geo.districts.map((d) => d.name));
    for (const n of ACADEMIC_CORE_DISTRICTS) {
      expect(names, `core district renamed or gone: ${n}`).toContain(n);
    }
    // Non-empty is the load-bearing part: an empty match silently falls back to
    // all 25 districts, which is what squeezed the teaching core into ~2% of the
    // canvas. A refetch that renames them must fail here, not on a user's screen.
    expect(coreDistricts(geo)).toHaveLength(ACADEMIC_CORE_DISTRICTS.length);
    expect(coreDistricts(geo).length).toBeGreaterThan(0);
    expect(coreDistricts(geo).length).toBeLessThan(geo.districts.length);
  });

  it('falls back to every district rather than nothing when the names all change', () => {
    const renamed: CampusGeo = {
      footprints: [],
      districts: [{ name: 'Some Future Name', rings: [[-117.24, 32.87, -117.23, 32.88]] }],
      lines: [],
    };
    expect(coreDistricts(renamed).map((d) => d.name)).toEqual(['Some Future Name']);
  });

  it('scales padding with the canvas instead of eating a small one', () => {
    expect(campusPadding(1100, 760)).toBe(28);
    expect(campusPadding(360, 560)).toBe(13);
  });
});

describe('decodeLines', () => {
  it('keeps name and kind and decodes the delta-encoded points', () => {
    const wire: WireLine[] = [
      ['Gilman Drive', 'major', [-117237000, 32881000, 100, -50, 100, -50]],
      ['', 'coast', [-117255000, 32870000, 0, -1000]],
    ];
    const out = decodeLines(wire);
    expect(out[0]).toEqual({
      name: 'Gilman Drive',
      kind: 'major',
      pts: [-117.237, 32.881, -117.2369, 32.88095, -117.2368, 32.8809],
    });
    expect(out[1]!.kind).toBe('coast');
    expect(out[1]!.pts).toEqual([-117.255, 32.87, -117.255, 32.869]);
  });
});

describe('bundled orientation lines', () => {
  it('carries the roads and walkways students steer by, and one coastline', async () => {
    const geo = await loadCampusGeo();
    const names = new Set(geo.lines.map((l) => l.name));
    for (const must of [
      'North Torrey Pines Road',
      'Gilman Drive',
      'La Jolla Village Drive',
      'Voigt Drive',
      'Ridge Walk',
      'Library Walk',
    ]) {
      expect(names.has(must), must).toBe(true);
    }
    const coast = geo.lines.filter((l) => l.kind === 'coast');
    expect(coast).toHaveLength(1);
    // The chain has to outspan the framed core north–south, or the ocean fill
    // would stop short of the canvas edge.
    const lats = coast[0]!.pts.filter((_, i) => i % 2 === 1);
    expect(Math.min(...lats)).toBeLessThan(32.87);
    expect(Math.max(...lats)).toBeGreaterThan(32.892);
    // Every kind the renderer styles is present, and nothing it doesn't know.
    const kinds = new Set(geo.lines.map((l) => l.kind));
    expect([...kinds].sort()).toEqual(['coast', 'hwy', 'major', 'minor', 'walk']);
    for (const l of geo.lines) {
      expect(l.pts.length).toBeGreaterThanOrEqual(4);
      for (let i = 0; i + 1 < l.pts.length; i += 2) {
        expect(l.pts[i]).toBeGreaterThan(-117.30);
        expect(l.pts[i]).toBeLessThan(-117.20);
        expect(l.pts[i + 1]).toBeGreaterThan(32.84);
        expect(l.pts[i + 1]).toBeLessThan(32.92);
      }
    }
  });
});

describe('decodeShapes with heights', () => {
  it('carries an optional third element as height in metres', () => {
    const shapes = decodeShapes([['A', [[0, 0, 100, 0]], 27], ['B', [[0, 0, 100, 0]]]]);
    expect(shapes[0]!.height).toBe(27);
    expect(shapes[1]!.height).toBeUndefined();
  });
});

describe('decodeGround / decodeTrees', () => {
  it('maps a type index back to its name and decodes rings', () => {
    const g = decodeGround(['Grass', 'Sidewalk'], [[1, [[-117230000, 32880000, 100, 0, 0, 100]]]]);
    expect(g).toEqual([{ type: 'Sidewalk', rings: [[-117.23, 32.88, -117.2299, 32.88, -117.2299, 32.8801]] }]);
  });
  it('decodes delta-encoded tree triples, keeping the class raw', () => {
    const t = decodeTrees([-117230000, 32880000, 2, 1000, -500, 4]);
    expect(t).toEqual([{ lon: -117.23, lat: 32.88, cls: 2 }, { lon: -117.229, lat: 32.8795, cls: 4 }]);
  });
});

describe('bundled campus map data', () => {
  it('has the official ground types, thousands of surfaces, trees, one boundary and land use', async () => {
    const m = await loadCampusMap();
    const types = new Set(m.ground.map((g) => g.type));
    for (const t of ['Grass', 'Sidewalk', 'Walking Path', 'Planter', 'Parking Lot', 'Street', 'Building']) expect(types.has(t)).toBe(true);
    expect(types.has('Curb')).toBe(false);
    // Dropping `maxAllowableOffset` raised the raw feature count; the
    // ground-Building dedup (Fix 2) then removes the ~310 that duplicate a
    // footprint. Net measured ~4756, comfortably in the thousands either way.
    expect(m.ground.length).toBeGreaterThan(3000);
    expect(m.trees.length).toBeGreaterThan(1500);
    expect(m.trees.every((t) => t.cls >= 0 && t.cls <= 4)).toBe(true);
    expect(m.boundary.length).toBeGreaterThanOrEqual(1);
    expect(m.landuse.length).toBeGreaterThan(0);
    // The ground layer's own `Building` polygons should be almost all gone
    // (deduped against the 609 footprints in Fix 2) — only the ~33 orphans
    // the footprint layer is missing survive, not the full ~343.
    const groundBuildings = m.ground.filter((g) => g.type === 'Building').length;
    expect(groundBuildings).toBeGreaterThan(0);
    expect(groundBuildings).toBeLessThan(100);
    // Everything sits on the La Jolla campus.
    for (const g of m.ground.slice(0, 200)) for (const r of g.rings) for (let i = 0; i + 1 < r.length; i += 2) {
      expect(r[i]).toBeGreaterThan(-117.27); expect(r[i]).toBeLessThan(-117.19);
      expect(r[i + 1]).toBeGreaterThan(32.86); expect(r[i + 1]).toBeLessThan(32.90);
    }
  });
  it('gives the landmark buildings real heights', async () => {
    const geo = await loadCampusGeo();
    const h = (n: string) => geo.footprints.find((f) => f.name === n)?.height;
    expect(h('Geisel Library')).toBeGreaterThanOrEqual(25);
    expect(h('Geisel Library')).toBeLessThanOrEqual(45);
    expect(h('Tioga Hall')).toBeGreaterThanOrEqual(30);
    expect(geo.footprints.filter((f) => f.height !== undefined).length).toBeGreaterThan(350);
  });
  it('memoizes', async () => { expect(await loadCampusMap()).toBe(await loadCampusMap()); });
});

describe('coreBounds', () => {
  it('is the bbox of the academic core, west-south to east-north', async () => {
    const geo = await loadCampusGeo();
    const [[w, s], [e, n]] = coreBounds(geo);
    expect(w).toBeLessThan(e); expect(s).toBeLessThan(n);
    expect(w).toBeGreaterThan(-117.25); expect(e).toBeLessThan(-117.22);
    expect(s).toBeGreaterThan(32.87); expect(n).toBeLessThan(32.895);
  });
});
