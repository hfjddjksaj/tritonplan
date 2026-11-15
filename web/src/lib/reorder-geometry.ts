// Slot decisions for dragging a card to a new place in a vertical list.

/** Equals `.course-card { margin-bottom }`; the insertion line sits in the middle of it. */
export const GAP = 12;
/** Pixels past a card's midpoint the reference line must go before it changes sides. */
export const HYSTERESIS = 6;
/** Height of the band at the list's top and bottom where autoscroll pulls. */
export const EDGE = 56;

export interface Span {
  top: number;
  bottom: number;
}

export interface TrailPoint {
  t: number;
  x: number;
  y: number;
}

const MAX_SPEED = 2600;
const MIN_SPAN_MS = 8;
const STALE_MS = 60;

/** How many of the other cards lie above `ref`; `prev` is the slot held now. */
export function slotIndex(ref: number, mids: readonly number[], prev: number): number {
  let n = 0;
  for (let j = 0; j < mids.length; j++) {
    if (ref > mids[j] + (j < prev ? -HYSTERESIS : HYSTERESIS)) n++;
  }
  return n;
}

/** Middle of the gap before `spans[i]`, or after the last card when `i` is past the end. */
export function gapY(i: number, spans: readonly Span[], emptyY: number): number {
  if (spans.length === 0) return emptyY;
  if (i === 0) return spans[0].top - GAP / 2;
  return spans[i - 1].bottom + GAP / 2;
}

/** Pointer speed in px/s over the trail, so a card released mid-throw keeps its momentum. */
export function releaseVelocity(trail: readonly TrailPoint[], now: number): { vx: number; vy: number } {
  const zero = { vx: 0, vy: 0 };
  if (trail.length < 2) return zero;
  const a = trail[0];
  const b = trail[trail.length - 1];
  const dt = b.t - a.t;
  if (dt < MIN_SPAN_MS || now - b.t > STALE_MS) return zero;
  const cap = (v: number) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
  return { vx: cap(((b.x - a.x) / dt) * 1000), vy: cap(((b.y - a.y) / dt) * 1000) };
}

/** -1 (scroll up) to 1 (scroll down), growing toward the edge; 0 outside the bands. */
export function edgePull(y: number, top: number, bottom: number): number {
  if (y < top + EDGE) return -Math.min(1, (top + EDGE - y) / EDGE);
  if (y > bottom - EDGE) return Math.min(1, (y - (bottom - EDGE)) / EDGE);
  return 0;
}
