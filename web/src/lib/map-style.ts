/**
 * The official UCSD-look MapLibre style: the palette, the layer stack (ground
 * surfaces, buildings, roads, trees, labels), and the small appliers that
 * recolour host buildings by course and switch the map between its flat 2D
 * and extruded 3D looks.
 *
 * Pure functions over the `MapSources` GeoJSON built by `map-data.ts` — this
 * module never touches a real `maplibre-gl` `Map` instance directly (see
 * `StyleTarget`), so it stays trivially testable and keeps `maplibre-gl`
 * itself out of any non-map bundle chunk. Only *types* are imported from
 * `maplibre-gl`, never values — importing the library eagerly here would pull
 * its ~230 KB into the app's first-paint chunk instead of the lazy map chunk.
 *
 * Zero-runtime-external-requests red line: every URL this module writes into
 * the style (currently just `glyphs`; terrain tiles land in Phase 3) is
 * built from the caller-supplied `assetBase()` — the page's own origin. No
 * CDN, no tile server, no font server, ever.
 */
import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from 'maplibre-gl';
import { colorsForHue } from './colors';
import type { MapSources } from './map-data';
import type { PinGroup } from './map-labels';

export type MapMode = '2d' | '3d';

/** The official UCSD map's colours, named by what they paint (spec §1 table). */
export const MAP_PALETTE = {
  land: '#ECEAE4',
  campus: '#B2C49F',
  ocean: '#B9E3F9',
  building: '#DCDAD4',
  buildingLine: '#828282',
  building3d: '#D6D5D0',
  roadCasing: '#CCCCCC',
  roadFill: '#FFFFFF',
  hwyFill: '#F8E6BD',
  hwyCasing: '#E3CC98',
  tree: '#8FB27A',
  treeLine: '#6E9459',
  groundLine: '#D9D5CF',
  park: '#C9D6B6',
  wood: '#BFD0AC',
  beach: '#F1E7C8',
  textRoad: '#686868',
  textDistrict: '#014B75',
  textBuilding: '#4E4E4E',
  halo: '#FFFFFF',
} as const;

/** Colour for a ground polygon whose `type` isn't in {@link GROUND_COLORS}. */
export const GROUND_FALLBACK = '#FFEBAF';

/**
 * Every ground-surface `Type` value the bundled data (and the official style)
 * uses, mapped to its official fill colour. The spec's §1 palette table names
 * only a subset by row (Grass, Planter, Walking/Bike Path, Sidewalk, Street/
 * Service Road, Parking Lot, Building, Pool/Fountain, Sand/Dirt/Gravel/Mulch,
 * Athletic Track/Hardcourt/fields); the task brief's own verbatim list covers
 * the rest (Dock / Pier, Miscellaneous Structures, Shed, Rock, Wall, and each
 * individual field/court type) with exact hex values pulled from the official
 * style JSON, so every entry below is copied, not derived by this task.
 */
export const GROUND_COLORS: Readonly<Record<string, string>> = {
  'Athletic Track': '#D7B09E',
  'Baseball Field': '#AEC790',
  'Bike Path': '#F2EEE9',
  Building: '#DCDAD4',
  Dirt: '#DDCCAE',
  'Dock / Pier': '#F2EEE9',
  Grass: '#D4E5B9',
  Gravel: '#E1E1E1',
  Hardcourt: '#9C9C9C',
  'Miscellaneous Structures': '#DAD0C8',
  Mulch: '#BAB687',
  'Parking Lot': '#B2B2B2',
  Planter: '#B5C7A2',
  'Pool / Fountain': '#BEE8FF',
  'Pool/Fountain': '#BEE8FF',
  Rock: '#D6D6D6',
  Sand: '#FFEBBE',
  'Service Road': '#CCCCCC',
  Shed: '#DAD0C8',
  Sidewalk: '#E1E1E1',
  'Soccer Field': '#B4D79E',
  'Softball Field': '#AEC790',
  Street: '#CCCCCC',
  'Tennis Court Exterior': '#AEC790',
  'Tennis Court Interior': '#B4D79E',
  'Walking Path': '#F2EEE9',
  Wall: '#C5C5B9',
} as const;

export const MAP_FONT_REGULAR = 'Inter-Regular';
export const MAP_FONT_BOLD = 'Inter-SemiBold';

export const LAYER = {
  land: 'land',
  landuse: 'landuse',
  ocean: 'ocean',
  hillshade: 'hillshade',
  campus: 'campus',
  ground: 'ground',
  groundLine: 'ground-line',
  buildings: 'buildings',
  buildingsLine: 'buildings-line',
  hosts: 'hosts',
  hostsLine: 'hosts-line',
  buildings3d: 'buildings-3d',
  hosts3d: 'hosts-3d',
  roadsCasing: 'roads-casing',
  roads: 'roads',
  trees: 'trees',
  trees3d: 'trees-3d',
  roadNames: 'road-names',
  districtNames: 'district-names',
  landmarkNames: 'landmark-names',
  buildingNames: 'building-names',
} as const;

export const CAMERA = {
  minZoom: 13.5,
  maxZoom: 19,
  maxPitch: 65,
  mode3d: { pitch: 55, bearing: -25 },
  mode2d: { pitch: 0, bearing: 0 },
} as const;

/**
 * How much tighter the home view fits than the core box's own
 * `cameraForBounds` answer — a framing *preference* the user asked for
 * ("too far out"), not a value derived from anything about the campus or the
 * canvas. Applied as `cam.zoom + HOME_ZOOM_BOOST` (raising the fitted zoom)
 * rather than shrinking the core bounds box: the core box is tall while the
 * desktop canvas is wide, so the fit is already letterboxed on one axis, and
 * shrinking the box would distort that relationship differently on a wide
 * canvas than a tall one. `log2(1.3)` is exactly 30% linear magnification —
 * on both axes, regardless of the canvas's aspect ratio — whatever zoom
 * `cameraForBounds` lands on. Callers must still clamp the result to
 * `CAMERA.maxZoom` themselves (a small enough canvas could otherwise push
 * past it).
 */
export const HOME_ZOOM_BOOST = Math.log2(1.3);

export interface StyleOptions {
  sources: MapSources;
  assetBase: string;
  /** Phase 3: adds the hillshade layer and lets `applyMode` set real terrain. Default false. */
  terrain?: boolean;
}

/** `['in', ['get','name'], ['literal', names]]` — the host footprints to recolour. */
export function hostFilter(groups: readonly PinGroup[]): FilterSpecification {
  const names = [...new Set(groups.map((g) => g.place ?? g.building).filter((n): n is string => !!n))];
  return ['in', ['get', 'name'], ['literal', names]] as FilterSpecification;
}

function hostNamesAndHues(groups: readonly PinGroup[]): [string, number][] {
  const byName = new Map<string, number>();
  for (const g of groups) {
    const name = g.place ?? g.building;
    if (!name || byName.has(name)) continue;
    const hue = (g.pins[0] as { hue: number } | undefined)?.hue ?? 0;
    byName.set(name, hue);
  }
  return [...byName];
}

/** `match` on footprint name → that course's fill colour; a plain string with no groups. */
export function hostFill(groups: readonly PinGroup[]): ExpressionSpecification | string {
  const pairs = hostNamesAndHues(groups);
  if (pairs.length === 0) return MAP_PALETTE.building;
  const match: unknown[] = ['match', ['get', 'name']];
  for (const [name, hue] of pairs) match.push(name, colorsForHue(hue).fill);
  match.push(MAP_PALETTE.building);
  return match as ExpressionSpecification;
}

/** Same as {@link hostFill} but keyed to each course's spine colour, for outlines. */
export function hostLine(groups: readonly PinGroup[]): ExpressionSpecification | string {
  const pairs = hostNamesAndHues(groups);
  if (pairs.length === 0) return MAP_PALETTE.buildingLine;
  const match: unknown[] = ['match', ['get', 'name']];
  for (const [name, hue] of pairs) match.push(name, colorsForHue(hue).spine);
  match.push(MAP_PALETTE.buildingLine);
  return match as ExpressionSpecification;
}

export interface StyleTarget {
  setPaintProperty(id: string, prop: string, value: unknown): unknown;
  setLayoutProperty(id: string, prop: string, value: unknown): unknown;
  setFilter(id: string, f: unknown): unknown;
  setTerrain?(t: unknown): unknown;
}

/** Recolour the host layers (`hosts`, `hosts-line`, `hosts-3d`) to the plan's booked buildings. */
export function applyHosts(map: StyleTarget, groups: readonly PinGroup[]): void {
  const filter = hostFilter(groups);
  const fill = hostFill(groups);
  const line = hostLine(groups);

  map.setFilter(LAYER.hosts, filter);
  map.setPaintProperty(LAYER.hosts, 'fill-color', fill);
  map.setFilter(LAYER.hostsLine, filter);
  map.setPaintProperty(LAYER.hostsLine, 'line-color', line);
  map.setFilter(LAYER.hosts3d, filter);
  map.setPaintProperty(LAYER.hosts3d, 'fill-extrusion-color', fill);
}

/**
 * Switch between the flat 2D look and the extruded 3D look. Trees stay
 * visible (and `trees-3d` stays hidden) in both modes until Task 14 swaps in
 * billboarded tree models.
 */
export function applyMode(map: StyleTarget, mode: MapMode, terrain = false): void {
  const flat = mode === '2d' ? 'visible' : 'none';
  const extruded = mode === '3d' ? 'visible' : 'none';

  map.setLayoutProperty(LAYER.buildings, 'visibility', flat);
  map.setLayoutProperty(LAYER.buildingsLine, 'visibility', flat);
  map.setLayoutProperty(LAYER.hosts, 'visibility', flat);
  map.setLayoutProperty(LAYER.hostsLine, 'visibility', flat);

  map.setLayoutProperty(LAYER.buildings3d, 'visibility', extruded);
  map.setLayoutProperty(LAYER.hosts3d, 'visibility', extruded);

  map.setLayoutProperty(LAYER.trees, 'visibility', 'visible');
  map.setLayoutProperty(LAYER.trees3d, 'visibility', 'none');

  map.setTerrain?.(mode === '3d' && terrain ? { source: 'terrain', exaggeration: 1.2 } : null);
}

/**
 * The page's own origin, as an absolute directory URL (always ends with
 * `/`) — the base every asset URL this style writes is resolved against, so
 * the map never issues a request off our own origin.
 */
export function assetBase(): string {
  const base = import.meta.env.BASE_URL || './';
  const url = new URL(base, document.baseURI).href;
  return url.endsWith('/') ? url : url + '/';
}

const ROAD_WIDTH_CASING: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  13,
  1.5,
  16,
  4.5,
  19,
  12,
] as ExpressionSpecification;

const ROAD_WIDTH_FILL: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  13,
  0.8,
  16,
  3,
  19,
  9,
] as ExpressionSpecification;

const BUILDING_LINE_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  14,
  0.3,
  17,
  0.8,
] as ExpressionSpecification;

const TREE_RADIUS: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  15,
  ['*', 0.6, ['+', ['get', 'cls'], 1]],
  18,
  ['*', 2.4, ['+', ['get', 'cls'], 1]],
] as ExpressionSpecification;

const ROADS_NOT_WALK: FilterSpecification = ['!=', ['get', 'kind'], 'walk'] as FilterSpecification;

/** Build the MapLibre style for the campus map, in the exact layer order the spec defines. */
export function buildStyle(o: StyleOptions): StyleSpecification {
  const { sources, assetBase: base } = o;
  // o.terrain: Phase 3 adds the `hillshade` layer here, gated on this flag.

  const groundMatch: unknown[] = ['match', ['get', 'type']];
  for (const [type, color] of Object.entries(GROUND_COLORS)) groundMatch.push(type, color);
  groundMatch.push(GROUND_FALLBACK);

  const layers: StyleSpecification['layers'] = [
    // 1. land
    { id: LAYER.land, type: 'background', paint: { 'background-color': MAP_PALETTE.land } },
    // 2. landuse
    {
      id: LAYER.landuse,
      type: 'fill',
      source: LAYER.landuse,
      paint: {
        'fill-color': [
          'match',
          ['get', 'kind'],
          'park',
          MAP_PALETTE.park,
          'wood',
          MAP_PALETTE.wood,
          'beach',
          MAP_PALETTE.beach,
          MAP_PALETTE.park,
        ] as ExpressionSpecification,
      },
    },
    // 3. ocean
    { id: LAYER.ocean, type: 'fill', source: LAYER.ocean, paint: { 'fill-color': MAP_PALETTE.ocean } },
    // 4. hillshade — Phase 3
    // 5. campus
    { id: LAYER.campus, type: 'fill', source: LAYER.campus, paint: { 'fill-color': MAP_PALETTE.campus } },
    // 6. ground
    {
      id: LAYER.ground,
      type: 'fill',
      source: LAYER.ground,
      paint: {
        'fill-color': groundMatch as ExpressionSpecification,
        'fill-antialias': false,
      },
      layout: { 'fill-sort-key': ['get', 'rank'] as ExpressionSpecification },
    },
    // 7. ground-line
    {
      id: LAYER.groundLine,
      type: 'line',
      source: LAYER.ground,
      filter: ['in', ['get', 'type'], ['literal', ['Walking Path', 'Sidewalk', 'Bike Path']]] as FilterSpecification,
      minzoom: 16,
      paint: { 'line-color': MAP_PALETTE.groundLine, 'line-width': 0.5 },
    },
    // 8. buildings, buildings-line
    { id: LAYER.buildings, type: 'fill', source: LAYER.buildings, paint: { 'fill-color': MAP_PALETTE.building } },
    {
      id: LAYER.buildingsLine,
      type: 'line',
      source: LAYER.buildings,
      paint: { 'line-color': MAP_PALETTE.buildingLine, 'line-width': BUILDING_LINE_WIDTH },
    },
    // 9. hosts, hosts-line
    {
      id: LAYER.hosts,
      type: 'fill',
      source: LAYER.buildings,
      filter: hostFilter([]),
      paint: { 'fill-color': hostFill([]) },
    },
    {
      id: LAYER.hostsLine,
      type: 'line',
      source: LAYER.buildings,
      filter: hostFilter([]),
      paint: { 'line-color': hostLine([]), 'line-width': 1.2 },
    },
    // 10. buildings-3d, hosts-3d
    {
      id: LAYER.buildings3d,
      type: 'fill-extrusion',
      source: LAYER.buildings,
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': MAP_PALETTE.building3d,
        'fill-extrusion-height': ['get', 'height'] as ExpressionSpecification,
        'fill-extrusion-base': 0,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    {
      id: LAYER.hosts3d,
      type: 'fill-extrusion',
      source: LAYER.buildings,
      filter: hostFilter([]),
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': hostFill([]),
        'fill-extrusion-height': ['get', 'height'] as ExpressionSpecification,
        'fill-extrusion-base': 0,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    // 11. roads-casing, roads
    {
      id: LAYER.roadsCasing,
      type: 'line',
      source: LAYER.roads,
      filter: ROADS_NOT_WALK,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'kind'], 'hwy', MAP_PALETTE.hwyCasing, MAP_PALETTE.roadCasing] as ExpressionSpecification,
        'line-width': ROAD_WIDTH_CASING,
      },
    },
    {
      id: LAYER.roads,
      type: 'line',
      source: LAYER.roads,
      filter: ROADS_NOT_WALK,
      paint: {
        'line-color': ['match', ['get', 'kind'], 'hwy', MAP_PALETTE.hwyFill, MAP_PALETTE.roadFill] as ExpressionSpecification,
        'line-width': ROAD_WIDTH_FILL,
      },
    },
    // 12. trees, trees-3d
    {
      id: LAYER.trees,
      type: 'circle',
      source: LAYER.trees,
      minzoom: 15,
      paint: {
        'circle-color': MAP_PALETTE.tree,
        'circle-stroke-color': MAP_PALETTE.treeLine,
        'circle-stroke-width': 0.5,
        'circle-blur': 0.15,
        'circle-opacity': 0.9,
        'circle-radius': TREE_RADIUS,
      },
    },
    // Phase 3 replaces this placeholder with billboarded tree models.
    {
      id: LAYER.trees3d,
      type: 'circle',
      source: LAYER.trees,
      layout: { visibility: 'none' },
      paint: { 'circle-color': MAP_PALETTE.tree },
    },
    // 13. road-names
    {
      id: LAYER.roadNames,
      type: 'symbol',
      source: LAYER.roads,
      filter: ['!=', ['get', 'label'], ''] as FilterSpecification,
      minzoom: 14.5,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'label'] as ExpressionSpecification,
        'text-font': [MAP_FONT_REGULAR],
        'text-size': 11,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
        'text-max-angle': 30,
      },
      paint: { 'text-color': MAP_PALETTE.textRoad, 'text-halo-color': MAP_PALETTE.halo, 'text-halo-width': 1.2 },
    },
    // 14. district-names
    {
      id: LAYER.districtNames,
      type: 'symbol',
      source: 'labels',
      filter: ['==', ['get', 'kind'], 'district'] as FilterSpecification,
      minzoom: 13,
      maxzoom: 15.6,
      // Sized against the official map rather than by eye: theirs sets district
      // names at roughly 10-11 px with no tracking, ours were 13 px at 0.2 em —
      // about 1.2x taller and a quarter wider per word. That extra width is what
      // put WARREN and EAST CAMPUS OPEN SPACE PRESERVE under the course chips and
      // the marker card, where they broke into fragments (WAR, "T CAMPUS / EN
      // SPACE / RESERVE") that read as noise rather than as a covered name (QA
      // I5 / A6 / B11). 11 px at 0.08 em keeps the tier legible and distinct from
      // the 12 px landmark names while giving the overlays much less to hit.
      layout: {
        'text-font': [MAP_FONT_BOLD],
        'text-size': 11,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.08,
        'text-field': ['get', 'label'] as ExpressionSpecification,
        'symbol-sort-key': ['get', 'rank'] as ExpressionSpecification,
      },
      paint: { 'text-color': MAP_PALETTE.textDistrict, 'text-halo-color': MAP_PALETTE.halo, 'text-halo-width': 1.2 },
    },
    // 15. landmark-names
    {
      id: LAYER.landmarkNames,
      type: 'symbol',
      source: 'labels',
      filter: ['==', ['get', 'kind'], 'landmark'] as FilterSpecification,
      minzoom: 15,
      layout: {
        'text-font': [MAP_FONT_BOLD],
        'text-size': 12,
        'text-field': ['get', 'label'] as ExpressionSpecification,
        'symbol-sort-key': 0,
      },
      paint: { 'text-color': MAP_PALETTE.textBuilding, 'text-halo-color': MAP_PALETTE.halo, 'text-halo-width': 1.2 },
    },
    // 16. building-names
    {
      id: LAYER.buildingNames,
      type: 'symbol',
      source: 'labels',
      filter: ['==', ['get', 'kind'], 'building'] as FilterSpecification,
      minzoom: 16.5,
      layout: {
        'text-font': [MAP_FONT_REGULAR],
        'text-size': 11,
        'text-max-width': 8,
        'text-field': ['get', 'label'] as ExpressionSpecification,
        'symbol-sort-key': ['get', 'rank'] as ExpressionSpecification,
      },
      paint: { 'text-color': MAP_PALETTE.textBuilding, 'text-halo-color': MAP_PALETTE.halo, 'text-halo-width': 1.2 },
    },
  ];

  return {
    version: 8,
    glyphs: `${base}map/fonts/{fontstack}/{range}.pbf`,
    sources: {
      [LAYER.ground]: { type: 'geojson', data: sources.ground },
      [LAYER.buildings]: { type: 'geojson', data: sources.buildings },
      [LAYER.trees]: { type: 'geojson', data: sources.trees },
      [LAYER.roads]: { type: 'geojson', data: sources.roads },
      [LAYER.ocean]: { type: 'geojson', data: sources.ocean },
      [LAYER.campus]: { type: 'geojson', data: sources.campus },
      [LAYER.landuse]: { type: 'geojson', data: sources.landuse },
      labels: { type: 'geojson', data: sources.labels },
    },
    layers,
  };
}
