import { describe, it, expect } from 'vitest';
import { autoscrollStep, edgePull, gapY, releaseVelocity, slotIndex } from './reorder-geometry';

describe('slotIndex', () => {
  const mids = [50, 150, 250];
  it('counts the cards the reference line has passed', () => {
    expect(slotIndex(49, mids, 0)).toBe(0);
    expect(slotIndex(57, mids, 0)).toBe(1);
    expect(slotIndex(300, mids, 0)).toBe(3);
  });
  it('wants a few pixels past the midpoint before changing sides', () => {
    expect(slotIndex(55, mids, 0)).toBe(0); // 5px past: not yet
    expect(slotIndex(45, mids, 1)).toBe(1); // 5px back: still below card 0
    expect(slotIndex(43, mids, 1)).toBe(0);
  });
});

describe('gapY', () => {
  const spans = [{ top: 12, bottom: 100 }, { top: 112, bottom: 200 }];
  it('sits in the middle of the gap before a card', () => {
    expect(gapY(0, spans, 0)).toBe(6);
    expect(gapY(1, spans, 0)).toBe(106);
    expect(gapY(2, spans, 0)).toBe(206);
  });
  it('falls back when no other card is left', () => {
    expect(gapY(0, [], 40)).toBe(40);
  });
});

describe('releaseVelocity', () => {
  const trail = [{ t: 0, x: 0, y: 0 }, { t: 50, x: 10, y: 100 }];
  it('is the pointer speed over the trail, in px/s', () => {
    expect(releaseVelocity(trail, 55)).toEqual({ vx: 200, vy: 2000 });
  });
  it('is capped', () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 50, x: -500, y: 500 }], 55)).toEqual({ vx: -2600, vy: 2600 });
  });
  it('is zero for a pointer that paused, or with too little to go on', () => {
    expect(releaseVelocity(trail, 200)).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 5, x: 9, y: 9 }], 6)).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity([], 0)).toEqual({ vx: 0, vy: 0 });
  });
});

describe('edgePull', () => {
  it('pulls harder the closer the pointer is to an edge', () => {
    expect(edgePull(300, 100, 500)).toBeCloseTo(0); // 0 or -0
    expect(edgePull(128, 100, 500)).toBe(-0.5);
    expect(edgePull(100, 100, 500)).toBe(-1);
    expect(edgePull(40, 100, 500)).toBe(-1);
    expect(edgePull(472, 100, 500)).toBe(0.5);
    expect(edgePull(560, 100, 500)).toBe(1);
  });
});

describe('autoscrollStep', () => {
  it('scrolls down as asked while the end of the list is still below the floor', () => {
    expect(autoscrollStep(13, 900, 500)).toBe(13);
  });
  it('goes no further down than brings the end of the list up to the floor', () => {
    expect(autoscrollStep(13, 505, 500)).toBe(5);
    expect(autoscrollStep(13, 500, 500)).toBe(0);
    expect(autoscrollStep(13, 480, 500)).toBe(0);
  });
  it('leaves scrolling up alone', () => {
    expect(autoscrollStep(-13, 480, 500)).toBe(-13);
  });
});
