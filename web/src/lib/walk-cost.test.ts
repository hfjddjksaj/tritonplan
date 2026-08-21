import { describe, expect, it } from 'vitest';
import { PROFILES, PROFILE_ORDER, edgeSeconds, speedAt } from './walk-cost';

describe('speedAt (Tobler, normalised to the flat baseline)', () => {
  const walk = PROFILES.walk;

  it('is exactly the flat speed on the flat', () => {
    expect(speedAt(walk, 0)).toBeCloseTo(walk.flat, 10);
  });

  it('peaks on a gentle downhill, the way Tobler says walking does', () => {
    expect(speedAt(walk, -0.05)).toBeGreaterThan(speedAt(walk, 0));
    expect(speedAt(walk, -0.05)).toBeGreaterThan(speedAt(walk, -0.15));
  });

  it('falls off monotonically going uphill', () => {
    const grades = [0, 0.05, 0.1, 0.2, 0.3];
    const speeds = grades.map((s) => speedAt(walk, s));
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThan(speeds[i - 1]!);
  });

  it('never returns a non-positive speed', () => {
    for (const g of [-1, -0.5, 0, 0.5, 1]) expect(speedAt(walk, g)).toBeGreaterThan(0);
  });
});

describe('edgeSeconds', () => {
  it('takes a flat 100 m at the profile speed', () => {
    expect(edgeSeconds(PROFILES.walk, 100, 0, false)).toBeCloseTo(100 / 1.3, 6);
  });

  it('refuses stairs on a bike rather than pricing them', () => {
    expect(edgeSeconds(PROFILES.bike, 20, 3, true)).toBe(Infinity);
  });

  it('walks stairs at the stair speed, using the 3-D length', () => {
    // 4 m horizontal, 3 m of rise = 5 m of stair
    expect(edgeSeconds(PROFILES.walk, 4, 3, true)).toBeCloseTo(5 / PROFILES.walk.stepsUp, 6);
  });

  it('goes down stairs faster than up them', () => {
    expect(edgeSeconds(PROFILES.walk, 4, -3, true)).toBeLessThan(edgeSeconds(PROFILES.walk, 4, 3, true));
  });

  it('is never negative or NaN for a zero-length edge', () => {
    const t = edgeSeconds(PROFILES.walk, 0, 0, false);
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(0);
  });
});

describe('PROFILES', () => {
  it('marks bike and scooter as estimates, walk as not', () => {
    expect(PROFILES.walk.estimated).toBe(false);
    expect(PROFILES.bike.estimated).toBe(true);
    expect(PROFILES.scooter.estimated).toBe(true);
  });

  it('charges a bike for parking and locking, and nothing else does', () => {
    expect(PROFILES.bike.fixedSeconds).toBeGreaterThan(0);
    expect(PROFILES.walk.fixedSeconds).toBe(0);
    expect(PROFILES.scooter.fixedSeconds).toBe(0);
  });

  it('lists walk first — it is the one this feature stands behind', () => {
    expect(PROFILE_ORDER[0]).toBe('walk');
    expect([...PROFILE_ORDER].sort()).toEqual(['bike', 'scooter', 'walk']);
  });
});
