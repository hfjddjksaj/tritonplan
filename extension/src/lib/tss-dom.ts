/**
 * PURE logic for the TSS "+ TritonPlan" injection — no DOM, no chrome.* here, so it
 * is unit-testable. The actual DOM scanning/injection (with the best-effort selectors)
 * lives in content/tss-inject.ts and calls into this module.
 *
 * Two jobs:
 *   1. extractModuleRef(): read AcademicYear/AcademicPeriod/ModuleID from the TSS hash URL.
 *   2. resolveOption(): map a rendered booking card (its enroll code / package label)
 *      back to the exact SectionOption in our captured CourseOffering.
 */

import type { CourseOffering, SectionOption } from '@triton/shared';

export interface ModuleRef {
  academicYear: string;
  academicPeriod: string;
  moduleId: string;
}

/**
 * Extract the open course's module reference from the TSS Fiori hash/URL, e.g.
 *   ...#YSchedule-view?...YUCSD_CON_MODULE(AcademicYear='2026',AcademicPeriod='2',ModuleID='8461')...
 * Order-independent (matches each key separately). Returns null if ModuleID is absent.
 */
export function extractModuleRef(hashOrUrl: string): ModuleRef | null {
  if (!hashOrUrl) return null;
  const moduleId = matchKey(hashOrUrl, 'ModuleID');
  if (!moduleId) return null;
  return {
    moduleId,
    academicYear: matchKey(hashOrUrl, 'AcademicYear') ?? '',
    academicPeriod: matchKey(hashOrUrl, 'AcademicPeriod') ?? '',
  };
}

/** Match `Key='value'` or `Key=value` (URL/hash encoded variants of the quote tolerated). */
function matchKey(s: string, key: string): string | null {
  // e.g. ModuleID='8461'  |  ModuleID=%278461%27  |  ModuleID=8461
  const re = new RegExp(`${key}=(?:'|%27)?([^'&,)%]+)`, 'i');
  const m = s.match(re);
  return m?.[1] ?? null;
}

/**
 * Parse a booking-card header label like "CSE-008A (P-001-001)".
 * Returns the courseCode and the parenthetical package code, either possibly undefined.
 */
export function parsePackageLabel(text: string | null | undefined): {
  courseCode?: string;
  packageCode?: string;
} {
  if (!text) return {};
  const m = text.match(/([A-Za-z]+-?\w+)\s*\(([^)]+)\)/);
  if (m) return { courseCode: m[1], packageCode: m[2]!.trim() };
  return {};
}

/**
 * Pull the TSS enroll/booking code (e.g. "SE00154302") out of arbitrary card text.
 * The code is "SE" + digits in captured data; tolerate other 2-letter prefixes too.
 */
export function parseEnrollCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\b([A-Z]{2}\d{6,})\b/);
  return m?.[1] ?? null;
}

/** Find the captured CourseOffering for a given TSS ModuleID. */
export function findCourseByModuleId(
  courses: readonly CourseOffering[],
  moduleId: string,
): CourseOffering | null {
  if (!moduleId) return null;
  for (const c of courses) if (c.moduleId === moduleId) return c;
  return null;
}

export interface DisplayedCard {
  /** The "SE..." enroll code shown on the card (best match key). */
  enrollCode?: string | null;
  /** The "P-001-001" package code parsed from the header label. */
  packageCode?: string | null;
}

/**
 * Resolve which SectionOption a rendered card corresponds to.
 * Preference order (most specific first):
 *   1. enroll code === option.enrollCode  (EventPkgDisplayID)
 *   2. enroll code === option.id          (EventPkgOtjid; equal to displayId in captured data)
 *   3. package code === option.code       ("P-001-001")
 * Returns null if nothing matches (caller degrades gracefully).
 */
export function resolveOption(
  course: CourseOffering,
  card: DisplayedCard,
): SectionOption | null {
  const ec = card.enrollCode?.trim();
  const pc = card.packageCode?.trim();
  if (ec) {
    for (const o of course.options) if (o.enrollCode === ec) return o;
    for (const o of course.options) if (o.id === ec) return o;
  }
  if (pc) {
    for (const o of course.options) if (o.code === pc) return o;
  }
  return null;
}
