/** Deep links back into the Triton Student System (TSS) for a given course. */
import type { CourseOffering, SectionOption } from '@triton/shared';
import { postOpenBooking, postOpenTss, postOpenTssHome } from './bridge';

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

/** The "My Appointment Times" Fiori app (hash route verified live 2026-07-25). */
export const TSS_APPT_TIMES_URL = 'https://tss.ucsd.edu/fiori#YStudent-apptTimes';

/** Open the My Appointment Times app in TSS — the page the extension passively
 *  captures enrollment windows from. Plain new tab (one-off page, no reuse). */
export function openApptTimesInTss(): void {
  window.open(TSS_APPT_TIMES_URL, '_blank', 'noopener');
}

/** The TSS launchpad home page (OVP app `yucsd.ovp.student`, verified 2026-08-11). */
export const TSS_HOME_URL = 'https://tss.ucsd.edu/fiori#YStudent-Overview';

/**
 * Check the student's bookings: put them on the TSS home page. Its "Booked Courses"
 * card is the ONLY place TSS states which modules a student is enrolled in, and it
 * fetches that feed on a full page load only — a course deep link (tssDeepLink) never
 * brings booked status back with it, verified live 2026-08-18. This is the one action
 * that does, which is why the planner offers it as its own button.
 *
 * Through the extension when present, so a TSS tab already on the home page is reused
 * and reloaded instead of a new tab per check; a plain new tab otherwise.
 *
 * ⛔ NO-BAN: navigation the student asked for by clicking, no different from typing
 * the URL. The page then fetches its own data; nothing of ours is replayed.
 */
export function openTssHome(viaExtension = false): void {
  if (viaExtension) postOpenTssHome(TSS_HOME_URL);
  else window.open(TSS_HOME_URL, '_blank', 'noopener');
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
