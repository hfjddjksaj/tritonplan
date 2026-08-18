import { describe, it, expect } from 'vitest';
import { campusViewport, type CampusGeo } from './campus-geo';
import type { MapPin } from './map-pins';
import {
  chipText,
  chipWidth,
  groupPins,
  placeLabels,
  splitByBounds,
  splitByViewport,
  unlocatedPins,
  unplacedPins,
  type PinGroup,
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
  it('carries the matched official name of the first pin', () => {
    const [g] = groupPins([pin({ building: 'York Hal', place: 'York Hall' })]);
    expect(g!.building).toBe('York Hal');
    expect(g!.place).toBe('York Hall');
  });

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
    const home = campusViewport(geo, 800, 600);
    const { onCanvas, offCanvas } = splitByViewport(groups, home, 800, 600);
    expect(onCanvas.map((g) => g.building)).toEqual(['York Hall']);
    expect(offCanvas.map((g) => g.building)).toEqual(['Hillcrest Medical Offices']);
  });

  it('judges against the viewport it is given, not always the home frame', () => {
    const groups = groupPins([pin({})]);
    const home = campusViewport(geo, 800, 600);
    // Panned a full canvas width away: York Hall is off the drawn area.
    const panned = { ...home, offsetX: home.offsetX + 800 };
    expect(splitByViewport(groups, panned, 800, 600).offCanvas.map((g) => g.building)).toEqual(['York Hall']);
  });
});

describe('splitByBounds', () => {
  const inside = { key: 'a', lat: 32.88, lng: -117.235, pins: [] } as unknown as PinGroup;
  const outside = { key: 'b', lat: 32.755, lng: -117.16, pins: [] } as unknown as PinGroup;
  it('separates markers the home frame can show from the ones it cannot', () => {
    const r = splitByBounds([inside, outside], [[-117.25, 32.87], [-117.22, 32.895]]);
    expect(r.onCanvas.map((g) => g.key)).toEqual(['a']);
    expect(r.offCanvas.map((g) => g.key)).toEqual(['b']);
  });
  it('shows nothing until there is a frame', () => {
    expect(splitByBounds([inside], null)).toEqual({ onCanvas: [], offCanvas: [] });
  });
});

describe('chip text', () => {
  it('names one class, counts several', () => {
    const p = (code: string, label: string) => ({ courseCode: code, label } as unknown as MapPin);
    expect(chipText([p('CSE-8A', 'LEC')])).toBe('CSE-8A LEC');
    expect(chipText([p('CSE-8A', 'LEC'), p('CSE-8A', 'DI')])).toBe('CSE-8A +1');
    expect(chipWidth([p('CSE-8A', 'LEC')])).toBeGreaterThan(60);
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
