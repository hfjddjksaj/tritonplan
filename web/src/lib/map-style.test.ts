import { describe, it, expect } from 'vitest';
import { buildStyle, hostFilter, hostFill, applyHosts, applyMode, GROUND_COLORS, LAYER, MAP_FONT_REGULAR, MAP_FONT_BOLD, assetBase, type StyleTarget } from './map-style';
import { buildSources } from './map-data';
import { loadCampusGeo, loadCampusMap } from './campus-geo';
import type { PinGroup } from './map-labels';

const group = (place: string, hue: number): PinGroup => ({ key: place, lat: 0, lng: 0, place, pins: [{ hue } as never] });

describe('buildStyle', () => {
  it('draws the official stack in order and only ever points at our own origin', async () => {
    const s = buildStyle({ sources: buildSources(await loadCampusGeo(), await loadCampusMap()), assetBase: 'https://example.test/app/' });
    const ids = s.layers.map((l) => l.id);
    expect(ids.indexOf(LAYER.ocean)).toBeLessThan(ids.indexOf(LAYER.campus));
    expect(ids.indexOf(LAYER.campus)).toBeLessThan(ids.indexOf(LAYER.ground));
    expect(ids.indexOf(LAYER.ground)).toBeLessThan(ids.indexOf(LAYER.buildings));
    expect(ids.indexOf(LAYER.buildings)).toBeLessThan(ids.indexOf(LAYER.hosts));
    expect(ids.indexOf(LAYER.roads)).toBeLessThan(ids.indexOf(LAYER.trees));
    expect(ids.indexOf(LAYER.trees)).toBeLessThan(ids.indexOf(LAYER.roadNames));
    expect(ids.at(-1)).toBe(LAYER.buildingNames);
    expect(s.glyphs).toBe('https://example.test/app/map/fonts/{fontstack}/{range}.pbf');
    const json = JSON.stringify(s);
    expect(json.match(/https?:\/\//g)!.every((u) => u === 'https://')).toBe(true);
    expect((json.match(/https:\/\/[^"]+/g) ?? []).every((u) => u.startsWith('https://example.test/app/'))).toBe(true);
    expect(s.sprite).toBeUndefined();
  });
  it('gives every ground type in the data a colour', async () => {
    const m = await loadCampusMap();
    for (const t of new Set(m.ground.map((g) => g.type))) expect(GROUND_COLORS[t], t).toMatch(/^#[0-9A-F]{6}$/i);
  });
  it('uses only the two bundled Inter stacks', async () => {
    const s = buildStyle({ sources: buildSources(await loadCampusGeo(), await loadCampusMap()), assetBase: '/' });
    const fonts = new Set(s.layers.flatMap((l) => (l.type === 'symbol' ? ((l.layout as { 'text-font'?: string[] })['text-font'] ?? []) : [])));
    expect(fonts).toEqual(new Set([MAP_FONT_REGULAR, MAP_FONT_BOLD]));
  });
  it('starts with 3D layers hidden', async () => {
    const s = buildStyle({ sources: buildSources(await loadCampusGeo(), await loadCampusMap()), assetBase: '/' });
    for (const id of [LAYER.buildings3d, LAYER.hosts3d]) expect((s.layers.find((l) => l.id === id)!.layout as { visibility?: string }).visibility).toBe('none');
  });
});

describe('hosts', () => {
  it('filters to the host names and colours each by its course', () => {
    const gs = [group('Center Hall', 231), group('York Hall', 12)];
    expect(hostFilter(gs)).toEqual(['in', ['get', 'name'], ['literal', ['Center Hall', 'York Hall']]]);
    const fill = hostFill(gs) as unknown[];
    expect(fill[0]).toBe('match'); expect(fill).toContain('Center Hall'); expect(fill).toContain('York Hall');
    expect(hostFill([])).toBe('#DCDAD4');
  });
  it('applyHosts writes filter and colours to the three host layers', () => {
    const calls: unknown[][] = [];
    const t: StyleTarget = { setPaintProperty: (...a) => calls.push(['paint', ...a]), setLayoutProperty: (...a) => calls.push(['layout', ...a]), setFilter: (...a) => calls.push(['filter', ...a]) };
    applyHosts(t, [group('Center Hall', 231)]);
    const filtered = calls.filter((c) => c[0] === 'filter').map((c) => c[1]);
    expect(filtered).toEqual(expect.arrayContaining([LAYER.hosts, LAYER.hostsLine, LAYER.hosts3d]));
    expect(calls.some((c) => c[0] === 'paint' && c[1] === LAYER.hosts3d && c[2] === 'fill-extrusion-color')).toBe(true);
  });
  it('applyMode flips visibility between the flat and extruded building layers', () => {
    const calls: unknown[][] = [];
    const t: StyleTarget = { setPaintProperty: () => {}, setLayoutProperty: (...a) => calls.push(a), setFilter: () => {}, setTerrain: (x) => calls.push(['terrain', x]) };
    applyMode(t, '3d');
    expect(calls).toContainEqual([LAYER.buildings3d, 'visibility', 'visible']);
    expect(calls).toContainEqual([LAYER.buildings, 'visibility', 'none']);
    calls.length = 0; applyMode(t, '2d');
    expect(calls).toContainEqual([LAYER.buildings, 'visibility', 'visible']);
    expect(calls).toContainEqual([LAYER.hosts3d, 'visibility', 'none']);
    expect(calls).toContainEqual(['terrain', null]);
  });
});

describe('assetBase', () => {
  it('is an absolute directory URL on the page origin', () => {
    const b = assetBase();
    expect(b.startsWith(window.location.origin)).toBe(true);
    expect(b.endsWith('/')).toBe(true);
  });
});
