// The line that shows where a dragged card will land: marks in the rail's
// gutters either side of the card column, and a rule across it in two halves
// that meet in the middle. `on` is how far the line has arrived (0-1) and
// `bead` how fast it is travelling (0-1): on the move the halves draw back to
// their marks, and run out to meet again where it stops.

export type LineStyle = 'scroll' | 'drop';

/** `drop` is complete too; changing this constant is the whole switch. */
export const INSERTION_LINE: LineStyle = 'scroll';

/** How far the drawing reaches past the card column on each side. */
export const LINE_GUTTER = 13;
export const LINE_HEIGHT = 24;
/** How far the neighbouring cards step back from each drawing. */
export const LINE_PART: Record<LineStyle, number> = { scroll: 6, drop: 5 };

export interface LineSpec {
  a: number;
  b: number;
  grow: 'unfurl' | 'swell';
  defs: string;
  svg: string;
}

export interface LineDrawing {
  spec: LineSpec;
  l: Element;
  r: Element;
  lh: Element;
  rh: Element;
}

type Pt = [number, number];
type Shape =
  | { stroke: Pt[]; from: number; to: number; ball?: number }
  | { leaf: [number, number, number, number, number] }
  | { dot: [number, number, number] }
  | { poly: Pt[] };

const CY = LINE_HEIGHT / 2;
const STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

const fmt = (n: number) => Math.round(n * 100) / 100;

function halves(a: number, b: number, width: number): string {
  const m = (a + b) / 2;
  return (
    `<line data-part="lh" x1="${a}" y1="${CY}" x2="${m}" y2="${CY}" stroke-width="${width}" ${STROKE}/>` +
    `<line data-part="rh" x1="${m}" y1="${CY}" x2="${b}" y2="${CY}" stroke-width="${width}" ${STROKE}/>`
  );
}

/** The outline of a stroke laid over `pts` that thins from `w0` to `w1`. */
function ribbon(pts: Pt[], w0: number, w1: number): Pt[] {
  const near: Pt[] = [];
  const far: Pt[] = [];
  const last = pts.length - 1;
  pts.forEach(([x, y], i) => {
    const [px, py] = pts[Math.max(0, i - 1)];
    const [nx, ny] = pts[Math.min(last, i + 1)];
    const len = Math.hypot(nx - px, ny - py) || 1;
    const half = (w0 + (w1 - w0) * (i / last)) / 2;
    const ox = (-(ny - py) / len) * half;
    const oy = ((nx - px) / len) * half;
    near.push([x + ox, y + oy]);
    far.push([x - ox, y - oy]);
  });
  return near.concat(far.reverse());
}

/** A leaf: two shallow arcs between a root and a tip. */
function leaf(x0: number, y0: number, x1: number, y1: number, belly: number): Pt[] {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const nx = (-(y1 - y0) / len) * belly;
  const ny = ((x1 - x0) / len) * belly;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  return [[x0, y0], [mx + nx, my + ny], [x1, y1], [mx - nx, my - ny]];
}

/** A curl that winds in on itself: a circle whose radius drains away as it turns. */
function spiral(cx: number, cy: number, R: number, from: number, sweep: number, n = 44): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const r = R * (1 - 0.74 * Math.pow(u, 0.85));
    pts.push([cx + r * Math.cos(from + sweep * u), cy + r * Math.sin(from + sweep * u)]);
  }
  return pts;
}

/** Points along a cubic curve. */
function curve(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 26): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = 1 - t;
    const at = (k: 0 | 1) => s * s * s * p0[k] + 3 * s * s * t * p1[k] + 3 * s * t * t * p2[k] + t * t * t * p3[k];
    pts.push([at(0), at(1)]);
  }
  return pts;
}

/** Shapes given in one end's own coordinates (x outward from the rule's end, y
 *  up), drawn at that end. Each is its own path, so overlaps never cut holes. */
function ornament(x0: number, dir: number, shapes: Shape[], k = 1): string {
  const P = ([x, y]: Pt) => `${fmt(x0 - x * dir)},${fmt(CY - y)}`;
  const dot = (x: number, y: number, r: number) => `<circle cx="${fmt(x0 - x * dir)}" cy="${fmt(CY - y)}" r="${r}"/>`;
  const sized = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x * k, y * k]);
  return shapes
    .map((s) => {
      if ('stroke' in s) {
        // Sized first, so a stroke's weight is in real pixels whatever the scale.
        const pts = sized(s.stroke);
        const [ex, ey] = pts[pts.length - 1];
        return `<path d="M${ribbon(pts, s.from, s.to).map(P).join('L')}Z"/>` + (s.ball ? dot(ex, ey, s.ball) : '');
      }
      if ('leaf' in s) {
        const [x0, y0, x1, y1, belly] = s.leaf.map((n) => n * k);
        const l = leaf(x0, y0, x1, y1, belly);
        return `<path d="M${P(l[0])}Q${P(l[1])} ${P(l[2])}Q${P(l[3])} ${P(l[0])}Z"/>`;
      }
      if ('dot' in s) return dot(s.dot[0] * k, s.dot[1] * k, s.dot[2]);
      return `<path d="M${sized(s.poly).map(P).join('L')}Z"/>`;
    })
    .join('');
}

// Ids must be unique per document, and several drawings can be alive at once.
let gildCount = 0;

/** Light above, shade below: what makes a flat shape read as gilt moulding. */
function gild(): { fill: string; defs: string } {
  const id = `gilt${++gildCount}`;
  const stop = (at: number, mix: string) =>
    `<stop offset="${at}" stop-color="currentColor"${mix ? ` style="stop-color:color-mix(in srgb, currentColor ${mix})"` : ''}/>`;
  return {
    fill: `url(#${id})`,
    defs:
      `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${CY - 11}" x2="0" y2="${CY + 11}">` +
      stop(0, '50%, white') + stop(0.5, '') + stop(1, '68%, black') +
      `</linearGradient></defs>`,
  };
}

// A rule that ends in scrollwork, as on a gilt picture frame, and the two ends
// are not the same: on the left a large volute over a small one with a tendril
// running out beneath them; on the right a rosette with a curl above it and a
// tail trailing back under the rule.
function scroll(w: number): LineSpec {
  const a = LINE_GUTTER - 3;
  const b = LINE_GUTTER + w + 3;
  const gilt = gild();
  const K = 0.74; // laid out large, set down smaller
  const left: Shape[] = [
    { stroke: spiral(0, 8.5, 8.5, -Math.PI / 2, 2.6 * Math.PI), from: 1.8, to: 0.8, ball: 1.2 },
    { stroke: spiral(0, -4.8, 4.8, Math.PI / 2, -2.1 * Math.PI, 30), from: 1.5, to: 0.7, ball: 1 },
    { stroke: curve([-10, 0], [-6, -8], [2, -16.5], [10, -11.2]), from: 1.3, to: 0.5, ball: 0.9 },
    { leaf: [-0.5, 0, 9.5, 0.6, 2.8] },
    { leaf: [-11.5, 0, -7, 5, 2] },
    { poly: [[-16.2, 0], [-19, 2.3], [-21.8, 0], [-19, -2.3]] },
  ];
  const petals: Shape[] = [0, 1, 2, 3, 4, 5].map((i) => {
    const t = (i * Math.PI) / 3;
    return { leaf: [2 + 1.6 * Math.cos(t), 1.6 * Math.sin(t), 2 + 6.4 * Math.cos(t), 6.4 * Math.sin(t), 3.2] };
  });
  const right: Shape[] = [
    ...petals,
    { dot: [2, 0, 1.4] },
    { stroke: spiral(8.6, 9.6, 5.3, -2.267, 2.2 * Math.PI, 34), from: 1.4, to: 0.7, ball: 1 },
    { stroke: curve([8.2, -0.3], [9.8, -2.6], [11.2, -2.4], [13, -0.6], 12), from: 1.1, to: 0.45 },
    { stroke: curve([-1, -5.4], [-3, -11.5], [-10.5, -13.6], [-17, -9]), from: 1.4, to: 0.5, ball: 0.9 },
    { leaf: [-9.5, 0, -5.6, 4.8, 2] },
  ];
  return {
    a,
    b,
    grow: 'unfurl',
    defs: gilt.defs,
    svg:
      `<g data-part="l" fill="${gilt.fill}">${ornament(a, 1, left, K)}</g>` +
      halves(a, b, 1.5) +
      `<g data-part="r" fill="${gilt.fill}">${ornament(b, -1, right, K)}</g>`,
  };
}

// Two drops and the thread of water between them.
function drop(w: number): LineSpec {
  const a = LINE_GUTTER - 7;
  const b = LINE_GUTTER + w + 7;
  const m = (a + b) / 2;
  // Each half leaves its drop 6px thick and thins to a 1.8px thread.
  const thread = (x: number, dir: number) =>
    `M${x},${CY - 3} C${x + 9 * dir},${CY - 3} ${x + 13 * dir},${CY - 0.9} ${x + 26 * dir},${CY - 0.9} ` +
    `L${m},${CY - 0.9} L${m},${CY + 0.9} L${x + 26 * dir},${CY + 0.9} ` +
    `C${x + 13 * dir},${CY + 0.9} ${x + 9 * dir},${CY + 3} ${x},${CY + 3} Z`;
  return {
    a,
    b,
    grow: 'swell',
    defs: '',
    svg:
      `<path data-part="lh" d="${thread(a, 1)}" fill="currentColor"/>` +
      `<path data-part="rh" d="${thread(b, -1)}" fill="currentColor"/>` +
      `<g data-part="l"><circle cx="${a}" cy="${CY}" r="4" fill="currentColor"/></g>` +
      `<g data-part="r"><circle cx="${b}" cy="${CY}" r="4" fill="currentColor"/></g>`,
  };
}

const STYLES: Record<LineStyle, (w: number) => LineSpec> = { scroll, drop };

/** Pure of the DOM; `width` is the card column's width. */
export function lineSpec(style: LineStyle, width: number): LineSpec {
  return STYLES[style](width);
}

export function buildLine(host: HTMLElement, style: LineStyle, width: number): LineDrawing {
  const spec = lineSpec(style, width);
  const full = width + LINE_GUTTER * 2;
  // Built from numeric constants and generated ids only, never from user text.
  host.innerHTML = `<svg width="${full}" height="${LINE_HEIGHT}" viewBox="0 0 ${full} ${LINE_HEIGHT}" aria-hidden="true">${spec.defs}${spec.svg}</svg>`;
  const part = (name: string) => host.querySelector(`[data-part="${name}"]`)!;
  return { spec, l: part('l'), r: part('r'), lh: part('lh'), rh: part('rh') };
}

export function poseLine(d: LineDrawing, on: number, bead: number): void {
  const { a, b, grow } = d.spec;
  const reach = on * (1 - 0.55 * bead);
  // Numbers are written unrounded: rounding steps a 140px half in visible jumps.
  const about = (x: number, y: number, sx: number, sy: number) =>
    `translate(${x} ${y}) scale(${sx} ${sy}) translate(${-x} ${-y})`;
  d.lh.setAttribute('transform', about(a, CY, reach, 1));
  d.rh.setAttribute('transform', about(b, CY, reach, 1));
  // Drops take back the water the thread gives up; scrollwork opens out.
  const size = grow === 'swell' ? 0.3 + 0.7 * on + 0.2 * bead : 0.45 + 0.55 * on;
  d.l.setAttribute('transform', about(a, CY, size, size));
  d.r.setAttribute('transform', about(b, CY, size, size));
}
