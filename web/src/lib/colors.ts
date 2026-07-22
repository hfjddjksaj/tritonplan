/** Per-course color assignment. A course keeps one hue; every visual for it derives from that hue. */

/** 8 hues tuned to sit at a consistent lightness/chroma on the cool canvas. */
export const COURSE_HUES = [231, 187, 340, 38, 265, 152, 199, 16] as const;

export interface CourseColors {
  /** saturated left spine + accent text */
  spine: string;
  /** very light tinted block/card fill */
  fill: string;
  /** hairline border */
  border: string;
  /** readable hue-dark text on the fill */
  text: string;
}

export function colorsForHue(h: number): CourseColors {
  return {
    spine: `hsl(${h} 72% 45%)`,
    fill: `hsl(${h} 68% 96.5%)`,
    border: `hsl(${h} 52% 85%)`,
    text: `hsl(${h} 62% 29%)`,
  };
}

/** Pick a hue for the Nth added course, cycling through the palette. */
export function pickHue(index: number): number {
  return COURSE_HUES[index % COURSE_HUES.length]!;
}

/** Parse a stored `PlanEntry.color`. We persist the hue as a string; fall back to a hue by index. */
export function hueFromEntryColor(color: string | undefined, fallbackIndex: number): number {
  if (color) {
    const n = Number(color);
    if (Number.isFinite(n)) return n;
  }
  return pickHue(fallbackIndex);
}
