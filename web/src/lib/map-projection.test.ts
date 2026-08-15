import { describe, it, expect } from 'vitest';
import { project, fitBounds, toScreen } from './map-projection';

describe('project', () => {
  it('maps longitude linearly and puts the equator at y = 0', () => {
    const p = project(0, 0);
    expect(p.x).toBe(0);
    expect(p.y).toBeCloseTo(0, 14);
    expect(project(180, 0).x).toBeCloseTo(Math.PI, 10);
  });

  it('keeps north above south and east right of west', () => {
    const geisel = project(-117.2374, 32.8811);
    const center = project(-117.2415, 32.8779);
    expect(geisel.x).toBeGreaterThan(center.x); // Geisel is east of Center Hall
    expect(geisel.y).toBeGreaterThan(center.y); // and north of it
  });
});

describe('fitBounds + toScreen', () => {
  const a = project(-117.2465, 32.8680);
  const b = project(-117.2280, 32.8905);

  it('places the corner points inside the padded viewport', () => {
    const v = fitBounds([a, b], 800, 600, 40);
    for (const p of [a, b]) {
      const s = toScreen(p, v);
      expect(s.x).toBeGreaterThanOrEqual(40 - 0.001);
      expect(s.x).toBeLessThanOrEqual(760 + 0.001);
      expect(s.y).toBeGreaterThanOrEqual(40 - 0.001);
      expect(s.y).toBeLessThanOrEqual(560 + 0.001);
    }
  });

  it('flips the y axis so north is up on screen', () => {
    const v = fitBounds([a, b], 800, 600, 40);
    expect(toScreen(b, v).y).toBeLessThan(toScreen(a, v).y);
  });

  it('preserves aspect ratio — one scale for both axes', () => {
    const v = fitBounds([a, b], 800, 200, 0);
    const sa = toScreen(a, v);
    const sb = toScreen(b, v);
    const usedW = Math.abs(sb.x - sa.x);
    const usedH = Math.abs(sb.y - sa.y);
    expect(usedW).toBeLessThanOrEqual(800 + 0.001);
    expect(usedH).toBeLessThanOrEqual(200 + 0.001);
    // The short axis is the binding one, so it is filled.
    expect(usedH).toBeCloseTo(200, 3);
  });

  it('centres a single point instead of dividing by zero', () => {
    const v = fitBounds([a], 800, 600, 20);
    const s = toScreen(a, v);
    expect(Number.isFinite(v.scale)).toBe(true);
    expect(s.x).toBeCloseTo(400, 6);
    expect(s.y).toBeCloseTo(300, 6);
  });

  it('centres rather than crashing on no points at all', () => {
    const v = fitBounds([], 800, 600, 20);
    expect(Number.isFinite(v.scale)).toBe(true);
  });
});
