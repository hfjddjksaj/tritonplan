/**
 * What the basemap says about itself: how a district is tinted, which roads
 * deserve a name along them, how the coastline closes into an ocean, and how
 * long the scale bar is. Naming rules (district labels, road label text,
 * building short names) live in `map-names.ts`; the label-anchor and area
 * geometry helpers live in `map-data.ts` — both re-exported below for the
 * (legacy) SVG renderer's remaining callers.
 *
 * Pure functions over the bundled geometry — CampusMapCanvas only draws what
 * comes out of here, so the judgement calls (tinting, which roads to label)
 * live in one testable place.
 */
import type { CampusGeo, CampusLine, CampusShape, LineKind } from './campus-geo';
import { project, toScreen, type Point, type Viewport } from './map-projection';
import { LANDMARKS, buildingShortName, roadLabelText, wantsRoadLabel } from './map-names';
import { polygonAnchor as labelAnchor, ringArea } from './map-data';

export {
  DISTRICT_LABELS,
  UNLABELLED_DISTRICTS,
  districtLabel,
  districtPriority,
  LANDMARKS,
  ABBREVIATIONS,
  FREEWAYS,
  roadLabelText,
  LABELLED_MINOR,
  wantsRoadLabel,
  abbreviateBuildingWords,
  buildingShortName,
} from './map-names';
export { ringArea, oceanRing, polygonAnchor as labelAnchor } from './map-data';

/* ------------------------------------------------------------ districts */

/** Undergraduate colleges get their own tint; the rest are neutral or green. */
const COLLEGE_TINTS: Readonly<Record<string, string>> = {
  Revelle: '#e4ecf8',
  Muir: '#e3f0e6',
  'Ridge Walk North': '#f8e7e5', // Marshall
  Warren: '#ede6f6',
  Roosevelt: '#f8f0dc', // ERC
  'North Torrey Pines': '#dff1ef', // Sixth
  'North Campus': '#f6e8ee', // Seventh
  'Theatre District': '#eeeedb', // Eighth
};

/** Canyons, reserves and fields: the green that explains the gaps between buildings. */
const GREEN_DISTRICTS: ReadonlySet<string> = new Set([
  'North Canyon',
  'East Campus Open Space Preserve',
  'East Recreation',
  'Biology Field Station',
  'Beach Properties',
]);

export const TINT_NEUTRAL = '#ebeef3';
export const TINT_GREEN = '#e2ede0';

/** Fill colour for a district polygon. */
export function districtTint(name: string): string {
  return COLLEGE_TINTS[name] ?? (GREEN_DISTRICTS.has(name) ? TINT_GREEN : TINT_NEUTRAL);
}

/* ------------------------------------------------------------- landmarks */

export interface LandmarkAnchor {
  label: string;
  lon: number;
  lat: number;
}

/** Landmarks whose footprint exists in this data, each at its footprint's anchor. */
export function landmarkAnchors(geo: CampusGeo): LandmarkAnchor[] {
  const byName = new Map<string, CampusShape>();
  for (const f of geo.footprints) if (!byName.has(f.name)) byName.set(f.name, f);
  const out: LandmarkAnchor[] = [];
  for (const { footprint, label } of LANDMARKS) {
    const shape = byName.get(footprint);
    if (!shape) continue;
    const a = labelAnchor(shape.rings);
    if (a) out.push({ label, ...a });
  }
  return out;
}

/* ----------------------------------------------------------------- roads */

export interface RoadLabel {
  name: string;
  text: string;
  kind: LineKind;
  /** Centre of the (straight, rotated) text, screen px. */
  x: number;
  y: number;
  /** Rotation in degrees, always within (−90, 90] so the text reads upright. */
  angle: number;
  /** Text box before rotation. */
  w: number;
  h: number;
}

/** Rough on-screen text width at the road-label font size. */
const ROAD_CHAR_W = 5.4;
const ROAD_H = 12;
/** How far the road may bow away from the label's chord before that spot is too curvy. */
const MAX_BOW_PX = 2.5;
/** Where along the visible run to try to sit the label: middle first. */
const TRY_AT = [0.5, 0.38, 0.62, 0.26, 0.74, 0.15, 0.85] as const;
const KIND_PRIORITY: Record<LineKind, number> = { hwy: 0, major: 1, walk: 2, minor: 3, coast: 9 };

/** Axis-aligned bounds of a w×h box rotated by `angle` degrees about (x, y). */
export function rotatedBox(x: number, y: number, w: number, h: number, angle: number): Box {
  const r = (angle * Math.PI) / 180;
  const bw = Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * h;
  const bh = Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * h;
  return { x: x - bw / 2, y: y - bh / 2, w: bw, h: bh };
}

/**
 * Pick which named lines get text at this view, and where. Labels are straight
 * — rotated to the road's local direction, never bent along it: bent text
 * twists as the map zooms and reads badly on any curve. A label goes only where
 * the road is straight enough under it (bow ≤ MAX_BOW_PX over the text's own
 * length), trying the middle of the visible run first and then either side; a
 * road with no straight-enough stretch on screen goes unlabelled. Highways are
 * placed first, then major roads, walkways, minor roads; each label must clear
 * `obstacles` (the pins) and every label placed before it, or it is dropped.
 * One label per name.
 */
export function roadLabels(
  lines: readonly CampusLine[],
  view: Viewport,
  w: number,
  h: number,
  obstacles: readonly Box[] = [],
): RoadLabel[] {
  const MARGIN = 24;
  // Gather candidates with their visible run, then place in priority order.
  const cands: { line: CampusLine; text: string; run: { pts: Point[]; len: number } }[] = [];
  for (const line of lines) {
    if (!wantsRoadLabel(line)) continue;
    const pts: Point[] = [];
    for (let i = 0; i + 1 < line.pts.length; i += 2) {
      pts.push(toScreen(project(line.pts[i]!, line.pts[i + 1]!), view));
    }
    const run = longestVisibleRun(pts, w, h, MARGIN);
    if (!run) continue;
    const text = roadLabelText(line.name);
    if (run.len < text.length * ROAD_CHAR_W + 30) continue;
    cands.push({ line, text, run });
  }
  cands.sort(
    (p, q) => KIND_PRIORITY[p.line.kind] - KIND_PRIORITY[q.line.kind] || q.run.len - p.run.len,
  );

  const taken: Box[] = [...obstacles];
  const done = new Set<string>();
  const out: RoadLabel[] = [];
  for (const { line, text, run } of cands) {
    if (done.has(line.name)) continue;
    const tw = text.length * ROAD_CHAR_W;
    for (const frac of TRY_AT) {
      const centre = run.len * frac;
      if (centre - tw / 2 < 0 || centre + tw / 2 > run.len) continue;
      const spot = straightSpot(run.pts, centre, tw);
      if (!spot) continue;
      const box = rotatedBox(spot.x, spot.y, tw, ROAD_H, spot.angle);
      if (box.x < 2 || box.y < 2 || box.x + box.w > w - 2 || box.y + box.h > h - 2) continue;
      if (taken.some((t) => boxesOverlap(box, t))) continue;
      taken.push(box);
      done.add(line.name);
      out.push({ name: line.name, text, kind: line.kind, x: spot.x, y: spot.y, angle: spot.angle, w: tw, h: ROAD_H });
      break;
    }
  }
  return out;
}

/**
 * The centre and upright angle of a label of length `tw` centred `centre` px
 * along the polyline — or null if the polyline bows more than MAX_BOW_PX away
 * from the chord under the label.
 */
function straightSpot(pts: Point[], centre: number, tw: number): { x: number; y: number; angle: number } | null {
  const a = pointAlong(pts, centre - tw / 2);
  const b = pointAlong(pts, centre + tw / 2);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (chord < tw * 0.9) return null; // the road doubles back under the label
  // Bow: max distance of the vertices between a and b from the chord.
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!;
    const q = pts[i]!;
    const seg = Math.hypot(q.x - p.x, q.y - p.y);
    const at = acc + seg;
    if (at > centre - tw / 2 && at < centre + tw / 2) {
      const d = Math.abs((b.x - a.x) * (a.y - q.y) - (a.x - q.x) * (b.y - a.y)) / Math.max(1e-6, chord);
      if (d > MAX_BOW_PX) return null;
    }
    acc = at;
    if (acc > centre + tw / 2) break;
  }
  let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const m = pointAlong(pts, centre);
  return { x: m.x, y: m.y, angle };
}

/** The longest stretch of consecutive points inside the canvas (± margin), with its length. */
function longestVisibleRun(pts: Point[], w: number, h: number, margin: number): { pts: Point[]; len: number } | null {
  let best: { pts: Point[]; len: number } | null = null;
  let cur: Point[] = [];
  let curLen = 0;
  const flush = () => {
    if (cur.length >= 2 && (!best || curLen > best.len)) best = { pts: cur, len: curLen };
    cur = [];
    curLen = 0;
  };
  for (const p of pts) {
    const inside = p.x >= -margin && p.x <= w + margin && p.y >= -margin && p.y <= h + margin;
    if (!inside) {
      flush();
      continue;
    }
    if (cur.length) {
      const q = cur[cur.length - 1]!;
      curLen += Math.hypot(p.x - q.x, p.y - q.y);
    }
    cur.push(p);
  }
  flush();
  return best;
}

/** The point `dist` along a polyline (clamped to its ends). */
function pointAlong(pts: Point[], dist: number): Point {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= dist) {
      const t = seg === 0 ? 0 : Math.max(0, (dist - acc) / seg);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += seg;
  }
  return pts[pts.length - 1]!;
}

/* ------------------------------------------------------- building names */

export interface FootprintLabelCandidate {
  key: string;
  text: string;
  /** Anchor in lon/lat. */
  lon: number;
  lat: number;
  /** Ground-plan bbox in degrees, to test on-screen size cheaply. */
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  area: number;
}

/**
 * Every footprint that could ever carry a name, once per geo: anchor, bbox and
 * area, biggest first so the buildings that dominate a view get named first.
 */
export function footprintLabelCandidates(footprints: readonly CampusShape[], skip: ReadonlySet<string> = new Set()): FootprintLabelCandidate[] {
  const seen = new Set<string>();
  const out: FootprintLabelCandidate[] = [];
  for (const f of footprints) {
    if (seen.has(f.name) || skip.has(f.name)) continue;
    const text = buildingShortName(f.name);
    if (!text) continue;
    const a = labelAnchor(f.rings);
    if (!a) continue;
    seen.add(f.name);
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    let area = 0;
    for (const r of f.rings) {
      area += Math.abs(ringArea(r));
      for (let i = 0; i + 1 < r.length; i += 2) {
        if (r[i]! < minLon) minLon = r[i]!;
        if (r[i]! > maxLon) maxLon = r[i]!;
        if (r[i + 1]! < minLat) minLat = r[i + 1]!;
        if (r[i + 1]! > maxLat) maxLat = r[i + 1]!;
      }
    }
    out.push({ key: f.name, text, lon: a.lon, lat: a.lat, minLon, minLat, maxLon, maxLat, area });
  }
  return out.sort((x, y) => y.area - x.area);
}

/* ------------------------------------------------------------- scale bar */

const NICE_METRES = [25, 50, 100, 200, 250, 500, 1000, 2000, 5000] as const;

/**
 * A round-number bar between 60 and 150 px long, given metres per pixel.
 * Falls back to the smallest step when even that is too long (absurd zoom).
 */
export function scaleBar(metresPerPixel: number): { metres: number; px: number } {
  let pick: number = NICE_METRES[0];
  for (const m of NICE_METRES) {
    if (m / metresPerPixel <= 150) pick = m;
  }
  return { metres: pick, px: pick / metresPerPixel };
}

/* ------------------------------------------------------ text placement */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextCandidate {
  key: string;
  /** Preferred centre, in screen px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedText {
  key: string;
  /** Final centre. */
  x: number;
  y: number;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Place basemap names so they never sit on top of each other or on the pins.
 * Candidates are tried in the order given (callers put the important ones
 * first); each may slide vertically a few steps off its preferred spot, and one
 * that fits nowhere is dropped — a name that cannot be read cleanly is worse
 * than none, and zooming in gives it another chance.
 */
export function placeTexts(
  candidates: readonly TextCandidate[],
  obstacles: readonly Box[],
  maxSlides = 2,
): PlacedText[] {
  const taken: Box[] = [...obstacles];
  const out: PlacedText[] = [];
  for (const c of candidates) {
    const step = c.h + 4;
    let placed: PlacedText | null = null;
    for (let i = 0; i <= maxSlides * 2 && !placed; i++) {
      // 0, +1, −1, +2, −2 … steps
      const k = i === 0 ? 0 : i % 2 === 1 ? Math.ceil(i / 2) : -i / 2;
      const y = c.y + k * step;
      const box = { x: c.x - c.w / 2, y: y - c.h / 2, w: c.w, h: c.h };
      if (taken.some((t) => boxesOverlap(box, t))) continue;
      taken.push(box);
      placed = { key: c.key, x: c.x, y };
    }
    if (placed) out.push(placed);
  }
  return out;
}
