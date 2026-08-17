import { describe, it, expect } from 'vitest';
import {
  fitBounds,
  fromScreen,
  metresPerPixel,
  panView,
  project,
  toScreen,
  zoomLevel,
  zoomView,
  type Viewport,
} from './map-projection';

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

describe('pan & zoom', () => {
  const home: Viewport = { scale: 1000, offsetX: 400, offsetY: 300 };

  it('fromScreen inverts toScreen', () => {
    const w = { x: 0.1234, y: 0.5678 };
    const back = fromScreen(toScreen(w, home), home);
    expect(back.x).toBeCloseTo(w.x, 9);
    expect(back.y).toBeCloseTo(w.y, 9);
  });

  it('panView moves every point by the screen delta', () => {
    const w = { x: 0.1, y: 0.2 };
    const before = toScreen(w, home);
    const after = toScreen(w, panView(home, 25, -10));
    expect(after.x - before.x).toBeCloseTo(25);
    expect(after.y - before.y).toBeCloseTo(-10);
  });

  it('zoomView keeps the anchor point fixed on screen', () => {
    const anchor = { x: 123, y: 456 };
    const under = fromScreen(anchor, home);
    const zoomed = zoomView(home, 2.5, anchor);
    const p = toScreen(under, zoomed);
    expect(p.x).toBeCloseTo(anchor.x, 6);
    expect(p.y).toBeCloseTo(anchor.y, 6);
    expect(zoomLevel(zoomed, home)).toBeCloseTo(2.5);
  });

  it('zoomView by 1 is the identity', () => {
    expect(zoomView(home, 1, { x: 9, y: 9 })).toEqual(home);
  });

  it('metresPerPixel shrinks as the map zooms in', () => {
    const near = metresPerPixel(zoomView(home, 2, { x: 0, y: 0 }), 32.88);
    expect(near).toBeCloseTo(metresPerPixel(home, 32.88) / 2);
    // Sanity: 1000 px per radian of longitude at 32.88°N ≈ 5.36 km per pixel.
    expect(metresPerPixel(home, 32.88)).toBeGreaterThan(5000);
    expect(metresPerPixel(home, 32.88)).toBeLessThan(5500);
  });
});
