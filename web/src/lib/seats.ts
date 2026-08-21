/**
 * "Has this section run out of seats?" — one rule, read by the section list,
 * the course card and every calendar block.
 *
 * Seat counts are snapshots of the last TSS browse (see `capturedAt`); this
 * module only interprets what was captured, it never fetches.
 */
import type { CourseOffering, SectionOption } from '@triton/shared';

/**
 * A section whose known seat count has run out.
 *
 * An unknown count (`seatsAvailable === undefined`, e.g. older captures) is
 * NOT full — showing "no seats left" for data we never had would be a claim
 * the user acts on.
 */
export function optionFull(option: SectionOption): boolean {
  return option.seatsAvailable !== undefined && option.seatsAvailable <= 0;
}

/**
 * TSS will only let the student join this package's waitlist — a state that has
 * nothing to do with seats. A "Waitlist Only" package can show `Available: 5`
 * and still refuse to enroll anyone (13 of CHEM-043A's 21 packages, 2026-08-10),
 * so `optionFull` can never stand in for it.
 *
 * Matched against the one wording seen live (`EventPkgStatusText: "Waitlist Only"`,
 * carried through as `SectionOption.status`), case and padding aside. A near-miss
 * like "Waitlist Closed" would mean the opposite, and marking a section the student
 * could actually take costs them the section — so unverified wordings earn nothing.
 */
export function optionWaitlistOnly(option: SectionOption): boolean {
  return /^waitlist\s+only$/i.test(option.status?.trim() ?? '');
}

/**
 * Every one of this course's sections is full. A course with no sections, or
 * with any section whose seat count is unknown, is not full — conservative on
 * purpose, for the same reason as above.
 */
export function courseFull(course: CourseOffering): boolean {
  return course.options.length > 0 && course.options.every(optionFull);
}
