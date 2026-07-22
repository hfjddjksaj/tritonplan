/** Selectors that derive view data from a PlanState + the course pool. */
import {
  type CourseOffering,
  type PlanEntry,
  type PlanState,
  type SectionOption,
  type Term,
  type SelectedCourse,
  type FinalExam,
} from '@triton/shared';
import { hueFromEntryColor } from './colors';
import type { MeetingInstance } from './layout';

export const DEFAULT_TERM: Term = { year: '2026', period: '2', label: 'Fall 2026' };

export function emptyPlan(term: Term = DEFAULT_TERM): PlanState {
  return { version: 1, term, entries: [] };
}

export function findOption(
  course: CourseOffering,
  optionId: string | null,
): SectionOption | undefined {
  if (!optionId) return undefined;
  return course.options.find((o) => o.id === optionId);
}

/** Total units of every added course (a course's units are fixed regardless of option). */
export function planUnits(plan: PlanState): number {
  return plan.entries.reduce((sum, e) => sum + (e.course.units ?? 0), 0);
}

/** The hue chosen for an entry, by its persisted color or its position. */
export function entryHue(plan: PlanState, entry: PlanEntry): number {
  const idx = plan.entries.indexOf(entry);
  return hueFromEntryColor(entry.color, idx < 0 ? 0 : idx);
}

/** Build the SelectedCourse[] the shared conflict engine consumes. Only entries with a chosen option. */
export function buildSelectedCourses(plan: PlanState): SelectedCourse[] {
  const out: SelectedCourse[] = [];
  for (const entry of plan.entries) {
    const option = findOption(entry.course, entry.selectedOptionId);
    if (!option) continue;
    out.push({ courseId: entry.course.id, option, final: option.final });
  }
  return out;
}

/** Flatten chosen options into placeable weekly meeting instances (skips unscheduled/empty). */
export function meetingInstances(plan: PlanState): MeetingInstance[] {
  const out: MeetingInstance[] = [];
  for (const entry of plan.entries) {
    const option = findOption(entry.course, entry.selectedOptionId);
    if (!option) continue;
    const hue = entryHue(plan, entry);
    for (const comp of option.components) {
      if (comp.unscheduled || comp.meetings.length === 0) continue;
      for (const m of comp.meetings) {
        for (const day of m.days) {
          out.push({
            courseId: entry.course.id,
            courseCode: entry.course.courseCode,
            typeText: comp.typeText,
            hue,
            instructor: comp.instructors[0],
            location: locationText(m.building, m.room, m.location),
            start: m.start,
            end: m.end,
            day,
          });
        }
      }
    }
  }
  return out;
}

export interface UnscheduledItem {
  courseId: string;
  courseCode: string;
  typeText: string;
  sectionCode: string;
  hue: number;
}

/** Components of chosen options that have no placeable meeting (TBA/async). */
export function unscheduledItems(plan: PlanState): UnscheduledItem[] {
  const out: UnscheduledItem[] = [];
  for (const entry of plan.entries) {
    const option = findOption(entry.course, entry.selectedOptionId);
    if (!option) continue;
    const hue = entryHue(plan, entry);
    for (const comp of option.components) {
      if (comp.unscheduled || comp.meetings.length === 0) {
        out.push({
          courseId: entry.course.id,
          courseCode: entry.course.courseCode,
          typeText: comp.typeText,
          sectionCode: comp.sectionCode,
          hue,
        });
      }
    }
  }
  return out;
}

export interface FinalItem {
  courseId: string;
  courseCode: string;
  title: string;
  hue: number;
  final: FinalExam;
}

/** Finals of chosen options, sorted by date then start time. */
export function finalsSorted(plan: PlanState): FinalItem[] {
  const out: FinalItem[] = [];
  for (const entry of plan.entries) {
    const option = findOption(entry.course, entry.selectedOptionId);
    if (!option || !option.final) continue;
    out.push({
      courseId: entry.course.id,
      courseCode: entry.course.courseCode,
      title: entry.course.title,
      hue: entryHue(plan, entry),
      final: option.final,
    });
  }
  out.sort((a, b) => {
    if (a.final.date !== b.final.date) return a.final.date < b.final.date ? -1 : 1;
    return a.final.start < b.final.start ? -1 : a.final.start > b.final.start ? 1 : 0;
  });
  return out;
}

/** A short "MWF 9:00–9:50 · Center 214" style summary for an option. */
export function optionSummary(option: SectionOption): string {
  const parts: string[] = [];
  for (const comp of option.components) {
    if (comp.unscheduled || comp.meetings.length === 0) continue;
    for (const m of comp.meetings) {
      parts.push(`${m.days.join('')} ${m.start}–${m.end}`);
    }
  }
  if (parts.length === 0) return 'TBA / no set time';
  return parts.join(' · ');
}

function locationText(
  building?: string,
  room?: string,
  location?: string,
): string | undefined {
  if (building && room) return `${shorten(building)} ${room}`;
  if (location) return location;
  return building ? shorten(building) : undefined;
}

/** Buildings can be long/truncated in source; keep the first few words for a block. */
function shorten(building: string): string {
  const words = building.trim().split(/\s+/);
  if (words.length <= 2) return building;
  // e.g. "Computer Science and Engineering Buildin" -> "Computer Science…"
  return words.slice(0, 2).join(' ') + '…';
}
