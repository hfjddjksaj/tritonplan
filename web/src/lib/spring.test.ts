import { describe, it, expect } from 'vitest';
import { settled, snap, spring, step, tune } from './spring';

const run = (duration: number, bounce: number, seconds = 1.5) => {
  const s = spring(0, duration, bounce);
  s.to = 1;
  let max = 0;
  for (let i = 0; i < seconds * 60; i++) {
    step(s, 1 / 60);
    max = Math.max(max, s.x);
  }
  return { s, max };
};

describe('spring', () => {
  it('turns a duration and a bounce into stiffness and damping', () => {
    const s = spring(0, 0.5, 0);
    expect(s.k).toBeCloseTo((4 * Math.PI) ** 2, 6);
    expect(s.c).toBeCloseTo(8 * Math.PI, 6);
    expect(tune(s, 0.5, 0.2).c).toBeCloseTo(0.8 * 8 * Math.PI, 6);
  });

  it('arrives without passing its target when bounce is 0', () => {
    const { s, max } = run(0.4, 0);
    expect(max).toBeLessThanOrEqual(1.0001);
    expect(settled(s, 0.001, 0.01)).toBe(true);
  });

  it('passes its target and comes back when it has bounce', () => {
    const { s, max } = run(0.4, 0.3);
    expect(max).toBeGreaterThan(1.02);
    expect(max).toBeLessThan(1.06);
    expect(settled(s, 0.001, 0.01)).toBe(true);
  });

  it('keeps its velocity when retargeted mid-flight', () => {
    const s = spring(0, 0.4, 0);
    s.to = 1;
    step(s, 0.1);
    const v = s.v;
    s.to = -1;
    expect(s.v).toBe(v);
    step(s, 1 / 60);
    expect(s.x).toBeGreaterThan(0);
  });

  it('stays stable through one long frame', () => {
    const s = spring(0, 0.24, 0);
    s.to = 1;
    step(s, 0.034);
    expect(s.x).toBeGreaterThan(0);
    expect(s.x).toBeLessThan(1);
  });

  it('snaps to its target', () => {
    const s = spring(0, 0.4, 0.3);
    s.to = 5;
    step(s, 0.05);
    snap(s);
    expect([s.x, s.v]).toEqual([5, 0]);
  });
});
