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
import { project, toScreen, type Viewport } from './map-projection';

export interface PinGroup {
  /** Stable identity: the rounded coordinate pair. */
  key: string;
  lat: number;
  lng: number;
  /** Raw TSS building text of the first pin here. */
  building?: string;
  /** Its matched official name — what footprints and the popover key on. */
  place?: string;
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

/**
 * "CSE-8A LEC" for one class here, "CSE-8A +2" when several share the
 * building — the DOM overlay's marker chip and the SVG renderer's chip share
 * this text and its width metrics, so both draw the exact same pill.
 */
export function chipText(pins: readonly MapPin[]): string {
  const first = pins[0]!;
  return pins.length === 1 ? `${first.courseCode} ${first.label}` : `${first.courseCode} +${pins.length - 1}`;
}

/** Rough chip width per character — good enough for collision avoidance. */
const CHAR_W = 7.1; // 12 px bold, tracked tight
export const CHIP_H = 22;
/** The pill's inner geometry: dot at the left, then the text, with end padding. */
export const CHIP_PAD_L = 8;
export const CHIP_DOT_R = 4.5;
const CHIP_DOT_GAP = 6;
const CHIP_PAD_R = 10;
export const CHIP_TEXT_X = CHIP_PAD_L + CHIP_DOT_R * 2 + CHIP_DOT_GAP;

export function chipWidth(pins: readonly MapPin[]): number {
  return CHIP_TEXT_X + chipText(pins).length * CHAR_W + CHIP_PAD_R;
}

/** Spoken form of a marker: the chip is an abbreviation, this is the whole truth. */
export function markerLabel(g: PinGroup): string {
  const what = g.pins.map((p) => `${p.courseCode} ${p.label}`).join(', ');
  const where = g.place ?? g.building;
  return where ? `${where}: ${what}` : what;
}

/** Whether a projected point lands inside the drawn canvas. */
function inside(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && x <= w && y >= 0 && y <= h;
}

/**
 * Split groups by whether the given viewport can show them. The home frame is
 * the academic core, so a class at Hillcrest, Scripps or the Preuss School
 * projects outside the canvas: drawing it there is the same as not drawing it,
 * except that it silently inflates the "N buildings" count. Callers draw
 * `onCanvas` and list `offCanvas`.
 */
export function splitByViewport(
  groups: PinGroup[],
  view: Viewport,
  w: number,
  h: number,
): { onCanvas: PinGroup[]; offCanvas: PinGroup[] } {
  const onCanvas: PinGroup[] = [];
  const offCanvas: PinGroup[] = [];
  for (const g of groups) {
    const p = toScreen(project(g.lng, g.lat), view);
    (inside(p.x, p.y, w, h) ? onCanvas : offCanvas).push(g);
  }
  return { onCanvas, offCanvas };
}

/** An axis-aligned pixel rectangle — a chip, a dot's obstacle box, a reserved area. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Same split as {@link splitByViewport}, against a MapLibre `LngLatBox` frame
 * instead of the SVG renderer's `Viewport` + width/height. Used once the
 * MapLibre camera (not the old fitted SVG viewport) is what decides what's
 * visible.
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
