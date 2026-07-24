/** Selectors that derive view data from a PlanState + the course pool. */
import {
  type CourseOffering,
  type FinalConflict,
  type PlanEntry,
  type PlanState,
  type SectionOption,
  type Term,
  type SelectedCourse,
  type FinalExam,
  type Weekday,
  type WeeklyConflict,
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

/**
 * Refresh each plan entry's course copy from freshly-pushed capture data — entries
 * otherwise keep the snapshot frozen at add time, so seat counts never update.
 * The selection is kept when that option still exists in the fresh data; if TSS no
 * longer offers it, fall back to the first option. Returns `prev` unchanged when no
 * incoming course matches an entry.
 */
export function refreshPlanEntries(prev: PlanState, incoming: CourseOffering[]): PlanState {
  if (prev.entries.length === 0 || incoming.length === 0) return prev;
  const byId = new Map(incoming.map((c) => [c.id, c]));
  let changed = false;
  const entries = prev.entries.map((e) => {
    const fresh = byId.get(e.course.id);
    if (!fresh) return e;
    changed = true;
    const keep = e.selectedOptionId !== null && findOption(fresh, e.selectedOptionId) !== undefined;
    const selectedOptionId = keep ? e.selectedOptionId : (fresh.options[0]?.id ?? null);
    return { ...e, course: fresh, selectedOptionId };
  });
  return changed ? { ...prev, entries } : prev;
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
            building: m.building,
            room: m.room,
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

/** Canonical unordered key for the two courses of a conflict, for pair-level dedup. */
export function conflictPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Number of distinct conflicting course pairs across weekly + final conflicts. */
export function countConflictPairs(weekly: WeeklyConflict[], finals: FinalConflict[]): number {
  const keys = new Set<string>();
  for (const c of weekly) keys.add(conflictPairKey(c.aCourseId, c.bCourseId));
  for (const c of finals) keys.add(conflictPairKey(c.aCourseId, c.bCourseId));
  return keys.size;
}

/** Compact day codes, the same notation TSS itself prints ("MW", "TuTh"). */
const DAY_ABBR: Record<Weekday, string> = {
  Mon: 'M',
  Tue: 'Tu',
  Wed: 'W',
  Thu: 'Th',
  Fri: 'F',
  Sat: 'Sa',
  Sun: 'Su',
};

/** Three-letter display tags for TSS TeachingMethod codes. */
const TYPE_TAG: Record<string, string> = {
  LE: 'LEC',
  DI: 'DIS',
  LA: 'LAB',
  SE: 'SEM',
  ST: 'STU',
  IN: 'IND',
  FI: 'FIN',
  OT: 'OTH',
};

/** One schedule fragment of an option, tagged with its component type. */
export interface OptionSummaryPart {
  /** Component type tag shown before the times, e.g. "LEC" / "DIS" / "LAB". */
  type: string;
  /** Compact meeting time, e.g. "MW 12:00–12:50". */
  time: string;
}

/**
 * Path-2 standby switch (see PROGRESS.md 2026-07-24): TSS fills schedules in
 * gradually (ETHN-001R's async lecture later gained times), so undefined
 * components are shown as-is — type tag + "undefined" — and refresh with the
 * data. If "Other" components (CHEM-043A's "Other / Schedule Not Defined" rows)
 * turn out to be noise TSS never schedules, flip this to true to hide them
 * from section summaries entirely.
 */
const HIDE_OTHER_COMPONENTS = false;

function isOtherComponent(comp: SectionOption['components'][number]): boolean {
  return comp.type?.trim() === 'OT' || comp.typeText?.trim() === 'Other';
}

/**
 * One compact schedule fragment per meeting, e.g.
 * [{type:'LEC', time:'TuTh 11:00–12:20'}, {type:'DIS', time:'F 08:00–08:50'}].
 * Components TSS lists without a schedule yet contribute {type, time:'undefined'}.
 * Kept as separate parts so the UI can wrap between meetings but never inside one.
 */
export function optionSummaryParts(
  option: SectionOption,
  hideOther: boolean = HIDE_OTHER_COMPONENTS,
): OptionSummaryPart[] {
  const parts: OptionSummaryPart[] = [];
  for (const comp of option.components) {
    if (hideOther && isOtherComponent(comp)) continue;
    const code = comp.type?.trim() ?? '';
    const type = TYPE_TAG[code] ?? (comp.typeText?.slice(0, 3).toUpperCase() || code);
    // "Schedule Not Defined" in TSS — say so honestly; TSS fills these in over time
    // and the next capture refresh will replace this with real times.
    if (comp.unscheduled || comp.meetings.length === 0) {
      parts.push({ type, time: 'undefined' });
      continue;
    }
    for (const m of comp.meetings) {
      // Day-less meetings are phantom rows (pre-0.2.1 extensions parsed dated exam
      // lines like "Midterm Examination 10/31/2026 …" into these) — not placeable, not shown.
      if (m.days.length === 0) continue;
      parts.push({ type, time: `${m.days.map((d) => DAY_ABBR[d]).join('')} ${m.start}–${m.end}` });
    }
  }
  return parts;
}

/** Full location text — the calendar block's CSS ellipsizes only when space runs out. */
function locationText(
  building?: string,
  room?: string,
  location?: string,
): string | undefined {
  if (building && room) return `${building} ${room}`;
  if (location) return location;
  return building;
}
