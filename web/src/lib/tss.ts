/** Deep links back into the Triton Student System (TSS) for a given course. */
import type { CourseOffering } from '@triton/shared';

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

/** Open a course back in TSS in a new tab (no opener for safety). */
export function openInTss(course: CourseOffering): void {
  window.open(tssDeepLink(course), '_blank', 'noopener');
}
