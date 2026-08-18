/**
 * The tree the 3D map plants: a tiny billboard sprite, drawn in arithmetic.
 *
 * In 2D the campus's 2,856 trees are flat circles, which is what UCSD's own map
 * does and what reads correctly from straight above. Tilt the camera to 55° and
 * those circles lie down on the ground with the shadows — the one thing on a 3D
 * map that should obviously be standing up is the only thing still flat. This
 * sprite stands up instead: MapLibre draws it as a `symbol` with viewport-aligned
 * pitch and rotation, so it faces the camera from every angle, anchored at its
 * bottom edge so the trunk meets the ground where the point is.
 *
 * No canvas, no PNG asset, no network: a pure function returning the RGBA bytes
 * `map.addImage` wants. That keeps it unit-testable (the tests below read
 * individual pixels), keeps one more binary out of the repo, and keeps the map's
 * "every byte comes from our own origin" rule trivially true. `pixelRatio: 2` at
 * the call site, so 48 px of sprite draws as 24 CSS px.
 */

/** Canopy top, canopy bottom, canopy outline, trunk — the palette in map-style's key. */
const CANOPY_TOP = [0x7f, 0xa8, 0x6a];
const CANOPY_BOTTOM = [0x5f, 0x8b, 0x4e];
const CANOPY_LINE = [0x4e, 0x74, 0x40];
const TRUNK = [0x6b, 0x4a, 0x2f];

export interface SpriteImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 0 outside, 1 inside, a soft ramp across the 1.2 px either side of the edge. */
function coverage(distance: number, radius: number): number {
  const t = (radius - distance) / 1.2 + 0.5;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * A tree sprite `size` px square, in RGBA. The canopy is a disc in the top ~⅔
 * with a darker rim, over a short trunk that reaches the bottom edge — bottom
 * centre is where MapLibre pins it to the ground.
 */
export function treeSprite(size = 48): SpriteImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const cx = size / 2;
  const canopyR = size * 0.32;
  const canopyCy = canopyR + size * 0.03;
  const trunkHalf = Math.max(1, size * 0.05);
  const trunkTop = canopyCy + canopyR * 0.55;

  const put = (i: number, rgb: number[], alpha: number) => {
    // Over whatever is already there (the trunk is drawn first, the canopy over
    // it), so the canopy's soft rim blends into the trunk rather than cutting it.
    const a0 = data[i + 3]! / 255;
    const a = alpha + a0 * (1 - alpha);
    if (a <= 0) return;
    for (let c = 0; c < 3; c++) {
      const under = data[i + c]! * a0 * (1 - alpha);
      data[i + c] = (rgb[c]! * alpha + under) / a;
    }
    data[i + 3] = a * 255;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      // Trunk: a straight post from under the canopy to the bottom edge.
      if (py >= trunkTop) {
        put(i, TRUNK, coverage(Math.abs(px - cx), trunkHalf));
      }

      // Canopy: a disc, lit from the top — the gradient is what keeps it from
      // reading as a flat sticker at 55° of pitch.
      const d = Math.hypot(px - cx, py - canopyCy);
      const inside = coverage(d, canopyR);
      if (inside > 0) {
        const rim = 1 - coverage(d, canopyR - 1.6); // 1 at the very edge, 0 inside
        const t = (py - (canopyCy - canopyR)) / (canopyR * 2); // 0 top → 1 bottom
        const body = [0, 1, 2].map((c) => CANOPY_TOP[c]! + (CANOPY_BOTTOM[c]! - CANOPY_TOP[c]!) * t);
        const rgb = [0, 1, 2].map((c) => body[c]! + (CANOPY_LINE[c]! - body[c]!) * rim);
        put(i, rgb, inside);
      }
    }
  }

  return { width: size, height: size, data };
}
