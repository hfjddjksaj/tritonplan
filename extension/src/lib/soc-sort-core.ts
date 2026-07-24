/**
 * Natural course-code ordering for the TSS Schedule of Classes list.
 *
 * TSS serves the course list sorted by an internal key (ModuleID-ish), so
 * CHEM-130 renders above CHEM-040A and courses look missing. Its View Settings
 * offer no "sort by course" either (verified live 2026-07-24). These helpers
 * turn row text into a sortable key: department, then numeric part, then
 * letter suffix — 040A < 040AH < 040B < 041A < 130 < 143B.
 *
 * Pure logic, no DOM — the soc-sort content script owns the row shuffling.
 */

export interface CourseKey {
  dept: string;   // "CHEM"
  num: number;    // 40
  suffix: string; // "A", "AH", "" …
}

const CODE_RE = /\b([A-Z]{2,6})-(\d{1,4})([A-Z]{0,3})\b/;

/** First course-code-looking token in a row's text, or null. */
export function courseKeyFromText(text: string): CourseKey | null {
  const m = CODE_RE.exec(text);
  if (!m) return null;
  return { dept: m[1]!, num: parseInt(m[2]!, 10), suffix: m[3] ?? '' };
}

export function compareCourseKeys(a: CourseKey, b: CourseKey): number {
  return a.dept.localeCompare(b.dept) || a.num - b.num || a.suffix.localeCompare(b.suffix);
}

/**
 * Target order for a list of units (one unit = one course row + its popin rows),
 * as indices into the input. Unkeyed units sink to the end; ties keep their
 * original relative order (stable). Returns null when there's nothing to sort
 * (fewer than two keyed units) — the caller should leave the DOM alone.
 */
export function sortedUnitOrder(keys: ReadonlyArray<CourseKey | null>): number[] | null {
  const keyed = keys.filter((k) => k !== null).length;
  if (keyed < 2) return null;
  return keys
    .map((key, i) => ({ key, i }))
    .sort((a, b) => {
      if (a.key === null && b.key === null) return a.i - b.i;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      return compareCourseKeys(a.key, b.key) || a.i - b.i;
    })
    .map((e) => e.i);
}

/** True when `order` is the identity permutation (no move needed). */
export function isIdentityOrder(order: ReadonlyArray<number>): boolean {
  return order.every((v, i) => v === i);
}
