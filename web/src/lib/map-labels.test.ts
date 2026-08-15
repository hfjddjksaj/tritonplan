import { describe, it, expect } from 'vitest';
import type { MapPin } from './map-pins';
import { groupPins, unlocatedPins, placeLabels } from './map-labels';

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
