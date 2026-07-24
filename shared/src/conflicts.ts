/** Conflict detection over the normalized model — the core value of the planner. */

import type { CourseOffering, FinalExam, Meeting, SectionOption, Weekday } from './types.js';
import { rangesOverlap, toMinutes } from './time.js';

/** Two weekly meetings conflict when they share a weekday and their times overlap. */
export function meetingsConflict(a: Meeting, b: Meeting): boolean {
  const sharedDay = a.days.some((d) => b.days.includes(d));
  if (!sharedDay) return false;
  return rangesOverlap(toMinutes(a.start), toMinutes(a.end), toMinutes(b.start), toMinutes(b.end));
}

/** Two finals conflict when same date and overlapping times. */
export function finalsConflict(a: FinalExam, b: FinalExam): boolean {
  if (a.date !== b.date) return false;
  return rangesOverlap(toMinutes(a.start), toMinutes(a.end), toMinutes(b.start), toMinutes(b.end));
}

/** Flatten a chosen option into its weekly meetings (across all components). */
export function optionMeetings(option: SectionOption): Meeting[] {
  return option.components.flatMap((c) => c.meetings);
}

export interface WeeklyConflict {
  aCourseId: string;
  bCourseId: string;
  day: Weekday;
}

export interface FinalConflict {
  aCourseId: string;
  bCourseId: string;
  date: string;
}

/** A course paired with the option the user selected. */
export interface SelectedCourse {
  courseId: string;
  option: SectionOption;
  final?: FinalExam;
}

/** Every unordered pair (i < j) of the given items. */
function* pairs<T>(items: T[]): Generator<[T, T]> {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      yield [items[i]!, items[j]!];
    }
  }
}

/** All pairwise weekly-meeting conflicts among the selected courses. */
export function findWeeklyConflicts(selected: SelectedCourse[]): WeeklyConflict[] {
  const out: WeeklyConflict[] = [];
  for (const [sa, sb] of pairs(selected)) {
    const ma = optionMeetings(sa.option);
    const mb = optionMeetings(sb.option);
    for (const a of ma) {
      for (const b of mb) {
        if (meetingsConflict(a, b)) {
          const day = a.days.find((d) => b.days.includes(d))!;
          out.push({ aCourseId: sa.courseId, bCourseId: sb.courseId, day });
        }
      }
    }
  }
  return out;
}

/** All pairwise final-exam conflicts among the selected courses. */
export function findFinalConflicts(selected: SelectedCourse[]): FinalConflict[] {
  const out: FinalConflict[] = [];
  for (const [sa, sb] of pairs(selected)) {
    const fa = sa.final;
    const fb = sb.final;
    if (fa && fb && finalsConflict(fa, fb)) {
      out.push({ aCourseId: sa.courseId, bCourseId: sb.courseId, date: fa.date });
    }
  }
  return out;
}

/** Set of courseIds appearing in the given (weekly and/or final) conflicts. */
export function courseIdsInConflicts(
  conflicts: Array<{ aCourseId: string; bCourseId: string }>,
): Set<string> {
  const ids = new Set<string>();
  for (const c of conflicts) {
    ids.add(c.aCourseId);
    ids.add(c.bCourseId);
  }
  return ids;
}

/** Set of courseIds that participate in at least one conflict (weekly or final). */
export function conflictedCourseIds(selected: SelectedCourse[]): Set<string> {
  return courseIdsInConflicts([...findWeeklyConflicts(selected), ...findFinalConflicts(selected)]);
}
