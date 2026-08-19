/**
 * Turning pins into drawable markers: several classes in one building become
 * one marker (York Hall carrying both a LEC and a LAB is the normal case), and
 * label chips get nudged off each other so a dense corner of campus stays
 * readable.
 *
 * Pure geometry — no React, no DOM — so the fiddly part is unit-testable.
 */
import type { LngLatBox } from './campus-geo';
import { isOnlineModality, type MapPin } from './map-pins';

export interface PinGroup {
  /** Stable identity: the rounded coordinate pair. */
  key: string;
  lat: number;
  lng: number;
  /** Raw TSS building text of the first pin here. */
  building?: string;
  /** Its matched official name — what footprints and the popover key on. */
  place?: string;
  /** Set only when `place` names a complex: the wings to outline instead. */
  parts?: readonly string[];
  pins: MapPin[];
}

/** Group locatable pins by position; unlocatable ones are dropped (see unlocatedPins). */
export function groupPins(pins: MapPin[]): PinGroup[] {
  const byKey = new Map<string, PinGroup>();
  for (const p of pins) {
    if (!p.coords) continue;
    const key = `${p.coords.lat.toFixed(5)},${p.coords.lng.toFixed(5)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.pins.push(p);
      continue;
    }
    byKey.set(key, {
      key,
      lat: p.coords.lat,
      lng: p.coords.lng,
      building: p.building,
      place: p.place,
      parts: p.parts,
      pins: [p],
    });
  }
  return [...byKey.values()];
}

/**
 * Pins the map cannot place: no building match, or no location at all (a fully
 * online section). Surfaced in a list with their raw TSS text rather than
 * guessed onto the map — same doctrine as matchBuilding().
 */
export function unlocatedPins(pins: MapPin[]): MapPin[] {
  return pins.filter((p) => p.coords === null);
}

/** One line of a marker chip: a course that meets in this building. */
export interface ChipRow {
  courseId: string;
  courseCode: string;
  hue: number;
}

/**
 * What a marker's chip prints: one line per COURSE here, in the order the pins
 * arrive, and nothing else — no component label, no count.
 *
 * The chip used to be a single pill: "CSE-8A LEC" alone, "CSE-8A +4" when the
 * building carried more. That "+4" was read as a warning rather than a summary
 * — the natural reading is "four classes it could not draw" — so the chip now
 * names every course it stands for and the reader never has to guess what the
 * number was hiding.
 *
 * By course, not by pin: a Tue/Thu lecture is two pins, a lecture plus its
 * discussion in the same room is two more, and two dated sittings of one
 * midterm are two again — all one line, because they are one course. The rooms
 * and components are what the card is for.
 */
export function chipRows(pins: readonly MapPin[]): ChipRow[] {
  const out: ChipRow[] = [];
  const seen = new Set<string>();
  for (const p of pins) {
    if (seen.has(p.courseId)) continue;
    seen.add(p.courseId);
    out.push({ courseId: p.courseId, courseCode: p.courseCode, hue: p.hue });
  }
  return out;
}

/** Rough chip width per character — good enough for collision avoidance. */
const CHAR_W = 7.1; // 12 px bold, tracked tight
/** One course line, and the hairline between two of them (mirrors app.css). */
export const CHIP_ROW_H = 22;
const CHIP_RULE_H = 1;
/** The pill's inner geometry: dot at the left, then the code, with end padding. */
export const CHIP_PAD_L = 8;
export const CHIP_DOT_R = 4.5;
const CHIP_DOT_GAP = 6;
const CHIP_PAD_R = 10;
export const CHIP_TEXT_X = CHIP_PAD_L + CHIP_DOT_R * 2 + CHIP_DOT_GAP;

/**
 * The chip's box: as wide as its longest course code, as tall as it has
 * courses. Both the collision pass and the hit test measure it from here, so a
 * chip is never clickable somewhere it isn't drawn.
 */
export function chipSize(pins: readonly MapPin[]): { w: number; h: number } {
  const rows = chipRows(pins);
  const longest = rows.reduce((m, r) => Math.max(m, r.courseCode.length), 0);
  return {
    w: CHIP_TEXT_X + longest * CHAR_W + CHIP_PAD_R,
    h: rows.length * CHIP_ROW_H + Math.max(0, rows.length - 1) * CHIP_RULE_H,
  };
}

/** Spoken form of a marker: the chip is an abbreviation, this is the whole truth. */
export function markerLabel(g: PinGroup): string {
  const what = g.pins.map((p) => `${p.courseCode} ${p.label}`).join(', ');
  const where = g.place ?? g.building;
  return where ? `${where}: ${what}` : what;
}

/** Whether a projected point lands inside the drawn canvas. */
export function inside(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && x <= w && y >= 0 && y <= h;
}

/** An axis-aligned pixel rectangle: a chip's box while labels are being placed.
 *  Internal — the SVG renderer's `reserved` areas were its last outside caller. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Split groups by whether the map's home frame can show them. That frame is
 * the academic core, so a class at Hillcrest, Scripps or the Preuss School
 * falls outside it: drawing it there is the same as not drawing it, except
 * that it silently inflates the "N buildings" count. Callers draw `onCanvas`
 * and list `offCanvas`.
 *
 * `box === null` means the map hasn't produced a home frame yet — nothing is
 * drawn and nothing is reported as off-map either, rather than guessing.
 */
export function splitByBounds(
  groups: PinGroup[],
  box: LngLatBox | null,
): { onCanvas: PinGroup[]; offCanvas: PinGroup[] } {
  if (!box) return { onCanvas: [], offCanvas: [] };
  const [[west, south], [east, north]] = box;
  const onCanvas: PinGroup[] = [];
  const offCanvas: PinGroup[] = [];
  for (const g of groups) {
    const within = g.lng >= west && g.lng <= east && g.lat >= south && g.lat <= north;
    (within ? onCanvas : offCanvas).push(g);
  }
  return { onCanvas, offCanvas };
}

/** Why a class isn't a dot on the map. */
export type UnplacedReason = 'online' | 'unmatched' | 'off-map';

export interface UnplacedPin {
  pin: MapPin;
  reason: UnplacedReason;
  /** The trailing half of the list line — what to say instead of a location. */
  detail: string;
}

/**
 * Everything the student has that the map is not drawing, each with its reason.
 * Three different things used to look like one failure (or like nothing at all):
 *
 * - `online`   — a Live Online section. Nothing went wrong; it has no building.
 * - `unmatched`— matchBuilding() couldn't resolve the TSS text. Show that text
 *                raw rather than pointing at the wrong building.
 * - `off-map`  — a real, located class outside the framed academic core
 *                (Hillcrest, Scripps, Preuss). Previously it just vanished.
 */
export function unplacedPins(pins: MapPin[], offCanvas: readonly PinGroup[] = []): UnplacedPin[] {
  const out: UnplacedPin[] = [];
  for (const p of unlocatedPins(pins)) {
    if (isOnlineModality(p.modality)) {
      out.push({ pin: p, reason: 'online', detail: p.modality! });
    } else {
      out.push({
        pin: p,
        reason: 'unmatched',
        detail: p.rawLocation ?? p.building ?? 'no location listed in TSS',
      });
    }
  }
  for (const g of offCanvas) {
    for (const p of g.pins) {
      const place = p.building ?? p.rawLocation ?? 'this location';
      out.push({ pin: p, reason: 'off-map', detail: `${place} — outside the mapped area` });
    }
  }
  return out;
}

export interface LabelAnchor {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LabelSide = 'right' | 'left' | 'above' | 'below';

export interface PlacedLabel {
  key: string;
  x: number;
  y: number;
  side: LabelSide;
}

const DOT_GAP = 12;

function boxFor(a: LabelAnchor, side: LabelSide): { x: number; y: number } {
  switch (side) {
    case 'right':
      return { x: a.x + DOT_GAP, y: a.y - a.h / 2 };
    case 'left':
      return { x: a.x - DOT_GAP - a.w, y: a.y - a.h / 2 };
    case 'above':
      return { x: a.x - a.w / 2, y: a.y - DOT_GAP - a.h };
    case 'below':
      return { x: a.x - a.w / 2, y: a.y + DOT_GAP };
  }
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const SIDES: LabelSide[] = ['right', 'left', 'above', 'below'];

/**
 * Greedy placement in input order: try right, then left, above, below; if every
 * side collides, keep 'right' — an overlapping label still beats a missing one.
 * With `bounds` (canvas width/height), a side that would push the chip off the
 * canvas counts as a collision too, so a marker hugging the left edge gets its
 * chip on the right rather than half-clipped.
 */
export function placeLabels(anchors: LabelAnchor[], bounds?: { w: number; h: number }): PlacedLabel[] {
  const taken: Box[] = [];
  const out: PlacedLabel[] = [];
  const offCanvas = (b: Box) =>
    bounds !== undefined && (b.x < 0 || b.y < 0 || b.x + b.w > bounds.w || b.y + b.h > bounds.h);
  for (const a of anchors) {
    let chosen: PlacedLabel | null = null;
    for (const side of SIDES) {
      const pos = boxFor(a, side);
      const box = { ...pos, w: a.w, h: a.h };
      if (offCanvas(box) || taken.some((t) => overlaps(box, t))) continue;
      taken.push(box);
      chosen = { key: a.key, ...pos, side };
      break;
    }
    if (!chosen) {
      const pos = boxFor(a, 'right');
      taken.push({ ...pos, w: a.w, h: a.h });
      chosen = { key: a.key, ...pos, side: 'right' };
    }
    out.push(chosen);
  }
  return out;
}

/**
 * A marker as it is actually drawn: its dot at (x, y) in canvas pixels, and the
 * box its chip occupies beside it, with the side the collision pass put it on.
 *
 * The open marker keeps its box like any other, even though its chip is not
 * drawn (the card takes over that job): the card is placed by growing out of
 * this box, and holding the slot means opening or closing a card never makes
 * the neighbouring chips jump to a different side.
 */
export interface PlacedMarker {
  group: PinGroup;
  x: number;
  y: number;
  chip: { x: number; y: number; w: number; h: number; side: LabelSide };
}

/**
 * The dot's clickable radius. The drawn dot is 15 px across; this is a little
 * wider so a fingertip on a phone has something to hit.
 */
export const DOT_HIT_R = 11;

/**
 * Which marker, if any, is under a point on the canvas — topmost first, so the
 * answer matches what the student sees.
 *
 * This exists because the markers themselves are `pointer-events: none` (see
 * MapMarkers.tsx). They used to take the pointer, and since the overlay is a
 * SIBLING of the GL canvas, every press that landed on a chip or a dot was
 * swallowed whole: the map did not pan, did not zoom, and no card opened
 * either — up to ~4 % of the canvas, concentrated exactly where the eye and the
 * finger go (QA I1). Letting every gesture through to MapLibre and asking this
 * function afterwards costs nothing and fixes drag, pinch and wheel in one
 * move; MapLibre only fires `click` when the press was not a drag, so a drag
 * that starts on a chip pans without opening anything.
 *
 * `liveDot` exists because the overlay is drawn from a FRESHER camera than this
 * layout: MapMarkers writes every dot's transform straight from MapLibre's
 * `move` event, while the layout itself is recomputed on the rAF-throttled tick
 * and so can be one frame behind. Ask for the dot's position now and the test
 * matches what the student sees; leave it out and it matches the layout, which
 * is the same thing whenever the camera is at rest. The chip is measured as an
 * offset from its dot either way, because that is exactly how it is drawn (a
 * child of the marker), so it cannot drift from the box it occupies.
 */
export function hitMarker(
  placed: readonly PlacedMarker[],
  x: number,
  y: number,
  liveDot?: (m: PlacedMarker) => { x: number; y: number },
): string | null {
  // Later markers paint over earlier ones, so search back to front.
  for (let i = placed.length - 1; i >= 0; i--) {
    const m = placed[i]!;
    const at = liveDot ? liveDot(m) : m;
    const c = m.chip;
    const cx = c.x + (at.x - m.x);
    const cy = c.y + (at.y - m.y);
    if (x >= cx && x <= cx + c.w && y >= cy && y <= cy + c.h) return m.group.key;
    if (Math.hypot(x - at.x, y - at.y) <= DOT_HIT_R) return m.group.key;
  }
  return null;
}
