import { describe, it, expect } from 'vitest';
import { loadCampusGeo, type CampusShape } from './campus-geo';
import { DROPPED_ID, droppedPlace } from './walk-pin';

/** A 0.001° square around (lng, lat), as a flat [lon, lat, …] ring. */
const square = (lng: number, lat: number, r = 0.0005): number[] => [
  lng - r, lat - r, lng + r, lat - r, lng + r, lat + r, lng - r, lat + r,
];

const SHAPES: CampusShape[] = [
  { name: 'Hopkins Parking', rings: [square(-117.24, 32.88)] },
  // A courtyard building: the outer wall, and the open court as a hole.
  { name: 'Courtyard Hall', rings: [square(-117.23, 32.87), square(-117.23, 32.87, 0.0002)] },
];

describe('droppedPlace', () => {
  it('names the building a click lands inside, and routes from its doors', () => {
    const p = droppedPlace({ lat: 32.8801, lng: -117.2401 }, SHAPES);
    expect(p.place).toBe('Hopkins Parking');
    expect(p.label).toBe('Hopkins Parking');
    // The click itself, not the building's centre: that is where the car is.
    expect(p.coords).toEqual({ lat: 32.8801, lng: -117.2401 });
    expect(p.dropped).toBe(true);
    expect(p.disabled).toBe(false);
  });

  it('is a bare dropped pin outside every footprint', () => {
    const p = droppedPlace({ lat: 32.9, lng: -117.2 }, SHAPES);
    expect(p.place).toBeUndefined();
    expect(p.label).toBe('Dropped pin');
    expect(p.coords).toEqual({ lat: 32.9, lng: -117.2 });
  });

  it('treats a hole in a footprint as outside it', () => {
    expect(droppedPlace({ lat: 32.87, lng: -117.23 }, SHAPES).place).toBeUndefined();
    expect(droppedPlace({ lat: 32.8704, lng: -117.23 }, SHAPES).place).toBe('Courtyard Hall');
  });

  it('keeps one id wherever it lands, so it can never collide with a course place', () => {
    const a = droppedPlace({ lat: 32.8801, lng: -117.2401 }, SHAPES);
    const b = droppedPlace({ lat: 32.9, lng: -117.2 }, SHAPES);
    expect(a.id).toBe(DROPPED_ID);
    expect(b.id).toBe(DROPPED_ID);
    expect(a.id).not.toContain('|'); // walk-places ids are course|label|place
  });

  it('takes its own id when both ends are pins, so the two never read as one place', () => {
    const a = droppedPlace({ lat: 32.9, lng: -117.2 }, SHAPES, `${DROPPED_ID}:a`);
    const b = droppedPlace({ lat: 32.9, lng: -117.2 }, SHAPES, `${DROPPED_ID}:b`);
    expect(a.id).not.toBe(b.id);
  });

  it('recognises a real parking structure from the bundled campus geometry', async () => {
    const geo = await loadCampusGeo();
    const hopkins = geo.footprints.find((f) => f.name === 'Hopkins Parking')!;
    expect(hopkins).toBeDefined();
    // Any vertex pulled a hair toward the ring's mean lands inside a convex-ish structure.
    const ring = hopkins.rings[0]!;
    let sx = 0;
    let sy = 0;
    const n = ring.length / 2;
    for (let i = 0; i < ring.length; i += 2) {
      sx += ring[i]!;
      sy += ring[i + 1]!;
    }
    const p = droppedPlace({ lng: sx / n, lat: sy / n }, geo.footprints);
    expect(p.place).toBe('Hopkins Parking');
  });
});
