import { describe, it, expect } from 'vitest';
import { FakeMap } from './fake-maplibre';

describe('FakeMap (test double for maplibre-gl)', () => {
  it('projects deterministically around its centre at its zoom', () => {
    const m = new FakeMap({ container: document.createElement('div'), style: { version: 8, sources: {}, layers: [] } });
    m.jumpTo({ center: [-117.235, 32.88], zoom: 15 });
    const c = m.project([-117.235, 32.88]);
    expect(c.x).toBeCloseTo(FakeMap.size.w / 2);
    expect(c.y).toBeCloseTo(FakeMap.size.h / 2);
    const east = m.project([-117.225, 32.88]);
    expect(east.x).toBeGreaterThan(c.x);
    const north = m.project([-117.235, 32.89]);
    expect(north.y).toBeLessThan(c.y);
  });

  it('fires load asynchronously and move events on camera changes', async () => {
    const m = new FakeMap({ container: document.createElement('div'), style: { version: 8, sources: {}, layers: [] } });
    const seen: string[] = [];
    m.on('load', () => seen.push('load'));
    m.on('move', () => seen.push('move'));
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual(['load']);
    m.easeTo({ zoom: 16 });
    expect(seen).toEqual(['load', 'move']);
    expect(m.getZoom()).toBe(16);
  });

  it('records style mutations and hands back bounds that contain its centre', () => {
    const m = new FakeMap({ container: document.createElement('div'), style: { version: 8, sources: {}, layers: [] } });
    m.jumpTo({ center: [-117.235, 32.88], zoom: 15 });
    m.setPaintProperty('hosts', 'fill-color', '#fff');
    expect(m.calls.at(-1)).toEqual({ method: 'setPaintProperty', args: ['hosts', 'fill-color', '#fff'] });
    expect(m.getBounds().contains([-117.235, 32.88])).toBe(true);
    expect(m.getBounds().contains([-117.16, 32.755])).toBe(false); // Hillcrest
    expect(FakeMap.instances).toContain(m);
  });
});
