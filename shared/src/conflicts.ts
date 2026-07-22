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

/** All pairwise weekly-meeting conflicts among the selected courses. */
export function findWeeklyConflicts(selected: SelectedCourse[]): WeeklyConflict[] {
  const out: WeeklyConflict[] = [];
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      const ma = optionMeetings(selected[i].option);
      const mb = optionMeetings(selected[j].option);
      for (const a of ma) {
        for (const b of mb) {
          if (meetingsConflict(a, b)) {
            const day = a.days.find((d) => b.days.includes(d))!;
            out.push({ aCourseId: selected[i].courseId, bCourseId: selected[j].courseId, day });
          }
        }
      }
    }
  }
  return out;
}

/** All pairwise final-exam conflicts among the selected courses. */
export function findFinalConflicts(selected: SelectedCourse[]): FinalConflict[] {
  const out: FinalConflict[] = [];
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      const fa = selected[i].final;
      const fb = selected[j].final;
      if (fa && fb && finalsConflict(fa, fb)) {
        out.push({ aCourseId: selected[i].courseId, bCourseId: selected[j].courseId, date: fa.date });
      }
    }
  }
  return out;
}

/** Set of courseIds that participate in at least one conflict (weekly or final). */
export function conflictedCourseIds(selected: SelectedCourse[]): Set<string> {
  const ids = new Set<string>();
  for (const c of [...findWeeklyConflicts(selected), ...findFinalConflicts(selected)]) {
    ids.add(c.aCourseId);
    ids.add(c.bCourseId);
  }
  return ids;
}
