/**
 * Web Mercator projection for the campus map.
 *
 * Kept separate from rendering so the geometry is unit-testable and so adding
 * pan/zoom later means changing the Viewport this module produces, not the
 * component that consumes it.
 */

export interface Point {
  x: number;
  y: number;
}

/** World coordinates: x is longitude in radians, y grows NORTH. */
export function project(lon: number, lat: number): Point {
  return {
    x: (lon * Math.PI) / 180,
    y: Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  };
}

export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * A world span this small means one point (or none). ~0.00002 rad of longitude
 * is roughly 100 m here — a sane default frame rather than an infinite scale.
 */
const MIN_SPAN = 0.00002;

/** Uniform-scale fit of `pts` into a w×h box with `padding` on every side. */
export function fitBounds(pts: Point[], w: number, h: number, padding: number): Viewport {
  const innerW = Math.max(1, w - 2 * padding);
  const innerH = Math.max(1, h - 2 * padding);
  if (pts.length === 0) {
    return { scale: innerW / MIN_SPAN, offsetX: w / 2, offsetY: h / 2 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = Math.max(maxX - minX, MIN_SPAN);
  const spanY = Math.max(maxY - minY, MIN_SPAN);
  const scale = Math.min(innerW / spanX, innerH / spanY);
  // Offsets place the world-space centre at the viewport centre.
  return {
    scale,
    offsetX: w / 2 - ((minX + maxX) / 2) * scale,
    offsetY: h / 2 + ((minY + maxY) / 2) * scale,
  };
}

/** World → screen. Y is flipped so north renders up. */
export function toScreen(p: Point, v: Viewport): Point {
  return { x: p.x * v.scale + v.offsetX, y: v.offsetY - p.y * v.scale };
}
