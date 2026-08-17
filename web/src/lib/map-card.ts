/**
 * The marker card: what a clicked marker expands into, and where it goes.
 *
 * Content is one headed section per course in the building (or per exam date) —
 *
 *   CSE-030                Directions
 *   LEC · Room 2622
 *   DIS · Room 2154
 *
 * — or for exams, one section per course + date:
 *
 *   CSE-030   Wed Dec 09
 *   Final · Room 2622
 *
 * — rooms only, no times (the day tabs already scope the slice and the
 * calendar owns the times). Pure functions; the React shell renders them.
 */
import type { Point } from './map-projection';
import { abbreviateBuildingWords } from './map-basemap';
import type { MapPin } from './map-pins';
import { dateParts } from './format';

export interface CardRow {
  /** 'LEC' | 'DIS' | 'LAB' | 'Final' … */
  label: string;
  room?: string;
}

export interface CardSection {
  courseId: string;
  courseCode: string;
  hue: number;
  /** ISO date of the exam this section is about; absent for class meetings. */
  date?: string;
  rows: CardRow[];
}

/**
 * Group a marker's pins into card sections — one per course for class
 * meetings, one per exam (course + date) for exams, first appearance order —
 * and collapse each to distinct (component, room) rows: a Tue/Thu lecture is
 * two pins under "All" but one line on the card; a course's two midterms in
 * this building are two dated sections.
 */
export function cardSections(pins: readonly MapPin[]): CardSection[] {
  const sections: CardSection[] = [];
  const byKey = new Map<string, CardSection>();
  for (const p of pins) {
    const key = p.when.date ? `${p.courseId}|${p.when.date}` : p.courseId;
    let s = byKey.get(key);
    if (!s) {
      s = { courseId: p.courseId, courseCode: p.courseCode, hue: p.hue, rows: [] };
      if (p.when.date) s.date = p.when.date;
      byKey.set(key, s);
      sections.push(s);
    }
    if (!s.rows.some((r) => r.label === p.label && r.room === p.room)) {
      s.rows.push({ label: p.label, room: p.room });
    }
  }
  return sections;
}

/** The text of one row, as the card prints it. */
export function rowText(row: CardRow): string {
  return row.room ? `${row.label} · Room ${row.room}` : row.label;
}

/** The exam date as the card's heading row prints it: "Wed Dec 09". */
export function cardDate(iso: string): string {
  const { dow, month, day } = dateParts(iso);
  return `${dow} ${month} ${day}`;
}

/** Names longer than this get their stock words shortened; shorter ones stay verbatim. */
const PLACE_VERBATIM_MAX = 24;

/**
 * The building name as the card's eyebrow prints it: verbatim when it fits on
 * a line, otherwise with its stock words abbreviated ("Computer Science &
 * Eng Bldg"). Street addresses are left alone — an abbreviated address is not
 * a name anyone recognises.
 */
export function cardPlaceName(name: string): string {
  if (name.length <= PLACE_VERBATIM_MAX || /^\d/.test(name)) return name;
  return abbreviateBuildingWords(name);
}

export interface Size {
  w: number;
  h: number;
}

/* Layout metrics mirrored from the CSS (.campusmap__card): only used before the
   card has been measured, and for the label-collision obstacle in tests. */
const PAD_X = 12;
const HEAD_CHAR_W = 9; // 14.5 px bold code
const ROW_CHAR_W = 7.2; // 13 px rows
const PLACE_CHAR_W = 7.6; // 11.5 px uppercase eyebrow, tracked
const DIRECTIONS_W = 96; // "Directions" button (btn--sm) incl. its gap
const PLACE_H = 32; // the name row, button-height, plus its gap
const HEAD_H = 24;
const ROW_H = 22;
const SECTION_GAP = 8;
const PAD_Y = 10;
const DATE_CHAR_W = 6.6; // 12 px muted date at the heading's right
const DATE_GAP = 12;

/** A first-paint guess at the card's size, replaced by a DOM measurement. */
export function estimateCardSize(sections: readonly CardSection[], place = ''): Size {
  // Top row: the building name (eyebrow) with the Directions button at its right.
  let w = place.length * PLACE_CHAR_W + DIRECTIONS_W;
  let h = PAD_Y * 2 + PLACE_H;
  sections.forEach((s, i) => {
    const head = s.courseCode.length * HEAD_CHAR_W + (s.date ? DATE_GAP + cardDate(s.date).length * DATE_CHAR_W : 0);
    w = Math.max(w, head);
    for (const r of s.rows) w = Math.max(w, rowText(r).length * ROW_CHAR_W);
    h += HEAD_H + s.rows.length * ROW_H + (i > 0 ? SECTION_GAP : 0);
  });
  return { w: Math.round(w + PAD_X * 2), h: Math.round(h) };
}

/** Distance from the dot's centre to the card's near corner. */
const GAP = 12;
/** Breathing room from the canvas edges (and the header's bottom edge). */
const EDGE = 8;

/**
 * Boxes the card must not sit on: the zoom buttons (bottom-right). The scale
 * bar is not one — a card briefly over it costs nothing, a card over the
 * buttons costs the user the buttons.
 */
function furniture(canvas: Size): Box[] {
  return [{ x: canvas.w - 50, y: canvas.h - 140, w: 50, h: 140 }];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Where to put a card of `size` for a marker at `anchor` on a `canvas` whose
 * top `insetTop` px are under the floating header: right-below the dot by
 * default, else left-below, right-above, left-above — the first corner that
 * keeps the card whole on the canvas, below the header and off the zoom
 * buttons. If none does, right-below clamped inside the canvas: the card
 * is never clipped.
 */
export function cardPlacement(
  anchor: Point,
  size: Size,
  canvas: Size,
  insetTop: number,
): { left: number; top: number } {
  const right = anchor.x + GAP;
  const leftOf = anchor.x - GAP - size.w;
  const below = anchor.y + GAP;
  const above = anchor.y - GAP - size.h;
  const candidates = [
    { left: right, top: below },
    { left: leftOf, top: below },
    { left: right, top: above },
    { left: leftOf, top: above },
  ];
  const blocked = furniture(canvas);
  const fits = (c: { left: number; top: number }) =>
    c.left >= EDGE &&
    c.left + size.w <= canvas.w - EDGE &&
    c.top >= insetTop + EDGE &&
    c.top + size.h <= canvas.h - EDGE &&
    !blocked.some((b) => overlaps({ x: c.left, y: c.top, w: size.w, h: size.h }, b));
  const pick = candidates.find(fits) ?? {
    left: Math.max(EDGE, Math.min(canvas.w - EDGE - size.w, right)),
    top: Math.max(insetTop + EDGE, Math.min(canvas.h - EDGE - size.h, below)),
  };
  // A card taller than the room below the header still starts under the header.
  return { left: Math.round(pick.left), top: Math.round(Math.max(insetTop + EDGE, pick.top)) };
}
