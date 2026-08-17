import { describe, it, expect } from 'vitest';
import type { CampusGeo } from './campus-geo';
import type { MapPin } from './map-pins';
import {
  groupPins,
  onCanvasGroups,
  placeLabels,
  splitByViewport,
  unlocatedPins,
  unplacedPins,
} from './map-labels';

function pin(over: Partial<MapPin>): MapPin {
  return {
    courseId: 'C|2026|2',
    courseCode: 'CSE-8A',
    hue: 231,
    kind: 'meeting',
    label: 'LEC',
    when: { weekday: 'Mon', start: '11:00', end: '11:50' },
    building: 'York Hall',
    room: '2622',
    coords: { lat: 32.8745, lng: -117.2405 },
    booked: false,
    ...over,
  };
}

describe('groupPins', () => {
  it('merges pins that share a building into one marker', () => {
    const groups = groupPins([
      pin({ label: 'LEC' }),
      pin({ label: 'LAB', when: { weekday: 'Fri', start: '13:00', end: '15:50' } }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.pins.map((p) => p.label)).toEqual(['LEC', 'LAB']);
    expect(groups[0]!.building).toBe('York Hall');
  });

  it('keeps distinct buildings apart', () => {
    const groups = groupPins([
      pin({}),
      pin({ building: 'Center Hall', coords: { lat: 32.8779, lng: -117.2415 } }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('excludes pins with no coordinates', () => {
    expect(groupPins([pin({ coords: null })])).toEqual([]);
  });

  it('is stable — same input, same key order', () => {
    const input = [pin({}), pin({ building: 'Center Hall', coords: { lat: 32.8779, lng: -117.2415 } })];
    expect(groupPins(input).map((g) => g.key)).toEqual(groupPins(input).map((g) => g.key));
  });
});

describe('unlocatedPins', () => {
  it('returns exactly the pins the map cannot draw', () => {
    const out = unlocatedPins([pin({}), pin({ coords: null, building: 'Mystery Hall' })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.building).toBe('Mystery Hall');
  });
});

/** A one-district campus: enough to fix a viewport around Revelle-sized ground. */
const geo: CampusGeo = {
  footprints: [],
  districts: [
    { name: 'Revelle', rings: [[-117.243, 32.872, -117.238, 32.872, -117.238, 32.877]] },
  ],
  lines: [],
};

/** UCSD Health's Hillcrest campus — real, in the point data, 13 km off this map. */
const HILLCREST = { lat: 32.755, lng: -117.166 };

describe('splitByViewport', () => {
  it('separates markers the canvas can show from the ones it cannot', () => {
    const groups = groupPins([
      pin({}),
      pin({ building: 'Hillcrest Medical Offices', coords: HILLCREST }),
    ]);
    const { onCanvas, offCanvas } = splitByViewport(groups, geo, 800, 600);
    expect(onCanvas.map((g) => g.building)).toEqual(['York Hall']);
    expect(offCanvas.map((g) => g.building)).toEqual(['Hillcrest Medical Offices']);
  });

  it('onCanvasGroups is exactly the drawable half', () => {
    const groups = groupPins([pin({}), pin({ building: 'Far', coords: HILLCREST })]);
    expect(onCanvasGroups(groups, geo, 800, 600).map((g) => g.building)).toEqual(['York Hall']);
  });
});

describe('unplacedPins', () => {
  it('says an online class is online rather than blaming the building match', () => {
    const out = unplacedPins([
      pin({ coords: null, building: undefined, rawLocation: undefined, modality: 'Live Online' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe('online');
    expect(out[0]!.detail).toBe('Live Online');
  });

  it('shows the raw TSS text for a building it could not match', () => {
    const out = unplacedPins([
      pin({ coords: null, building: 'Mystery Hall', rawLocation: 'Mystery Hall 101', modality: 'In Person' }),
    ]);
    expect(out[0]!.reason).toBe('unmatched');
    expect(out[0]!.detail).toBe('Mystery Hall 101');
  });

  it('says so plainly when TSS listed no location at all', () => {
    const out = unplacedPins([pin({ coords: null, building: undefined, rawLocation: undefined })]);
    expect(out[0]!.reason).toBe('unmatched');
    expect(out[0]!.detail).toBe('no location listed in TSS');
  });

  it('surfaces a real location that falls outside the mapped area', () => {
    const off = groupPins([pin({ building: 'Hillcrest Medical Offices', coords: HILLCREST })]);
    const out = unplacedPins([], off);
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe('off-map');
    expect(out[0]!.detail).toBe('Hillcrest Medical Offices — outside the mapped area');
  });

  it('is empty when every pin is drawn', () => {
    expect(unplacedPins([pin({})], [])).toEqual([]);
  });
});

describe('placeLabels', () => {
  it('puts a lone label to the right of its anchor', () => {
    const [placed] = placeLabels([{ key: 'a', x: 100, y: 100, w: 60, h: 16 }]);
    expect(placed!.side).toBe('right');
    expect(placed!.x).toBeGreaterThan(100);
  });

  it('moves a colliding label off the right side', () => {
    const placed = placeLabels([
      { key: 'a', x: 100, y: 100, w: 60, h: 16 },
      { key: 'b', x: 108, y: 102, w: 60, h: 16 },
    ]);
    expect(placed[0]!.side).toBe('right');
    expect(placed[1]!.side).not.toBe('right');
  });

  it('returns one placement per anchor, preserving keys', () => {
    const placed = placeLabels([
      { key: 'a', x: 10, y: 10, w: 40, h: 16 },
      { key: 'b', x: 12, y: 11, w: 40, h: 16 },
      { key: 'c', x: 14, y: 12, w: 40, h: 16 },
      { key: 'd', x: 16, y: 13, w: 40, h: 16 },
      { key: 'e', x: 18, y: 14, w: 40, h: 16 },
    ]);
    expect(placed.map((p) => p.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('placeLabels near the canvas edge', () => {
  it('puts the chip on the side that stays on the canvas', () => {
    // A marker 5 px from the left edge: 'left' would start at x < 0.
    const [p] = placeLabels([{ key: 'a', x: 5, y: 100, w: 60, h: 16 }], { w: 400, h: 300 });
    expect(p!.side).toBe('right');
    // A marker 5 px from the right edge: 'right' overflows, so 'left' wins.
    const [q] = placeLabels([{ key: 'b', x: 395, y: 100, w: 60, h: 16 }], { w: 400, h: 300 });
    expect(q!.side).toBe('left');
    // Without bounds, the old behaviour: right first, always.
    expect(placeLabels([{ key: 'b', x: 395, y: 100, w: 60, h: 16 }])[0]!.side).toBe('right');
  });
});
