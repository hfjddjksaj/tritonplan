import { describe, it, expect } from 'vitest';
import type { MapPin } from './map-pins';
import { cardDate, cardPlaceName, cardPlacement, cardSections, estimateCardSize } from './map-card';

function pin(over: Partial<MapPin>): MapPin {
  return {
    courseId: 'CSE-30|2026|2',
    courseCode: 'CSE-030',
    hue: 231,
    kind: 'meeting',
    label: 'LEC',
    when: { weekday: 'Mon', start: '11:00', end: '11:50' },
    building: 'Center Hall',
    place: 'Center Hall',
    room: '2622',
    coords: { lat: 32.8779, lng: -117.2415 },
    booked: false,
    ...over,
  };
}

describe('cardSections', () => {
  it('lists one row per component of the course, in order, without times', () => {
    const [s, ...rest] = cardSections([pin({}), pin({ label: 'DIS', room: '2154' })]);
    expect(rest).toEqual([]);
    expect(s!.courseCode).toBe('CSE-030');
    expect(s!.hue).toBe(231);
    expect(s!.rows).toEqual([
      { label: 'LEC', room: '2622' },
      { label: 'DIS', room: '2154' },
    ]);
  });

  it('collapses the weekday copies of one meeting into a single row', () => {
    // A Tue/Thu lecture is two pins under "All"; the card is about rooms, not days.
    const [s] = cardSections([
      pin({ when: { weekday: 'Tue', start: '11:00', end: '12:20' } }),
      pin({ when: { weekday: 'Thu', start: '11:00', end: '12:20' } }),
    ]);
    expect(s!.rows).toEqual([{ label: 'LEC', room: '2622' }]);
  });

  it('keeps two components of one course that meet in different rooms apart', () => {
    const [s] = cardSections([pin({ label: 'DIS', room: 'A' }), pin({ label: 'DIS', room: 'B' })]);
    expect(s!.rows).toEqual([
      { label: 'DIS', room: 'A' },
      { label: 'DIS', room: 'B' },
    ]);
  });

  it('gives every course in the building its own headed section, first come first', () => {
    const sections = cardSections([
      pin({}),
      pin({ courseId: 'MATH-20C|2026|2', courseCode: 'MATH-020C', hue: 12, label: 'DIS', room: '101' }),
      pin({ label: 'DIS', room: '2154' }),
    ]);
    expect(sections.map((s) => s.courseCode)).toEqual(['CSE-030', 'MATH-020C']);
    expect(sections[0]!.rows).toHaveLength(2);
    expect(sections[1]!.rows).toEqual([{ label: 'DIS', room: '101' }]);
  });

  it('tolerates a missing room', () => {
    const [s] = cardSections([pin({ room: undefined })]);
    expect(s!.rows).toEqual([{ label: 'LEC', room: undefined }]);
  });

  it('gives each exam of one course its own dated section, not one section per course', () => {
    const sections = cardSections([
      pin({ kind: 'midterm', label: 'Midterm 1', when: { date: '2026-10-31', start: '10:00', end: '11:50' } }),
      pin({ kind: 'midterm', label: 'Midterm 2', when: { date: '2026-11-14', start: '10:00', end: '11:50' } }),
    ]);
    expect(sections.map((s) => [s.courseCode, s.date, s.rows])).toEqual([
      ['CSE-030', '2026-10-31', [{ label: 'Midterm 1', room: '2622' }]],
      ['CSE-030', '2026-11-14', [{ label: 'Midterm 2', room: '2622' }]],
    ]);
  });

  it('leaves class sections undated', () => {
    expect(cardSections([pin({})])[0]!.date).toBeUndefined();
  });
});

describe('cardDate', () => {
  it('prints weekday, month, two-digit day', () => {
    expect(cardDate('2026-10-31')).toBe('Sat Oct 31');
    expect(cardDate('2026-12-09')).toBe('Wed Dec 09');
  });
});

describe('cardPlacement', () => {
  const canvas = { w: 800, h: 600 };
  const size = { w: 200, h: 80 };

  it('hangs right-below the dot by default', () => {
    expect(cardPlacement({ x: 100, y: 100 }, size, canvas, 0)).toEqual({ left: 112, top: 112 });
  });

  // The card IS the chip, expanded, so it starts where the chip was standing —
  // sharing the edge nearest the dot and growing away from it. Hanging it a fixed
  // gap below-right of the DOT instead left a chip-shaped hole on screen the
  // moment a card opened, since the chip it replaces sits beside the dot.
  it('grows out of the chip when given its box: same near edge, whichever side it is on', () => {
    const dot = { x: 100, y: 100 };
    const right = cardPlacement(dot, size, canvas, 0, { x: 112, y: 89, w: 80, h: 22 });
    expect(right).toEqual({ left: 112, top: 89 }); // shares the chip's left edge

    const left = cardPlacement({ x: 400, y: 100 }, size, canvas, 0, { x: 308, y: 89, w: 80, h: 22 });
    expect(left).toEqual({ left: 308 + 80 - size.w, top: 89 }); // shares its right edge

    const above = cardPlacement(dot, size, canvas, 0, { x: 60, y: 66, w: 80, h: 22 });
    expect(above).toEqual({ left: 60, top: 66 + 22 - size.h }); // shares its bottom edge
  });

  it('falls back to the old corners when the chip-aligned box would not fit', () => {
    // A chip hard against the right edge: aligning the card to it would run the
    // card off the canvas, so the dot-relative candidates take over.
    const p = cardPlacement({ x: 780, y: 100 }, size, canvas, 0, { x: 792, y: 89, w: 60, h: 22 });
    expect(p.left + size.w).toBeLessThanOrEqual(canvas.w - 8);
  });

  it('flips left of the dot when it would run off the right edge', () => {
    const p = cardPlacement({ x: 700, y: 100 }, size, canvas, 0);
    expect(p.left).toBe(700 - 12 - 200);
    expect(p.top).toBe(112);
  });

  it('flips above the dot when it would run off the bottom', () => {
    const p = cardPlacement({ x: 100, y: 580 }, size, canvas, 0);
    expect(p.left).toBe(112);
    expect(p.top).toBe(580 - 12 - 80);
  });

  it('never climbs under the floating header', () => {
    // Anchor just under a 56 px header, flipped up because the canvas is short:
    // the card would cover the header, so it is clamped below it instead.
    const p = cardPlacement({ x: 100, y: 70 }, { w: 200, h: 200 }, { w: 800, h: 220 }, 56);
    expect(p.top).toBeGreaterThanOrEqual(56 + 8);
  });

  it('keeps off the zoom buttons: a card that would cover them flips to the other side', () => {
    // Anchor near the bottom-right; right-below and left-below both hit the
    // bottom edge, right-above would sit on the zoom column, so left-above wins.
    const p = cardPlacement({ x: 760, y: 560 }, size, canvas, 0);
    expect(p).toEqual({ left: 760 - 12 - 200, top: 560 - 12 - 80 });
  });

  it('is clamped inside the canvas when it fits nowhere else', () => {
    const p = cardPlacement({ x: 5, y: 5 }, { w: 780, h: 100 }, canvas, 0);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 780).toBeLessThanOrEqual(800 - 8);
  });
});

describe('estimateCardSize', () => {
  it('grows with the longest line and the number of rows', () => {
    const one = estimateCardSize(cardSections([pin({})]));
    const two = estimateCardSize(cardSections([pin({}), pin({ label: 'DIS', room: '2154' })]));
    const wide = estimateCardSize(cardSections([pin({ room: 'A very long room designation' })]));
    expect(two.h).toBeGreaterThan(one.h);
    expect(two.w).toBe(one.w);
    expect(wide.w).toBeGreaterThan(one.w);
  });

  it('reserves the top row for the building name beside the Directions button', () => {
    const sections = cardSections([pin({})]);
    const short = estimateCardSize(sections, 'York Hall');
    const long = estimateCardSize(sections, 'Computer Science and Engineering Building');
    expect(long.w).toBeGreaterThan(short.w);
    // The name row sits above the first course heading, so even a one-row
    // card is taller than heading + row + padding alone.
    expect(short.h).toBeGreaterThan(22 + 20 + 20);
  });

  it('widens the heading row for a dated section', () => {
    const plain = estimateCardSize(cardSections([pin({})]));
    const dated = estimateCardSize(
      cardSections([pin({ kind: 'final', label: 'Final', when: { date: '2026-12-09', start: '11:30', end: '14:29' } })]),
    );
    expect(dated.w).toBeGreaterThan(plain.w);
    expect(dated.h).toBe(plain.h);
  });
});

describe('cardPlaceName', () => {
  it('leaves a short name alone, even when a stock word could be shortened', () => {
    expect(cardPlaceName('Center Hall')).toBe('Center Hall');
    expect(cardPlaceName('Galbraith Hall')).toBe('Galbraith Hall');
  });

  it('shortens the stock words of a name that would not fit on the card', () => {
    expect(cardPlaceName('Computer Science and Engineering Building')).toBe('Computer Science & Eng Bldg');
    expect(cardPlaceName('Student Services Center')).toBe('Student Services Center');
  });

  it('never invents a name: an address stays an address', () => {
    expect(cardPlaceName('9500 Gilman Drive Building 3')).toBe('9500 Gilman Drive Building 3');
  });

  it('does not abbreviate a direction word when shortening a long name (regression, shares abbreviateBuildingWords with map-names.ts)', () => {
    // Real UCSD footprint name, 37 chars — over PLACE_VERBATIM_MAX, so this
    // goes through abbreviateBuildingWords. It used to come back "Cellular &
    // Molecular Medicine E"; "East" here is part of the name, not a street
    // direction, so it must survive untouched.
    expect(cardPlaceName('Cellular and Molecular Medicine East')).toBe('Cellular & Molecular Medicine East');
  });
});
