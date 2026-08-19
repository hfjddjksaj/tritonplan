import { describe, it, expect } from 'vitest';
import { buildStyle, hostFilter, hostFill, hostFill3d, hostLine, applyHosts, applyMode, modeForPitch, CAMERA, GROUND_COLORS, LAYER, MAP_PALETTE, MAP_FONT_REGULAR, MAP_FONT_BOLD, assetBase, TREE_ICON, TERRAIN_SOURCE, HILLSHADE_SOURCE, TERRAIN_BOUNDS, TERRAIN_MINZOOM, TERRAIN_MAXZOOM, type StyleTarget } from './map-style';
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
  it('keeps every flat layer BELOW the extrusions, which is what gives 3D its depth', async () => {
    // MapLibre hands every layer at or after the first fill-extrusion
    // `DepthMode.disabled` (painter: `currentLayer < opaquePassCutoff`, and the
    // cutoff IS that first 3D layer), so anything ordered after the extrusions
    // ignores the depth buffer and paints over them. That is literally what the
    // 3D trees did — the wood behind Geisel drew on Geisel's roof — and the
    // roads did it too, more quietly. Order is the whole fix, so it is asserted
    // rather than left to the comment.
    const s = buildStyle({ sources: buildSources(await loadCampusGeo(), await loadCampusMap()), assetBase: 'https://example.test/app/' });
    const ids = s.layers.map((l) => l.id);
    const firstExtrusion = Math.min(ids.indexOf(LAYER.buildings3d), ids.indexOf(LAYER.hosts3d));
    expect(firstExtrusion).toBeGreaterThan(-1);
    for (const flat of [LAYER.ground, LAYER.buildings, LAYER.hosts, LAYER.roadsCasing, LAYER.roads, LAYER.trees, LAYER.trees3d]) {
      expect(ids.indexOf(flat), flat).toBeLessThan(firstExtrusion);
    }
    // Labels stay ABOVE on purpose: a building's name has to survive its own block.
    for (const label of [LAYER.roadNames, LAYER.districtNames, LAYER.landmarkNames, LAYER.buildingNames]) {
      expect(ids.indexOf(label), label).toBeGreaterThan(firstExtrusion);
    }
    // 2D's visible stacking is unchanged by the move.
    expect(ids.indexOf(LAYER.buildings)).toBeLessThan(ids.indexOf(LAYER.hosts));
    expect(ids.indexOf(LAYER.hosts)).toBeLessThan(ids.indexOf(LAYER.roads));
    expect(ids.indexOf(LAYER.roads)).toBeLessThan(ids.indexOf(LAYER.trees));
  });

  it('adds the hillshade layer and the DEM source only when terrain is asked for — and still points nowhere but our own origin', async () => {
    const sources = buildSources(await loadCampusGeo(), await loadCampusMap());
    const flat = buildStyle({ sources, assetBase: 'https://example.test/app/' });
    expect(flat.layers.some((l) => l.id === LAYER.hillshade)).toBe(false);
    expect((flat.sources as Record<string, unknown>)[TERRAIN_SOURCE]).toBeUndefined();

    const relief = buildStyle({ sources, assetBase: 'https://example.test/app/', terrain: true });
    const ids = relief.layers.map((l) => l.id);
    // Over the water, under everything the campus itself draws.
    expect(ids.indexOf(LAYER.ocean)).toBeLessThan(ids.indexOf(LAYER.hillshade));
    expect(ids.indexOf(LAYER.hillshade)).toBeLessThan(ids.indexOf(LAYER.campus));

    // Two sources, one set of files: MapLibre asks for a separate DEM source for
    // shading and for displacement, and both must be the bundled one.
    expect((relief.sources as Record<string, unknown>)[HILLSHADE_SOURCE]).toEqual(
      (relief.sources as Record<string, unknown>)[TERRAIN_SOURCE],
    );
    expect((relief.layers.find((l) => l.id === LAYER.hillshade) as { source: string }).source).toBe(HILLSHADE_SOURCE);
    const dem = (relief.sources as Record<string, Record<string, unknown>>)[TERRAIN_SOURCE]!;
    expect(dem.type).toBe('raster-dem');
    expect(dem.encoding).toBe('terrarium'); // what the bundled tiles are; anything else decodes to spikes
    expect((dem.tiles as string[])[0]).toBe('https://example.test/app/map/terrain/{z}/{x}/{y}.png');
    expect([dem.minzoom, dem.maxzoom]).toEqual([TERRAIN_MINZOOM, TERRAIN_MAXZOOM]);
    expect(dem.bounds).toEqual(TERRAIN_BOUNDS);
    // The red line, restated for the terrain-on style: no DEM service, no CDN.
    const json = JSON.stringify(relief);
    expect((json.match(/https:\/\/[^"]+/g) ?? []).every((u) => u.startsWith('https://example.test/app/'))).toBe(true);
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
    // The extrusion takes the SATURATED colour, not the flat wash — see below.
    expect(paintValue(LAYER.hosts3d, 'fill-extrusion-color')).toEqual(hostFill3d(gs));
  });

  it('paints extruded hosts in the course spine colour, because the flat wash goes white when it is lit', () => {
    // Browser QA, 3D at home zoom: with the 2D fill (`hsl(h 68% 96.5%)`) on the
    // extrusion, the student's own building was one more white block among grey
    // ones — an outline identifies a host in 2D, and an extrusion has no outline.
    const gs = [
      { key: 'a', lat: 0, lng: 0, place: 'York Hall', pins: [{ hue: 231 }] },
    ] as unknown as PinGroup[];
    const flat = hostFill(gs) as unknown[];
    const solid = hostFill3d(gs) as unknown[];
    expect(solid).not.toEqual(flat);
    expect(solid).toContain(colorsForHue(231).spine);
    // With nothing booked it must not tint every building on campus.
    expect(hostFill3d([])).toBe(MAP_PALETTE.building3d);
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
      [LAYER.trees]: 'none',
      [LAYER.trees3d]: 'visible',
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
  it('draws 3D trees as viewport-aligned billboards on the same points as the flat circles', async () => {
    const style = buildStyle({ sources: buildSources(await loadCampusGeo(), await loadCampusMap()), assetBase: 'https://example.test/app/' });
    const layer = style.layers.find((l) => l.id === LAYER.trees3d)!;
    expect(layer.type).toBe('symbol');
    expect((layer as { source: string }).source).toBe(LAYER.trees);
    const layout = (layer as { layout: Record<string, unknown> }).layout;
    expect(layout['icon-image']).toBe(TREE_ICON);
    // A billboard, not a decal: upright and facing the camera at any pitch or bearing.
    expect(layout['icon-pitch-alignment']).toBe('viewport');
    expect(layout['icon-rotation-alignment']).toBe('viewport');
    // Anchored at its foot, so the trunk meets the ground at the tree's own point.
    expect(layout['icon-anchor']).toBe('bottom');
    // A canopy dropped because a neighbour claimed the space is a hole in a wood.
    expect(layout['icon-allow-overlap']).toBe(true);
    expect(layout.visibility).toBe('none'); // 3D turns it on; see applyMode
    expect((layer as { minzoom: number }).minzoom).toBe(15);
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

describe('modeForPitch', () => {
  // The camera could always be dragged onto its edge in 2D, which left the map
  // in a pose UCSD's own map does not allow at all: flat buildings under a
  // horizon. The tilt gesture now decides the mode instead of being ignored.
  it('stands the map up once a drag passes the entry pitch', () => {
    expect(modeForPitch(CAMERA.enter3dPitch, '2d')).toBe('3d');
    expect(modeForPitch(CAMERA.mode3d.pitch, '2d')).toBe('3d');
  });

  it('lays it flat again once the drag comes back down', () => {
    expect(modeForPitch(CAMERA.exit3dPitch, '3d')).toBe('2d');
    expect(modeForPitch(0, '3d')).toBe('2d');
  });

  it('holds the current mode between the two, so a camera parked on the line cannot flap', () => {
    const mid = (CAMERA.enter3dPitch + CAMERA.exit3dPitch) / 2;
    expect(modeForPitch(mid, '2d')).toBe('2d');
    expect(modeForPitch(mid, '3d')).toBe('3d');
    expect(CAMERA.exit3dPitch).toBeLessThan(CAMERA.enter3dPitch);
  });

  it('sets the entry pitch clear of an accidental nudge and short of the button target', () => {
    expect(CAMERA.enter3dPitch).toBeGreaterThan(10);
    expect(CAMERA.enter3dPitch).toBeLessThan(CAMERA.mode3d.pitch);
  });
});

describe('hosts of a building complex', () => {
  // matchBuilding resolves "Asante House" to a LABEL over three wings — no
  // polygon carries that name, so keying the outline on it would light nothing
  // up. TSS did not say which wing, so the honest answer is all of them.
  const complex = (): PinGroup => ({
    key: 'asante',
    lat: 32.88423,
    lng: -117.242,
    place: 'Asante House',
    parts: ['Asante House East', 'Asante House Meeting Rooms', 'Asante House West'],
    pins: [{ hue: 231 } as never],
  });

  it('outlines every wing rather than the label, which matches no footprint', () => {
    expect(hostFilter([complex()])).toEqual([
      'in',
      ['get', 'name'],
      ['literal', ['Asante House East', 'Asante House Meeting Rooms', 'Asante House West']],
    ]);
  });

  it('paints every wing in the course colour, in 2D and in 3D', () => {
    const gs = [complex()];
    const valueAfter = (arr: unknown[], name: string) => arr[arr.indexOf(name) + 1];
    for (const wing of gs[0]!.parts!) {
      expect(valueAfter(hostFill(gs) as unknown[], wing), wing).toBe(colorsForHue(231).fill);
      expect(valueAfter(hostLine(gs) as unknown[], wing), wing).toBe(colorsForHue(231).spine);
      expect(valueAfter(hostFill3d(gs) as unknown[], wing), wing).toBe(colorsForHue(231).spine);
    }
    expect(JSON.stringify(hostFill(gs))).not.toContain('"Asante House"');
  });

  it('leaves an ordinary one-building group exactly as it was', () => {
    expect(hostFilter([group('Center Hall', 231)])).toEqual(['in', ['get', 'name'], ['literal', ['Center Hall']]]);
  });
});
