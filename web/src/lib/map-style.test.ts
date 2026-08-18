import { describe, it, expect } from 'vitest';
import { buildStyle, hostFilter, hostFill, hostLine, applyHosts, applyMode, GROUND_COLORS, LAYER, MAP_FONT_REGULAR, MAP_FONT_BOLD, assetBase, type StyleTarget } from './map-style';
import { buildSources } from './map-data';
import { loadCampusGeo, loadCampusMap } from './campus-geo';
import { colorsForHue } from './colors';
import { FakeMap } from '../test/fake-maplibre';
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
    for (const id of [LAYER.buildings3d, LAYER.hosts3d, LAYER.trees3d]) expect((s.layers.find((l) => l.id === id)!.layout as { visibility?: string }).visibility).toBe('none');
  });
  it('sets district names to the official map’s proportions, not a size that eats them', async () => {
    // QA I5: at 13 px / 0.2 em these ran ~1.2x taller and ~25 % wider per word than
    // the official map's ~10-11 px untracked, which is what turned WARREN into WAR
    // and EAST CAMPUS OPEN SPACE PRESERVE into three fragments under a course chip.
    // Pinned so a revert to 13 / 0.2 is a failing test rather than a quiet
    // regression nobody sees until the next browser pass.
    const s = buildStyle({ sources: buildSources(await loadCampusGeo(), await loadCampusMap()), assetBase: '/' });
    const layout = s.layers.find((l) => l.id === LAYER.districtNames)!.layout as Record<string, unknown>;
    expect(layout['text-size']).toBe(11);
    expect(layout['text-letter-spacing']).toBe(0.08);
    // Still smaller than the landmark tier above it, so the hierarchy survives.
    const landmark = s.layers.find((l) => l.id === LAYER.landmarkNames)!.layout as Record<string, unknown>;
    expect(layout['text-size']).toBeLessThan(landmark['text-size'] as number);
  });
  it('draws road names in mixed case, the user’s preference over uppercase', async () => {
    // Reverses this plan's original Ruling 10 (uppercase) — the user's own
    // call, made after seeing the official UCSD map's mixed-case labels.
    // Pinned so a revert to uppercase is a failing test, not a quiet
    // regression nobody sees until the next browser pass.
    const s = buildStyle({ sources: buildSources(await loadCampusGeo(), await loadCampusMap()), assetBase: '/' });
    const layout = s.layers.find((l) => l.id === LAYER.roadNames)!.layout as Record<string, unknown>;
    expect(layout['text-transform']).not.toBe('uppercase');
    // 0.12 em was uppercase tracking; unchanged on mixed case it reads as
    // broken gaps between letters, so it must have come down with the case.
    expect(layout['text-letter-spacing']).toBeLessThan(0.05);
    // district-names is a different layer with its own tracking (0.08 em) —
    // this change must not have touched it.
    const district = s.layers.find((l) => l.id === LAYER.districtNames)!.layout as Record<string, unknown>;
    expect(district['text-letter-spacing']).toBe(0.08);
  });
  it('pins the spec palette-table anchor colours exactly, and both Pool/Fountain spellings alike', () => {
    // Anchors named directly, row by row, in the spec §1 palette table.
    expect(GROUND_COLORS['Grass']).toBe('#D4E5B9');
    expect(GROUND_COLORS['Planter']).toBe('#B5C7A2');
    expect(GROUND_COLORS['Walking Path']).toBe('#F2EEE9');
    expect(GROUND_COLORS['Bike Path']).toBe('#F2EEE9');
    expect(GROUND_COLORS['Sidewalk']).toBe('#E1E1E1');
    expect(GROUND_COLORS['Street']).toBe('#CCCCCC');
    expect(GROUND_COLORS['Service Road']).toBe('#CCCCCC');
    expect(GROUND_COLORS['Parking Lot']).toBe('#B2B2B2');
    expect(GROUND_COLORS['Building']).toBe('#DCDAD4');
    // Both spellings that occur upstream must resolve to the same colour.
    expect(GROUND_COLORS['Pool/Fountain']).toBe(GROUND_COLORS['Pool / Fountain']);
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
  it("hostFill and hostLine pair each host with its OWN hue's colour, not just any hue in the set", () => {
    const gs = [group('Center Hall', 231), group('York Hall', 12)];
    const fill = hostFill(gs) as unknown[];
    const line = hostLine(gs) as unknown[];
    const valueAfter = (arr: unknown[], name: string) => arr[arr.indexOf(name) + 1];
    expect(valueAfter(fill, 'Center Hall')).toBe(colorsForHue(231).fill);
    expect(valueAfter(fill, 'York Hall')).toBe(colorsForHue(12).fill);
    expect(valueAfter(line, 'Center Hall')).toBe(colorsForHue(231).spine);
    expect(valueAfter(line, 'York Hall')).toBe(colorsForHue(12).spine);
  });
  it('applyHosts writes filter and colours to the three host layers', () => {
    const calls: unknown[][] = [];
    const t: StyleTarget = { setPaintProperty: (...a) => calls.push(['paint', ...a]), setLayoutProperty: (...a) => calls.push(['layout', ...a]), setFilter: (...a) => calls.push(['filter', ...a]) };
    applyHosts(t, [group('Center Hall', 231)]);
    const filtered = calls.filter((c) => c[0] === 'filter').map((c) => c[1]);
    expect(filtered).toEqual(expect.arrayContaining([LAYER.hosts, LAYER.hostsLine, LAYER.hosts3d]));
    expect(calls.some((c) => c[0] === 'paint' && c[1] === LAYER.hosts3d && c[2] === 'fill-extrusion-color')).toBe(true);
  });
  it('applyHosts also writes fill-color on hosts and line-color on hosts-line, not only the 3D extrusion', () => {
    const gs = [group('Center Hall', 231)];
    const map = new FakeMap({});
    applyHosts(map, gs);
    const paintValue = (id: string, prop: string) =>
      map.calls.find((c) => c.method === 'setPaintProperty' && c.args[0] === id && c.args[1] === prop)?.args[2];
    expect(paintValue(LAYER.hosts, 'fill-color')).toEqual(hostFill(gs));
    expect(paintValue(LAYER.hostsLine, 'line-color')).toEqual(hostLine(gs));
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
  it('applyMode(_, "3d") sets the EXACT set of visibility flips the brief lists, not a superset that happens to include the right ones', () => {
    const map = new FakeMap({});
    applyMode(map, '3d');
    const visibility: Record<string, unknown> = {};
    for (const c of map.calls) if (c.method === 'setLayoutProperty' && c.args[1] === 'visibility') visibility[c.args[0] as string] = c.args[2];
    expect(visibility).toEqual({
      [LAYER.buildings]: 'none',
      [LAYER.buildingsLine]: 'none',
      [LAYER.hosts]: 'none',
      [LAYER.hostsLine]: 'none',
      [LAYER.buildings3d]: 'visible',
      [LAYER.hosts3d]: 'visible',
      [LAYER.trees]: 'visible',
      [LAYER.trees3d]: 'none',
    });
  });
  it('applyMode(_, "2d") sets the EXACT set of visibility flips the brief lists', () => {
    const map = new FakeMap({});
    applyMode(map, '2d');
    const visibility: Record<string, unknown> = {};
    for (const c of map.calls) if (c.method === 'setLayoutProperty' && c.args[1] === 'visibility') visibility[c.args[0] as string] = c.args[2];
    expect(visibility).toEqual({
      [LAYER.buildings]: 'visible',
      [LAYER.buildingsLine]: 'visible',
      [LAYER.hosts]: 'visible',
      [LAYER.hostsLine]: 'visible',
      [LAYER.buildings3d]: 'none',
      [LAYER.hosts3d]: 'none',
      [LAYER.trees]: 'visible',
      [LAYER.trees3d]: 'none',
    });
  });
  it('applyMode(_, "3d", true) asks maplibre for the documented terrain source and exaggeration', () => {
    const map = new FakeMap({});
    applyMode(map, '3d', true);
    const call = map.calls.find((c) => c.method === 'setTerrain');
    expect(call?.args[0]).toEqual({ source: 'terrain', exaggeration: 1.2 });
  });
});

describe('assetBase', () => {
  it('is an absolute directory URL on the page origin', () => {
    const b = assetBase();
    expect(b.startsWith(window.location.origin)).toBe(true);
    expect(b.endsWith('/')).toBe(true);
  });
});
