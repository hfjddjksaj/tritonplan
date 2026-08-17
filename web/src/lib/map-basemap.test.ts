import { describe, it, expect } from 'vitest';
import { loadCampusGeo, type CampusLine } from './campus-geo';
import { fitBounds, project } from './map-projection';
import {
  DISTRICT_LABELS,
  TINT_GREEN,
  TINT_NEUTRAL,
  buildingShortName,
  districtLabel,
  districtPriority,
  footprintLabelCandidates,
  districtTint,
  labelAnchor,
  landmarkAnchors,
  oceanRing,
  placeTexts,
  roadLabelText,
  roadLabels,
  scaleBar,
  wantsRoadLabel,
} from './map-basemap';

describe('districtLabel / districtTint', () => {
  it('names districts the way students do', () => {
    expect(districtLabel('Ridge Walk North')).toBe('Marshall');
    expect(districtLabel('Roosevelt')).toBe('ERC');
    expect(districtLabel('North Torrey Pines')).toBe('Sixth');
    expect(districtLabel('Theatre District')).toBe('Eighth');
    expect(districtLabel('Revelle')).toBe('Revelle');
  });

  it('skips the slivers nobody needs named', () => {
    expect(districtLabel('Beach Properties')).toBeNull();
  });

  it('tints colleges distinctly, canyons green, everything else neutral', () => {
    const colleges = ['Revelle', 'Muir', 'Ridge Walk North', 'Warren', 'Roosevelt', 'North Torrey Pines', 'North Campus', 'Theatre District'];
    const tints = colleges.map(districtTint);
    expect(new Set(tints).size).toBe(colleges.length);
    for (const t of tints) expect(t).not.toBe(TINT_NEUTRAL);
    expect(districtTint('North Canyon')).toBe(TINT_GREEN);
    expect(districtTint('Health Sciences')).toBe(TINT_NEUTRAL);
  });

  it('only maps district names that exist in the bundled data', async () => {
    const geo = await loadCampusGeo();
    const names = new Set(geo.districts.map((d) => d.name));
    for (const key of Object.keys(DISTRICT_LABELS)) expect(names.has(key), key).toBe(true);
  });
});

describe('labelAnchor', () => {
  it('lands inside an L-shaped polygon where the centroid would not', () => {
    // An L: 0..10 × 0..10 minus the 4..10 × 4..10 corner. Centroid ≈ (3.7, 3.7)
    // is inside here, so use a thin crescent-ish C instead: outer box minus a
    // notch from the right, leaving a C whose bbox centre is in the notch.
    const c = [0, 0, 10, 0, 10, 2, 3, 2, 3, 8, 10, 8, 10, 10, 0, 10];
    const a = labelAnchor([c])!;
    expect(a).not.toBeNull();
    // Bbox centre (5, 5) is in the notch; the anchor must be in the C's spine.
    expect(a.lon).toBeLessThan(3);
    expect(a.lat).toBeGreaterThan(1);
    expect(a.lat).toBeLessThan(9);
  });

  it('uses the largest ring of a multi-ring shape', () => {
    const small = [0, 0, 1, 0, 1, 1, 0, 1];
    const big = [20, 20, 30, 20, 30, 30, 20, 30];
    const a = labelAnchor([small, big])!;
    expect(a.lon).toBeGreaterThan(20);
    expect(a.lat).toBeGreaterThan(20);
  });

  it('returns null for a degenerate ring', () => {
    expect(labelAnchor([[0, 0, 1, 1]])).toBeNull();
    expect(labelAnchor([])).toBeNull();
  });
});

describe('landmarkAnchors', () => {
  it('finds every landmark in the bundled footprints, on campus', async () => {
    const geo = await loadCampusGeo();
    const anchors = landmarkAnchors(geo);
    expect(anchors.map((a) => a.label)).toEqual([
      'Geisel Library',
      'Price Center',
      'RIMAC',
      'Center Hall',
      'Student Services',
    ]);
    for (const a of anchors) {
      expect(a.lon).toBeGreaterThan(-117.245);
      expect(a.lon).toBeLessThan(-117.228);
      expect(a.lat).toBeGreaterThan(32.87);
      expect(a.lat).toBeLessThan(32.892);
    }
  });
});

describe('roadLabelText / wantsRoadLabel', () => {
  it('abbreviates the way street signs do', () => {
    expect(roadLabelText('North Torrey Pines Road')).toBe('N Torrey Pines Rd');
    expect(roadLabelText('La Jolla Village Drive')).toBe('La Jolla Village Dr');
    expect(roadLabelText('Scholars Drive North')).toBe('Scholars Dr N');
    expect(roadLabelText('Ridge Walk')).toBe('Ridge Walk');
    expect(roadLabelText('San Diego Freeway')).toBe('I-5');
  });

  it('labels every named highway and major road, but only listed minor ones', () => {
    const line = (name: string, kind: CampusLine['kind']): CampusLine => ({ name, kind, pts: [] });
    expect(wantsRoadLabel(line('Genesee Avenue', 'major'))).toBe(true);
    expect(wantsRoadLabel(line('', 'hwy'))).toBe(false);
    expect(wantsRoadLabel(line('Voigt Drive', 'minor'))).toBe(true);
    expect(wantsRoadLabel(line('Caminito Fresco', 'minor'))).toBe(false);
    expect(wantsRoadLabel(line('Library Walk', 'walk'))).toBe(true);
  });
});

describe('roadLabels', () => {
  // A 2 km east–west road across a 1000 px canvas framed to it.
  const road: CampusLine = {
    name: 'Gilman Drive',
    kind: 'major',
    pts: [-117.25, 32.88, -117.23, 32.88],
  };
  const view = fitBounds([project(-117.25, 32.88), project(-117.23, 32.88), project(-117.24, 32.885)], 1000, 600, 20);

  it('labels a straight road at its middle, unrotated', () => {
    const [l] = roadLabels([road], view, 1000, 600);
    expect(l).toBeDefined();
    expect(l!.text).toBe('Gilman Dr');
    expect(l!.x).toBeCloseTo(500, 0);
    expect(l!.angle).toBeCloseTo(0, 5);
  });

  it('keeps the angle upright whichever way the road was digitised', () => {
    const backwards: CampusLine = { ...road, pts: [-117.23, 32.88, -117.25, 32.88] };
    const [l] = roadLabels([backwards], view, 1000, 600);
    expect(Math.abs(l!.angle)).toBeLessThan(90.0001);
    expect(l!.angle).toBeCloseTo(0, 5);
    // A north–south road reads bottom-to-top (rotated −90… well, +90 → normalised to 90).
    const ns: CampusLine = { ...road, name: 'Voigt Drive', kind: 'minor', pts: [-117.24, 32.878, -117.24, 32.882] };
    const [v] = roadLabels([ns], view, 1000, 600);
    expect(v).toBeDefined();
    expect(Math.abs(v!.angle)).toBeCloseTo(90, 3);
  });

  it('keeps one label per name — from the piece with the longest visible run', () => {
    const stub: CampusLine = { ...road, pts: [-117.24, 32.879, -117.238, 32.879] };
    const out = roadLabels([stub, road], view, 1000, 600);
    expect(out).toHaveLength(1);
    expect(out[0]!.y).toBeCloseTo(roadLabels([road], view, 1000, 600)[0]!.y, 5);
  });

  it('drops a road that is off the canvas or too short to carry its name', () => {
    const far: CampusLine = { ...road, pts: [-117.10, 32.70, -117.08, 32.70] };
    const tiny: CampusLine = { ...road, pts: [-117.24, 32.88, -117.2399, 32.88] };
    expect(roadLabels([far, tiny], view, 1000, 600)).toHaveLength(0);
  });

  it('never bends: a road that curves everywhere under the text goes unlabelled', () => {
    // A tight zigzag — no ~50 px stretch is straight to within the bow limit.
    const pts: number[] = [];
    for (let i = 0; i <= 40; i++) pts.push(-117.25 + i * 0.0005, 32.88 + (i % 2 ? 0.0004 : -0.0004));
    const zig: CampusLine = { ...road, pts };
    expect(roadLabels([zig], view, 1000, 600)).toHaveLength(0);
  });

  it('slides along the road to a straight stretch when the middle is a bend', () => {
    // Straight west half, then a sharp corner and a straight leg south-east.
    const bent: CampusLine = {
      ...road,
      pts: [-117.25, 32.88, -117.24, 32.88, -117.24, 32.878, -117.235, 32.878],
    };
    const [l] = roadLabels([bent], view, 1000, 600);
    expect(l).toBeDefined();
    // Not at the corner (x≈500): on one of the straight legs.
    expect(Math.abs(l!.x - 500)).toBeGreaterThan(40);
  });

  it('dodges obstacles and earlier labels, highways first', () => {
    const first = roadLabels([road], view, 1000, 600)[0]!;
    const chip = [{ x: first.x - 30, y: first.y - 10, w: 60, h: 20 }]; // right on the road's middle
    const [l] = roadLabels([road], view, 1000, 600, chip);
    expect(l).toBeDefined();
    expect(Math.abs(l!.x - 500)).toBeGreaterThan(40); // slid off the chip
    // Two roads on the same line: the highway wins the middle, the other slides.
    const hwy: CampusLine = { ...road, name: 'San Diego Freeway', kind: 'hwy' };
    const both = roadLabels([road, hwy], view, 1000, 600);
    expect(both.map((r) => r.text)).toEqual(['I-5', 'Gilman Dr']);
    expect(both[0]!.x).toBeCloseTo(500, 0);
    expect(Math.abs(both[1]!.x - 500)).toBeGreaterThan(40);
  });
});

describe('roadLabels on a partly visible loop road', () => {
  it('labels only the visible run, not the off-canvas tail', () => {
    const canvasView = fitBounds([project(-117.25, 32.88), project(-117.23, 32.90)], 1000, 1000, 0);
    const u: CampusLine = {
      name: 'Gilman Drive',
      kind: 'major',
      pts: [-117.20, 32.895, -117.232, 32.895, -117.248, 32.895, -117.248, 32.89, -117.20, 32.89],
    };
    const [l] = roadLabels([u], canvasView, 1000, 1000);
    expect(l).toBeDefined();
    expect(l!.x).toBeGreaterThan(0);
    expect(l!.x).toBeLessThan(1000);
    expect(l!.angle).toBeCloseTo(0, 3); // on the horizontal leg
  });
});

describe('buildingShortName / footprintLabelCandidates', () => {
  it('shortens stock words and refuses addresses and very long names', () => {
    expect(buildingShortName('Cognitive Science Building')).toBe('Cognitive Science Bldg');
    expect(buildingShortName('Applied Physics and Mathematics')).toBe('Applied Physics & Mathematics');
    expect(buildingShortName('9500 Gilman Drive')).toBeNull();
    expect(buildingShortName('Sanders Hall')).toBe('Sanders Hall'); // "and" inside a word survives
    expect(buildingShortName('Joan and Irwin Jacobs Center for La Jolla Playhouse')).toBeNull();
  });

  it('lists each footprint once, biggest first, skipping the landmarks', async () => {
    const geo = await loadCampusGeo();
    const cands = footprintLabelCandidates(geo.footprints, new Set(['Geisel Library']));
    const keys = cands.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain('Geisel Library');
    expect(keys).toContain('Center Hall');
    for (let i = 1; i < cands.length; i++) expect(cands[i]!.area).toBeLessThanOrEqual(cands[i - 1]!.area);
    for (const c of cands) {
      expect(c.lon).toBeGreaterThanOrEqual(c.minLon);
      expect(c.lon).toBeLessThanOrEqual(c.maxLon);
    }
  });

  it('ranks the colleges ahead of the outlying districts', () => {
    expect(districtPriority('Warren')).toBeLessThan(districtPriority('Mesa Housing'));
    expect(districtPriority('University Center')).toBe(0);
  });
});

describe('oceanRing', () => {
  it('closes a north→south coastline to the west and past both ends', () => {
    const coast: CampusLine = { name: '', kind: 'coast', pts: [-117.25, 32.9, -117.255, 32.87, -117.26, 32.85] };
    const ring = oceanRing(coast);
    // top extension, 3 chain points, bottom extension, 2 west corners = 7 points
    expect(ring).toHaveLength(14);
    expect(ring[1]).toBeGreaterThan(32.9); // starts above the chain
    expect(ring[2]).toBe(-117.25); // then the chain itself
    expect(ring[10]).toBeLessThan(-117.26); // west corner is west of everything
    expect(ring[12]).toBeLessThan(-117.26);
  });

  it('accepts a south→north chain by walking it the other way', () => {
    const coast: CampusLine = { name: '', kind: 'coast', pts: [-117.26, 32.85, -117.25, 32.9] };
    const ring = oceanRing(coast);
    expect(ring[2]).toBe(-117.25); // chain now starts at its northern end
    expect(ring[3]).toBe(32.9);
  });

  it('bundled coastline yields a ring covering the sea west of Scripps', async () => {
    const geo = await loadCampusGeo();
    const coast = geo.lines.find((l) => l.kind === 'coast')!;
    const ring = oceanRing(coast);
    expect(ring.length).toBeGreaterThan(20);
  });
});

describe('scaleBar', () => {
  it('picks the largest round length that fits 150 px', () => {
    // 3.38 m/px (the desktop home view): 500 m = 148 px fits, 1000 m does not.
    expect(scaleBar(3.38)).toEqual({ metres: 500, px: 500 / 3.38 });
    // Zoomed in 4×: 0.845 m/px → 100 m = 118 px.
    expect(scaleBar(0.845).metres).toBe(100);
    // Absurdly zoomed in: fall back to the smallest step even if it overflows.
    expect(scaleBar(0.01).metres).toBe(25);
  });
});

describe('placeTexts', () => {
  const cand = (key: string, x: number, y: number, w = 60, h = 12) => ({ key, x, y, w, h });

  it('keeps a lone label exactly where it was asked to go', () => {
    expect(placeTexts([cand('a', 100, 100)], [])).toEqual([{ key: 'a', x: 100, y: 100 }]);
  });

  it('slides the later of two colliding labels down, then up', () => {
    const out = placeTexts([cand('a', 100, 100), cand('b', 110, 104)], []);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ key: 'a', x: 100, y: 100 });
    expect(out[1]!.y).toBe(104 + 16); // one step (h + 4) down
  });

  it('avoids obstacles — the pin chips — and drops what fits nowhere', () => {
    // A wall of obstacles covering every slide position.
    const wall = [{ x: 0, y: 0, w: 300, h: 300 }];
    expect(placeTexts([cand('a', 100, 100)], wall)).toEqual([]);
    // A single chip in the way: the label steps over it.
    const chip = [{ x: 70, y: 94, w: 60, h: 12 }];
    const out = placeTexts([cand('a', 100, 100)], chip);
    expect(out).toHaveLength(1);
    expect(out[0]!.y).not.toBe(100);
  });

  it('honours priority order: the first candidate wins the spot', () => {
    const out = placeTexts([cand('big', 100, 100), cand('small', 100, 100)], []);
    expect(out.find((p) => p.key === 'big')!.y).toBe(100);
    expect(out.find((p) => p.key === 'small')!.y).not.toBe(100);
  });
});
