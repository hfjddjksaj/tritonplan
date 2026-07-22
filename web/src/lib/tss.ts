/** Deep links back into the Triton Student System (TSS) for a given course. */
import type { CourseOffering, SectionOption } from '@triton/shared';
import { postOpenBooking, postOpenTss } from './bridge';

/**
 * Build a TSS Fiori deep link to a course module's schedule view.
 *
 * NOTE: SAP Fiori normally also carries a per-session `sap-iapp-state` token in the
 * hash. It is intentionally omitted here — it's session-scoped and can't be known
 * ahead of time. This link therefore needs live verification against a logged-in
 * TSS session; SAP may redirect to the app shell before resolving the module.
 */
export function tssDeepLink(course: CourseOffering): string {
  const { year, period } = course.term;
  return (
    'https://tss.ucsd.edu/fiori#YSchedule-view?sap-app-origin-hint=&/YUCSD_CON_MODULE(' +
    `AcademicYear='${year}',AcademicPeriod='${period}',ModuleID='${course.moduleId}')`
  );
}

/**
 * Open a course back in TSS. When the extension's bridge is present (`viaExtension`),
 * the request is routed through it so an already-open TSS tab is focused/reused
 * instead of spawning a fresh tab every click. Without the extension, fall back to
 * a plain new tab (no opener for safety).
 */
export function openInTss(course: CourseOffering, viaExtension = false): void {
  const url = tssDeepLink(course);
  if (viaExtension) postOpenTss(url, course.moduleId);
  else window.open(url, '_blank', 'noopener');
}

/** Numeric part of an EventPackage code like "SE00152185" → "152185". */
function pkgNumber(code: string | undefined): string | null {
  if (!code) return null;
  const m = code.match(/^[A-Z]{2}0*(\d+)$/);
  return m ? m[1]! : null;
}

/**
 * Deep link to a section's booking page — the target of TSS's own "Go To Booking"
 * button. Reverse-engineered from live URLs (2026-07-22): only the course ModuleID
 * and the EventPackage number vary; the middle segments are constant placeholders.
 * Returns null when the option's package number can't be derived.
 */
export function tssBookingLink(course: CourseOffering, option: SectionOption): string | null {
  const num = pkgNumber(option.enrollCode) ?? pkgNumber(option.id);
  if (!num) return null;
  const { year, period } = course.term;
  return (
    'https://tss.ucsd.edu/fiori#ZUSModule-display?TileType=MYMOD&/Detail/EventPackage/SM/' +
    `${course.moduleId}/00000000/0/0/0/00000000-0000-0000-0000-000000000000/${num}/${year}/${period}/?`
  );
}

/**
 * Open a section's booking page. Like TSS itself, booking lives in its own tab;
 * via the extension, repeat bookings reuse that one tab instead of piling up.
 * Returns false when no booking link could be built (button should be hidden).
 */
export function openBooking(
  course: CourseOffering,
  option: SectionOption,
  viaExtension = false,
): boolean {
  const url = tssBookingLink(course, option);
  if (!url) return false;
  if (viaExtension) postOpenBooking(url);
  else window.open(url, '_blank', 'noopener');
  return true;
}
