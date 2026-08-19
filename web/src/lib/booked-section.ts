/**
 * "Is my plan on the section I actually booked?"
 *
 * TSS answers this in two halves that only meet here. The booked feed names the
 * COURSE and nothing finer — its 15 fields carry no section, package or enroll code
 * (verified against the live `$metadata`, 2026-08-11). The student's timetable feed
 * names the EVENTS they are enrolled in, and an event is exactly what a section
 * component is: `Component.id` "E 00001078" is timetable `EventId` "00001078", the
 * same object with a type prefix (verified on a live account, 2026-08-19 — the
 * lecture ids of two of their courses matched their booked packages exactly).
 *
 * So: intersect the enrolled events with the ones this course knows about, and see
 * which package holds precisely that set.
 *
 * SILENCE IS THE DEFAULT. This drives a warning on a student's own plan, so it
 * speaks only when it can point at one specific package and say "that one, not the
 * one you have". Ambiguity, missing data, an unfamiliar id — all mean say nothing.
 * A false alarm here would send someone back to TSS to fix a booking that was
 * already right.
 */
import type { CourseOffering, SectionOption } from '@triton/shared';

/** Compare TSS event ids by digits: "E 00001078" and "00001078" are one event. */
function eventKey(id: string): string | null {
  const digits = id.replace(/\D/g, '').replace(/^0+(?=.)/, '');
  return digits === '' ? null : digits;
}

function keysOf(ids: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const k = eventKey(id);
    if (k !== null) out.add(k);
  }
  return out;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * The option this course was booked on, or null when it can't be pinned down.
 *
 * Null covers every uncertain case on purpose: no timetable capture, no overlap with
 * this course's events (a component we never captured), or two packages that fit the
 * same events — which really happens, since several packages share one lecture.
 */
export function bookedOptionOf(
  course: CourseOffering,
  enrolledEventIds: readonly string[] | undefined,
): SectionOption | null {
  if (!enrolledEventIds || enrolledEventIds.length === 0) return null;
  const enrolled = keysOf(enrolledEventIds);
  const known = new Set<string>();
  for (const o of course.options) for (const k of keysOf(o.components.map((c) => c.id))) known.add(k);

  // Only events this course knows about can identify one of ITS packages. The feed is
  // the student's whole timetable, every course of it.
  const target = new Set([...enrolled].filter((k) => known.has(k)));
  if (target.size === 0) return null;

  const matches = course.options.filter((o) => sameSet(keysOf(o.components.map((c) => c.id)), target));
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * The booked option when it is NOT the one selected in the plan — the only case worth
 * a word on screen. Returns null when they agree, or when either is unknown.
 */
export function bookedElsewhere(
  course: CourseOffering,
  selectedOptionId: string | null,
  enrolledEventIds: readonly string[] | undefined,
): SectionOption | null {
  const booked = bookedOptionOf(course, enrolledEventIds);
  if (booked === null || selectedOptionId === null) return null;
  return booked.id === selectedOptionId ? null : booked;
}
