import { describe, it, expect } from 'vitest';
import { polygonAnchor, footprintAnchors, anchorOnFootprint } from './map-anchor';
import { loadCampusGeo } from './campus-geo';
import { matchBuilding } from './buildings';
import type { CampusShape } from './campus-geo';

/** Flat [lng, lat, …] ring → is p inside it? Even-odd, same rule as the module. */
function inside(p: readonly [number, number], flat: readonly number[]): boolean {
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i]!, flat[i + 1]!]);
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/** Plain average of a ring's vertices — the naive "centroid" this module rejects. */
function vertexMean(flat: readonly number[]): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    sx += flat[i]!;
    sy += flat[i + 1]!;
    n++;
  }
  return [sx / n, sy / n];
}

const M_PER_DEG = 111_320;
function metresApart(a: readonly [number, number], b: readonly [number, number]): number {
  const cos = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * M_PER_DEG * cos, (a[1] - b[1]) * M_PER_DEG);
}

/** A square roughly 100 m on a side at UCSD's latitude. */
const SQUARE = [-117.24, 32.878, -117.239, 32.878, -117.239, 32.8789, -117.24, 32.8789, -117.24, 32.878];

/** A thin L — two narrow arms, so the notch swallows the middle. */
const ELL = [
  -117.24, 32.878,
  -117.239, 32.878,
  -117.239, 32.87818,
  -117.2398, 32.87818,
  -117.2398, 32.8789,
  -117.24, 32.8789,
];

describe('polygonAnchor', () => {
  it('puts a square’s anchor in the middle', () => {
    const a = polygonAnchor([SQUARE])!;
    expect(a[0]).toBeCloseTo(-117.2395, 4);
    expect(a[1]).toBeCloseTo(32.87845, 4);
  });

  it('stays INSIDE an L, where the average of the corners is not', () => {
    // Why a centroid will not do. On the real campus the plain average of a
    // footprint's corners lands outside the building for 37 of the 608 bundled
    // outlines (Frankfurter Hall, Che Cafe, Grassroots and other courtyard and
    // L shapes) — a pin on open ground beside the building it marks.
    expect(inside(vertexMean(ELL), ELL)).toBe(false);
    const a = polygonAnchor([ELL])!;
    expect(inside(a, ELL)).toBe(true);
  });

  it('is pushed away from a hole, not just from the outer wall', () => {
    // A courtyard: the anchor must not sit in the courtyard, and must not sit
    // hard against a wall either.
    const hole = [-117.2397, 32.8783, -117.2393, 32.8783, -117.2393, 32.8786, -117.2397, 32.8786, -117.2397, 32.8783];
    const a = polygonAnchor([SQUARE, hole])!;
    expect(inside(a, SQUARE)).toBe(true);
    expect(inside(a, hole)).toBe(false);
  });

  it('declines a ring with no area to speak of', () => {
    expect(polygonAnchor([])).toBeNull();
    expect(polygonAnchor([[-117.24, 32.878, -117.239, 32.878]])).toBeNull();
  });
});

describe('footprintAnchors', () => {
  it('keeps the LARGEST ring when one name has several polygons', () => {
    const shapes: CampusShape[] = [
      { name: 'Twin', rings: [[-117.24, 32.878, -117.2399, 32.878, -117.2399, 32.8781, -117.24, 32.8781, -117.24, 32.878]] },
      { name: 'Twin', rings: [SQUARE] },
    ];
    const a = footprintAnchors(shapes).get('Twin')!;
    expect(inside(a, SQUARE)).toBe(true);
  });
});

describe('anchorOnFootprint', () => {
  const anchors = new Map<string, [number, number]>([
    ['Center Hall', [-117.2401, 32.8781]],
    ['Asante House East', [-117.2418, 32.8843]],
    ['Asante House West', [-117.2421, 32.8843]],
  ]);

  it('moves a pin onto the polygon the map draws', () => {
    const moved = anchorOnFootprint({ place: 'Center Hall', coords: { lat: 32.8776, lng: -117.2395 } }, anchors);
    expect(moved).toEqual({ lat: 32.8781, lng: -117.2401 });
  });

  it('averages the wings of a complex, so the pin sits in the middle of it', () => {
    const moved = anchorOnFootprint(
      { place: 'Asante House', parts: ['Asante House East', 'Asante House West'], coords: { lat: 32.8842, lng: -117.242 } },
      anchors,
    )!;
    expect(moved.lng).toBeCloseTo(-117.24195, 5);
    expect(moved.lat).toBeCloseTo(32.8843, 5);
  });

  it('leaves a building with no bundled footprint on its point record', () => {
    const coords = { lat: 32.9, lng: -117.1 };
    expect(anchorOnFootprint({ place: 'Somewhere Unmapped', coords }, anchors)).toBe(coords);
  });

  it('leaves an unlocatable pin unlocatable', () => {
    expect(anchorOnFootprint({ place: 'Center Hall', coords: null }, anchors)).toBeNull();
  });
});

describe('the real bundled campus', () => {
  it('moves the worst-placed teaching buildings tens of metres onto themselves', async () => {
    // The measured tail. Switching from UCSD's building POINT record to the
    // FOOTPRINT the map extrudes moves a median building 4.1 m, but 69 of 562
    // move more than 20 m — and at z17.4 (0.76 m/px), York Hall's 39 m is 52 px
    // of daylight between the pin and the 3D block it is marking.
    const geo = await loadCampusGeo();
    const anchors = footprintAnchors(geo.footprints);
    for (const [name, atLeast] of [
      ['York Hall', 30],
      ['Mandeville Center', 25],
      ['Price Center West', 18],
    ] as const) {
      const anchor = anchors.get(name)!;
      const record = matchBuilding(name)!;
      expect(metresApart(anchor, [record.lng, record.lat]), name).toBeGreaterThan(atLeast);
    }
  });

  it('lands inside its own outline for every building a class can meet in', async () => {
    const geo = await loadCampusGeo();
    const anchors = footprintAnchors(geo.footprints);
    for (const name of [
      'Center Hall',
      'Galbraith Hall',
      'York Hall',
      'Computer Science and Engineering Building',
      'Price Center West',
      'Geisel Library',
      'Warren Lecture Hall',
      'Peterson Hall',
      'Solis Hall',
      'Mandeville Center',
    ]) {
      const anchor = anchors.get(name);
      expect(anchor, name).toBeDefined();
      // Compare against the largest ring carrying that name — the one
      // footprintAnchors picked.
      const rings = geo.footprints
        .filter((f) => f.name === name)
        .map((f) => f.rings[0]!)
        .sort((a, b) => b.length - a.length);
      expect(rings.some((r) => inside(anchor!, r)), name).toBe(true);
    }
  });
});
