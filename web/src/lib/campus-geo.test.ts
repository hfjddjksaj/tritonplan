import { describe, it, expect } from 'vitest';
import {
  ACADEMIC_CORE_DISTRICTS,
  campusPadding,
  campusViewport,
  coreDistricts,
  decodeRing,
  decodeShapes,
  loadCampusGeo,
  type CampusGeo,
  type WireShape,
} from './campus-geo';
import { project, toScreen } from './map-projection';

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
    expect(verts).toBeGreaterThan(8000);
    expect(verts).toBeLessThan(16000);

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
    };
    expect(coreDistricts(renamed).map((d) => d.name)).toEqual(['Some Future Name']);
  });

  it('scales padding with the canvas instead of eating a small one', () => {
    expect(campusPadding(1100, 760)).toBe(28);
    expect(campusPadding(360, 560)).toBe(13);
  });

  it('frames the teaching core big enough to tell neighbouring buildings apart', async () => {
    const geo = await loadCampusGeo();
    const v = campusViewport(geo, 1100, 760);
    const geisel = toScreen(project(-117.2374, 32.8811), v);
    const center = toScreen(project(-117.2415, 32.8779), v);
    for (const p of [geisel, center]) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1100);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(760);
    }
    // Framing all 25 districts put these two ~108 px apart, with 60–80 px label
    // chips between them. The core framing gives ~155 px.
    expect(Math.hypot(geisel.x - center.x, geisel.y - center.y)).toBeGreaterThan(130);
  });

  it('pushes a location outside the academic core off the canvas', async () => {
    // Hillcrest — a real UCSD Health site 13 km south, present in the point data
    // and reachable by a real class. It must not be counted as drawn.
    const geo = await loadCampusGeo();
    const v = campusViewport(geo, 1100, 760);
    const hillcrest = toScreen(project(-117.166, 32.755), v);
    expect(hillcrest.x > 1100 || hillcrest.y > 760).toBe(true);
  });
});
