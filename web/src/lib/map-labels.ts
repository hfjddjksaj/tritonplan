/**
 * Turning pins into drawable markers: several classes in one building become
 * one marker (York Hall carrying both a LEC and a LAB is the normal case), and
 * label chips get nudged off each other so a dense corner of campus stays
 * readable.
 *
 * Pure geometry — no React, no DOM — so the fiddly part is unit-testable.
 */
import type { MapPin } from './map-pins';

export interface PinGroup {
  /** Stable identity: the rounded coordinate pair. */
  key: string;
  lat: number;
  lng: number;
  building?: string;
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

const DOT_GAP = 9;

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

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const SIDES: LabelSide[] = ['right', 'left', 'above', 'below'];

/**
 * Greedy placement in input order: try right, then left, above, below; if every
 * side collides, keep 'right' — an overlapping label still beats a missing one.
 */
export function placeLabels(anchors: LabelAnchor[]): PlacedLabel[] {
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  const out: PlacedLabel[] = [];
  for (const a of anchors) {
    let chosen: PlacedLabel | null = null;
    for (const side of SIDES) {
      const pos = boxFor(a, side);
      const box = { ...pos, w: a.w, h: a.h };
      if (taken.some((t) => overlaps(box, t))) continue;
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
