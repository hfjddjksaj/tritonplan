import { useEffect, useMemo, useRef } from 'react';
import type { CampusGeo, CampusShape, LineKind } from '../lib/campus-geo';
import type { MapPin } from '../lib/map-pins';
import { groupPins, placeLabels, type PinGroup } from '../lib/map-labels';
import {
  districtLabel,
  districtPriority,
  districtTint,
  footprintLabelCandidates,
  labelAnchor,
  landmarkAnchors,
  LANDMARKS,
  oceanRing,
  placeTexts,
  ringArea,
  roadLabels,
  rotatedBox,
  scaleBar,
  type Box,
} from '../lib/map-basemap';
import {
  metresPerPixel,
  panView,
  project,
  toScreen,
  zoomLevel,
  zoomView,
  type Point,
  type Viewport,
} from '../lib/map-projection';
import { colorsForHue } from '../lib/colors';

interface Props {
  geo: CampusGeo;
  pins: MapPin[];
  width: number;
  height: number;
  /** The viewport being drawn through — owned by CampusMap so its controls can move it. */
  view: Viewport;
  /** The fitted "home" frame; zoom limits are relative to it. */
  homeView: Viewport;
  onViewChange: (v: Viewport) => void;
  /** Group key of the expanded marker, or null. */
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

/** Rough chip width per character — good enough for collision avoidance. */
const CHAR_W = 6.2;
const CHIP_H = 16;
/** Basemap name metrics (uppercase, letter-spaced districts; small landmarks). */
const DISTRICT_CHAR_W = 9.6;
const DISTRICT_H = 13;
const LANDMARK_CHAR_W = 5.7;
const LANDMARK_H = 11;
const BUILDING_CHAR_W = 4.9;
const BUILDING_H = 10;
/** Zoom level (relative to home) from which individual buildings get their names. */
export const BUILDING_NAME_ZOOM = 2.2;
/** Never more than this many building names at once — past it they are noise. */
const MAX_BUILDING_NAMES = 70;

/** Zoom limits relative to the fitted frame: half campus, or one building. */
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 8;

/** Wheel: 100 units of deltaY ≈ ×1.2. */
const WHEEL_SENSITIVITY = 0.0018;
/** A pointer that moved less than this before release is a click, not a drag. */
const DRAG_THRESHOLD = 4;

const ROAD_STYLE: Record<
  Exclude<LineKind, 'coast'>,
  { width: number; casing: number; fill: string; edge: string }
> = {
  hwy: { width: 3.6, casing: 5.2, fill: '#f8e6bd', edge: '#e3cc98' },
  major: { width: 3.2, casing: 4.8, fill: '#ffffff', edge: '#c9d2df' },
  minor: { width: 1.8, casing: 3.0, fill: '#ffffff', edge: '#d0d8e3' },
  walk: { width: 2.0, casing: 3.2, fill: '#fbfcfe', edge: '#d6dce7' },
};
const ROAD_ORDER: Exclude<LineKind, 'coast'>[] = ['walk', 'minor', 'major', 'hwy'];

function ringPath(ring: number[], toPx: (p: Point) => Point, close: boolean): string {
  let d = '';
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const p = toPx(project(ring[i]!, ring[i + 1]!));
    d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  return d ? (close ? `${d}Z` : d) : '';
}

function shapePath(s: CampusShape, toPx: (p: Point) => Point): string {
  return s.rings.map((r) => ringPath(r, toPx, true)).join(' ');
}

function inside(p: Point, w: number, h: number, margin = 0): boolean {
  return p.x >= -margin && p.x <= w + margin && p.y >= -margin && p.y <= h + margin;
}

/** Keep `factor` inside the zoom band relative to home. */
function clampFactor(factor: number, view: Viewport, home: Viewport): number {
  const level = zoomLevel(view, home);
  return Math.max(MIN_ZOOM / level, Math.min(MAX_ZOOM / level, factor));
}

/**
 * The map itself: ocean, tinted districts, roads, building footprints, road
 * and district names, landmarks, then one marker per building that has classes
 * in it — plus a compass, a scale bar and the data attribution. Geometry and
 * naming decisions live in map-projection / map-labels / map-basemap; this file
 * draws them and turns wheel/drag/pinch into viewport changes.
 */
export function CampusMapCanvas({
  geo,
  pins,
  width,
  height,
  view,
  homeView,
  onViewChange,
  selectedKey,
  onSelect,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const toPx = useMemo(() => (p: Point) => toScreen(p, view), [view]);
  const level = zoomLevel(view, homeView);
  // Roads thicken a little as you zoom in, but never in proportion — at 8× a
  // proportional lane would be a 40 px ribbon.
  const lineScale = Math.max(0.8, Math.min(2.2, Math.sqrt(level)));

  /* ------------------------------------------------------------ basemap */

  const oceanD = useMemo(() => {
    const coast = geo.lines.find((l) => l.kind === 'coast');
    return coast ? ringPath(oceanRing(coast), toPx, true) : '';
  }, [geo, toPx]);

  const districtPaths = useMemo(
    () => geo.districts.map((s) => ({ name: s.name, d: shapePath(s, toPx) })),
    [geo, toPx],
  );
  const footprintPaths = useMemo(
    () => geo.footprints.map((s) => ({ name: s.name, d: shapePath(s, toPx) })),
    [geo, toPx],
  );
  const roadPaths = useMemo(() => {
    const byKind: Record<Exclude<LineKind, 'coast'>, string[]> = { walk: [], minor: [], major: [], hwy: [] };
    for (const l of geo.lines) {
      if (l.kind === 'coast') continue;
      byKind[l.kind].push(ringPath(l.pts, toPx, false));
    }
    return byKind;
  }, [geo, toPx]);

  // District names sit at each polygon's pole of inaccessibility — computed
  // once per geo, projected per view. Ordered so the colleges claim their spot
  // before the outlying districts when two names would collide.
  const districtAnchors = useMemo(
    () =>
      geo.districts
        .flatMap((s) => {
          const label = districtLabel(s.name);
          const a = label ? labelAnchor(s.rings) : null;
          if (!label || !a) return [];
          const area = s.rings.reduce((n, r) => n + Math.abs(ringArea(r)), 0);
          return [{ label, lon: a.lon, lat: a.lat, priority: districtPriority(s.name), area }];
        })
        .sort((x, y) => x.priority - y.priority || y.area - x.area),
    [geo],
  );
  const landmarks = useMemo(() => landmarkAnchors(geo), [geo]);
  const buildingCands = useMemo(
    () => footprintLabelCandidates(geo.footprints, new Set(LANDMARKS.map((l) => l.footprint))),
    [geo],
  );

  const footprintsByName = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of footprintPaths) {
      const list = m.get(f.name);
      if (list) list.push(f.d);
      else m.set(f.name, [f.d]);
    }
    return m;
  }, [footprintPaths]);

  /* ------------------------------------------------------------ markers */

  // Only groups the current view can show get a marker and a label box: an
  // off-canvas chip would be clipped anyway, and reserving space for it would
  // shove visible chips around for nothing.
  const markers = useMemo(
    () =>
      groupPins(pins)
        .map((group) => ({ group, pt: toPx(project(group.lng, group.lat)) }))
        .filter(({ pt }) => inside(pt, width, height)),
    [pins, toPx, width, height],
  );

  const labels = useMemo(() => {
    const placed = placeLabels(
      markers.map(({ group, pt }) => ({
        key: group.key,
        x: pt.x,
        y: pt.y,
        w: chipText(group.pins).length * CHAR_W + 10,
        h: CHIP_H,
      })),
      { w: width, h: height },
    );
    return new Map(placed.map((p) => [p.key, p]));
  }, [markers, width, height]);

  // Everything with a name on the basemap dodges the pins (chips + dots), the
  // map furniture, and each other. Road names go first (they are tied to a
  // line and have the fewest places to go), then district names, landmarks,
  // and — zoomed in — building names.
  const placedNames = useMemo(() => {
    const obstacles: Box[] = [];
    for (const { group, pt } of markers) {
      obstacles.push({ x: pt.x - 9, y: pt.y - 9, w: 18, h: 18 });
      const l = labels.get(group.key);
      if (l) obstacles.push({ x: l.x, y: l.y, w: chipText(group.pins).length * CHAR_W + 10, h: CHIP_H });
    }
    // Compass (top-right), scale bar (bottom-left), zoom buttons + attribution (bottom-right).
    obstacles.push({ x: width - 60, y: 0, w: 60, h: 60 });
    obstacles.push({ x: 0, y: height - 40, w: 180, h: 40 });
    obstacles.push({ x: width - 60, y: height - 130, w: 60, h: 130 });
    const roads = roadLabels(geo.lines, view, width, height, obstacles);
    for (const r of roads) obstacles.push(rotatedBox(r.x, r.y, r.w, r.h, r.angle));
    // A name has to fit on the canvas whole: "Y PINES" peeking in from the edge
    // is noise, and the district is still there when the user pans.
    const fits = (p: Point, w: number) => p.x - w / 2 >= 4 && p.x + w / 2 <= width - 4 && p.y > 8 && p.y < height - 8;
    const districts = placeTexts(
      districtAnchors.flatMap((a) => {
        const p = toPx(project(a.lon, a.lat));
        const w = a.label.length * DISTRICT_CHAR_W;
        if (!fits(p, w)) return [];
        return [{ key: a.label, x: p.x, y: p.y, w, h: DISTRICT_H }];
      }),
      obstacles,
    );
    for (const d of districts) {
      obstacles.push({ x: d.x - (d.key.length * DISTRICT_CHAR_W) / 2, y: d.y - DISTRICT_H / 2, w: d.key.length * DISTRICT_CHAR_W, h: DISTRICT_H });
    }
    const landmarksPlaced = placeTexts(
      landmarks.flatMap((a) => {
        const p = toPx(project(a.lon, a.lat));
        const w = a.label.length * LANDMARK_CHAR_W;
        if (!fits(p, w)) return [];
        return [{ key: a.label, x: p.x, y: p.y, w, h: LANDMARK_H }];
      }),
      obstacles,
      1,
    );
    for (const d of landmarksPlaced) {
      obstacles.push({ x: d.x - (d.key.length * LANDMARK_CHAR_W) / 2, y: d.y - LANDMARK_H / 2, w: d.key.length * LANDMARK_CHAR_W, h: LANDMARK_H });
    }
    // Zoomed in far enough, buildings big enough on screen to hold their name get it.
    let buildings: ReturnType<typeof placeTexts> = [];
    if (level >= BUILDING_NAME_ZOOM) {
      const cands = [];
      for (const c of buildingCands) {
        const p = toPx(project(c.lon, c.lat));
        if (!fits(p, c.text.length * BUILDING_CHAR_W)) continue;
        const a = toPx(project(c.minLon, c.minLat));
        const b = toPx(project(c.maxLon, c.maxLat));
        if (Math.abs(b.x - a.x) < 36 || Math.abs(b.y - a.y) < 14) continue;
        cands.push({ key: c.text, x: p.x, y: p.y, w: c.text.length * BUILDING_CHAR_W, h: BUILDING_H });
        if (cands.length >= MAX_BUILDING_NAMES) break;
      }
      buildings = placeTexts(cands, obstacles, 1);
    }
    return { roads, districts, landmarks: landmarksPlaced, buildings };
  }, [markers, labels, geo, view, districtAnchors, landmarks, buildingCands, level, toPx, width, height]);

  /* ------------------------------------------------- wheel / drag / pinch */

  const viewRef = useRef(view);
  viewRef.current = view;
  const homeRef = useRef(homeView);
  homeRef.current = homeView;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  // Two wheel ticks in one frame must compound: React batches the state update,
  // so the second tick would otherwise zoom from the same base as the first.
  const commitView = (v: Viewport) => {
    viewRef.current = v;
    onViewChangeRef.current(v);
  };

  /** Pointer position in SVG units, whatever CSS size the svg renders at. */
  const toSvg = (e: { clientX: number; clientY: number }): Point => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / Math.max(1, r.width)) * width,
      y: ((e.clientY - r.top) / Math.max(1, r.height)) * height,
    };
  };

  // React registers wheel listeners passively, so preventDefault() (to stop the
  // overlay scrolling under the map) has to go through a native listener.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const raw = Math.exp(-delta * WHEEL_SENSITIVITY);
      const v = viewRef.current;
      const factor = clampFactor(raw, v, homeRef.current);
      if (factor === 1) return;
      const r = el.getBoundingClientRect();
      const anchor = {
        x: ((e.clientX - r.left) / Math.max(1, r.width)) * width,
        y: ((e.clientY - r.top) / Math.max(1, r.height)) * height,
      };
      commitView(zoomView(v, factor, anchor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [width, height]);

  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ start: Point; view: Viewport; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; mid: Point; view: Viewport } | null>(null);
  // Set when a drag just ended, so the click the browser fires on release does
  // not also deselect the open marker.
  const suppressClick = useRef(false);

  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Capture is taken only once a drag is real (see onPointerMove): a captured
    // pointer's click is delivered to the svg, not the marker under it, which
    // would make every marker click read as "background — deselect".
    const p = toSvg(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      drag.current = { start: p, view: viewRef.current, moved: false };
      pinch.current = null;
    } else if (pointers.current.size === 2) {
      const s = pinchState();
      if (s) pinch.current = { ...s, view: viewRef.current };
      drag.current = null;
      if (typeof e.currentTarget.setPointerCapture === 'function') e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toSvg(e);
    pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size >= 2) {
      const s = pinchState();
      if (!s) return;
      const base = pinch.current;
      const factor = clampFactor(s.dist / base.dist, base.view, homeRef.current);
      const zoomed = zoomView(base.view, factor, base.mid);
      commitView(panView(zoomed, s.mid.x - base.mid.x, s.mid.y - base.mid.y));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      // From here on it is a pan: keep receiving moves even outside the svg.
      if (typeof e.currentTarget.setPointerCapture === 'function') e.currentTarget.setPointerCapture(e.pointerId);
    }
    commitView(panView(d.view, dx, dy));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      if (drag.current?.moved) suppressClick.current = true;
      drag.current = null;
    }
  };

  const onBackgroundClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onSelect(null);
  };

  /* ---------------------------------------------------------- furniture */

  const centreLat = useMemo(() => {
    // Latitude at the canvas centre, for the scale bar: y = ln(tan(π/4 + φ/2)).
    const worldY = (view.offsetY - height / 2) / view.scale;
    return ((2 * Math.atan(Math.exp(worldY)) - Math.PI / 2) * 180) / Math.PI;
  }, [view, height]);
  const bar = scaleBar(metresPerPixel(view, centreLat));
  const compact = width < 500;
  const compassR = compact ? 13 : 16;
  const compassC = { x: width - compassR - 12, y: compassR + 18 };

  return (
    <svg
      ref={svgRef}
      className="campusmap__svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      // Not role="img": the markers inside are the only route to the detail panel, and
      // a role="img" subtree is presentational to assistive tech — the buttons would be
      // announced as nothing at all.
      role="group"
      aria-label="UCSD campus map of this term's class locations"
      onClick={onBackgroundClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <rect className="campusmap__land" x={0} y={0} width={width} height={height} />
      {oceanD && <path className="campusmap__ocean" d={oceanD} />}

      <g className="campusmap__districts">
        {districtPaths.map((s, i) => (
          <path key={`${s.name}-${i}`} className="campusmap__district" d={s.d} fill={districtTint(s.name)} />
        ))}
      </g>

      {/* Casings first, then fills, so roads merge at junctions instead of overlapping. */}
      <g className="campusmap__roads" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {ROAD_ORDER.map((kind) => (
          <path
            key={`${kind}-edge`}
            className={`campusmap__road-edge campusmap__road-edge--${kind}`}
            d={roadPaths[kind].join('')}
            stroke={ROAD_STYLE[kind].edge}
            strokeWidth={ROAD_STYLE[kind].casing * lineScale}
          />
        ))}
        {ROAD_ORDER.map((kind) => (
          <path
            key={`${kind}-fill`}
            className={`campusmap__road campusmap__road--${kind}`}
            d={roadPaths[kind].join('')}
            stroke={ROAD_STYLE[kind].fill}
            strokeWidth={ROAD_STYLE[kind].width * lineScale}
          />
        ))}
      </g>

      <g className="campusmap__footprints">
        {footprintPaths.map((s, i) => (
          <path key={`${s.name}-${i}`} className="campusmap__footprint" d={s.d} />
        ))}
      </g>

      {/* Buildings that host a class take that class's colour, so the pin has a body. */}
      <g className="campusmap__hosts">
        {markers.map(({ group }) => {
          const ds = group.building ? footprintsByName.get(group.building) : undefined;
          if (!ds) return null;
          const c = colorsForHue(group.pins[0]!.hue);
          return ds.map((d, i) => (
            <path key={`${group.key}-${i}`} className="campusmap__host" d={d} fill={c.fill} stroke={c.spine} />
          ));
        })}
      </g>

      <g className="campusmap__roadnames" aria-hidden="true">
        {placedNames.roads.map((r) => (
          <text
            key={r.name}
            className={`campusmap__roadname campusmap__roadname--${r.kind}`}
            x={r.x}
            y={r.y + 3.5}
            textAnchor="middle"
            transform={`rotate(${r.angle.toFixed(1)} ${r.x.toFixed(1)} ${r.y.toFixed(1)})`}
          >
            {r.text}
          </text>
        ))}
      </g>

      <g className="campusmap__placenames" aria-hidden="true">
        {placedNames.districts.map((d) => (
          <text key={d.key} className="campusmap__districtname" x={d.x} y={d.y + 4} textAnchor="middle">
            {d.key}
          </text>
        ))}
        {placedNames.landmarks.map((d) => (
          <text key={d.key} className="campusmap__landmark" x={d.x} y={d.y + 3.5} textAnchor="middle">
            {d.key}
          </text>
        ))}
        {placedNames.buildings.map((d) => (
          <text key={d.key} className="campusmap__bldgname" x={d.x} y={d.y + 3} textAnchor="middle">
            {d.key}
          </text>
        ))}
      </g>

      <g className="campusmap__markers">
        {markers.map(({ group, pt }) => {
          const c = colorsForHue(group.pins[0]!.hue);
          const booked = group.pins.some((p) => p.booked);
          const label = labels.get(group.key);
          const text = chipText(group.pins);
          const chipW = text.length * CHAR_W + 10;
          return (
            <g
              key={group.key}
              className={`campusmap__marker${booked ? ' campusmap__marker--booked' : ''}${
                selectedKey === group.key ? ' campusmap__marker--open' : ''
              }`}
              // A marker is the only way into the detail panel, so it has to be
              // reachable without a mouse.
              role="button"
              tabIndex={0}
              aria-label={markerLabel(group)}
              aria-pressed={selectedKey === group.key}
              onClick={(e) => {
                e.stopPropagation();
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                onSelect(selectedKey === group.key ? null : group.key);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault(); // Space would scroll the overlay
                e.stopPropagation();
                onSelect(selectedKey === group.key ? null : group.key);
              }}
            >
              <circle className="campusmap__dot-halo" cx={pt.x} cy={pt.y} r={8} fill="#fff" />
              <circle
                className="campusmap__dot"
                cx={pt.x}
                cy={pt.y}
                r={6}
                fill={booked ? c.spine : '#fff'}
                stroke={c.spine}
                strokeWidth={2}
              />
              {label && (
                <>
                  <rect
                    className="campusmap__chip-shadow"
                    x={label.x}
                    y={label.y + 1}
                    width={chipW}
                    height={CHIP_H}
                    rx={4}
                  />
                  <rect
                    className="campusmap__chip"
                    x={label.x}
                    y={label.y}
                    width={chipW}
                    height={CHIP_H}
                    rx={4}
                    fill={c.fill}
                    stroke={c.border}
                  />
                  <text className="campusmap__chiptext" x={label.x + 5} y={label.y + 11.5} fill={c.text}>
                    {text}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </g>

      {/* Compass: north is up, but a map with no arrow makes people doubt it. */}
      <g className="campusmap__compass" aria-hidden="true" transform={`translate(${compassC.x},${compassC.y})`}>
        <circle r={compassR} className="campusmap__compass-disc" />
        <path
          d={`M0,${-compassR + 3} L${compassR * 0.32},${compassR * 0.35} L0,${compassR * 0.15} Z`}
          className="campusmap__compass-n"
        />
        <path
          d={`M0,${-compassR + 3} L${-compassR * 0.32},${compassR * 0.35} L0,${compassR * 0.15} Z`}
          className="campusmap__compass-n2"
        />
        <text y={-compassR - 4} textAnchor="middle" className="campusmap__compass-label">
          N
        </text>
      </g>

      <g className="campusmap__scalebar" aria-hidden="true" transform={`translate(${compact ? 10 : 16},${height - (compact ? 12 : 16)})`}>
        <path d={`M0,-5 L0,0 L${bar.px.toFixed(1)},0 L${bar.px.toFixed(1)},-5`} className="campusmap__scale-line" />
        <text x={bar.px / 2} y={-8} textAnchor="middle" className="campusmap__scale-text">
          {bar.metres >= 1000 ? `${bar.metres / 1000} km` : `${bar.metres} m`}
        </text>
      </g>

      <text
        className="campusmap__attrib"
        x={width - 8}
        y={height - 6}
        textAnchor="end"
        aria-hidden="true"
      >
        {compact ? '© OpenStreetMap contributors' : 'UC San Diego GIS · © OpenStreetMap contributors'}
      </text>
    </svg>
  );
}

/** Spoken form of a marker: the chip is an abbreviation, this is the whole truth. */
function markerLabel(g: PinGroup): string {
  const what = g.pins.map((p) => `${p.courseCode} ${p.label}`).join(', ');
  return g.building ? `${g.building}: ${what}` : what;
}

/** "CSE-8A LEC" for one class here, "CSE-8A +2" when several share the building. */
function chipText(pins: MapPin[]): string {
  const first = pins[0]!;
  return pins.length === 1 ? `${first.courseCode} ${first.label}` : `${first.courseCode} +${pins.length - 1}`;
}
