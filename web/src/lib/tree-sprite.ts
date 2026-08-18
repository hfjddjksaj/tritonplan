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
 * WHY IT IS BUILT THE WAY IT IS. The first version was one disc on a stick, and
 * it read as a lollipop from the first look — exactly the failure this task was
 * told to watch for. Three things fix it, and none of them is detail for
 * detail's sake, because at z15 this draws at 3–14 px and only the silhouette
 * and the shading survive:
 *
 * 1. The canopy is a UNION OF LOBES, not a circle. A perfect circle is the one
 *    shape foliage never has, and the bumpy outline is legible even when the
 *    whole sprite is a dozen pixels across.
 * 2. It is SHADED FROM A HEIGHT FIELD, not a flat gradient: each lobe is a dome,
 *    the surface normal comes from the slope of the combined dome, and the light
 *    is up-and-to-the-left. That is what makes it read as a volume rather than a
 *    sticker when the camera is tilted 55° and everything else has real depth.
 * 3. The TRUNK TAPERS and the canopy overlaps its top, so the two are one object
 *    instead of a ball balanced on a pole.
 *
 * No canvas, no PNG asset, no network: a pure function returning the RGBA bytes
 * `map.addImage` wants. That keeps it unit-testable (the tests read individual
 * pixels), keeps one more binary out of the repo, and keeps the map's "every
 * byte comes from our own origin" rule trivially true. `pixelRatio: 2` at the
 * call site, so 48 px of sprite draws as 24 CSS px.
 */

/** Canopy in light, canopy in shadow, its rim, and the trunk. */
const CANOPY_LIT = [0x93, 0xba, 0x74];
const CANOPY_SHADE = [0x4c, 0x74, 0x3f];
const CANOPY_RIM = [0x3c, 0x5c, 0x33];
const TRUNK = [0x6b, 0x4a, 0x2f];
const TRUNK_SHADE = [0x4f, 0x36, 0x22];

export interface SpriteImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * The canopy's lobes, in units of the sprite's width, from its bottom-centre
 * (x right, y up). Deliberately not symmetric — a mirror-symmetric crown reads
 * as a logo.
 */
const LOBES: readonly [number, number, number][] = [
  [-0.13, 0.66, 0.21],
  [0.14, 0.7, 0.19],
  [0.0, 0.82, 0.17],
  [-0.05, 0.55, 0.2],
  [0.19, 0.55, 0.14],
];

/** 0 outside, 1 inside, a soft ramp of `feather` px across the edge. */
function ramp(inside: number, feather: number): number {
  const t = inside / feather + 0.5;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * A tree sprite `size` px square, in RGBA: a lobed canopy over a tapered trunk
 * that reaches the bottom edge — bottom centre is where MapLibre pins it to the
 * ground.
 */
export function treeSprite(size = 48): SpriteImage {
  const data = new Uint8ClampedArray(size * size * 4);

  /** Height of the canopy's dome at a point, in sprite units; 0 outside it. */
  const dome = (x: number, y: number): number => {
    let h = 0;
    for (const [lx, ly, r] of LOBES) {
      const d2 = (x - lx) ** 2 + (y - ly) ** 2;
      if (d2 < r * r) h = Math.max(h, Math.sqrt(r * r - d2));
    }
    return h;
  };

  // Light from up and to the left, and slightly towards the viewer.
  const L = [-0.45, 0.72, 0.53];
  const step = 1 / size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      // Sprite units: x from the centre line, y up from the bottom edge.
      const x = (px + 0.5) / size - 0.5;
      const y = 1 - (py + 0.5) / size;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      // Trunk first, so the canopy's rim blends over it: a tapered post from the
      // ground into the crown, its right side in shadow.
      const trunkHalf = 0.038 - 0.016 * y; // widest at the foot
      const trunkTop = LOBES.reduce((m, [, ly]) => Math.max(m, ly), 0);
      if (y < trunkTop) {
        const cover = ramp((trunkHalf - Math.abs(x)) * size, 1.2);
        if (cover > 0) {
          const lit = x < 0.004 ? TRUNK : TRUNK_SHADE;
          [r, g, b] = lit;
          a = cover;
        }
      }

      // Canopy: coverage from the dome's footprint, colour from its slope.
      const h = dome(x, y);
      if (h > 0) {
        const cover = ramp(h * size, 1.4);
        if (cover > 0) {
          // Normal from finite differences of the height field — the lobes read
          // as separate bumps because each one's slope turns over independently.
          const nx = (dome(x - step, y) - dome(x + step, y)) / (2 * step);
          const ny = (dome(x, y - step) - dome(x, y + step)) / (2 * step);
          const len = Math.hypot(nx, ny, 1);
          const lambert = Math.max(0, (nx * L[0]! + ny * L[1]! + 1 * L[2]!) / len);
          const t = Math.min(1, 0.25 + 0.75 * lambert);
          const body = [0, 1, 2].map((c) => CANOPY_SHADE[c]! + (CANOPY_LIT[c]! - CANOPY_SHADE[c]!) * t);
          // A darker rim on the silhouette: at 3 px across, the outline IS the tree.
          const rim = 1 - ramp((h - 0.022) * size, 2.2);
          const rgb = [0, 1, 2].map((c) => body[c]! + (CANOPY_RIM[c]! - body[c]!) * rim * 0.85);
          // Over whatever the trunk left here, so the crown's soft rim blends
          // into the wood instead of cutting a notch out of it.
          const out = cover + a * (1 - cover);
          const over = (top: number, bottom: number) => (top * cover + bottom * a * (1 - cover)) / out;
          [r, g, b] = [over(rgb[0]!, r), over(rgb[1]!, g), over(rgb[2]!, b)];
          a = out;
        }
      }

      if (a > 0) {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = a * 255;
      }
    }
  }

  return { width: size, height: size, data };
}
