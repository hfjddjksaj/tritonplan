/**
 * The plan a signed-out visitor is shown before signing in, built only from what
 * the extension brought this page load. Nothing here is saved: the clicks stay
 * queued in the bridge hub and reach the real plan once the planner mounts.
 */
import type { CourseOffering, PlanEntry, PlanState, Term } from '@triton/shared';
import type { BridgeSeen } from './bridge';
import { isArchived, termKey } from './terms';

export interface Preview {
  term: Term;
  /** The "+ TritonPlan" clicks in that term, the last choice per course. */
  plan: PlanState;
  /** That term's other captured courses, by course code. */
  browsed: CourseOffering[];
}

/**
 * The term the planner would land on: the latest click's, else the term TSS
 * captured last (as a capture switches the planner there). Archived terms are
 * left out, as the planner leaves them out. Null when there is nothing to show.
 */
export function previewOf({ courses, adds }: BridgeSeen, now: Date): Preview | null {
  const liveAdds = adds.filter((a) => !isArchived(a.course.term, now));
  const liveCourses = courses.filter((c) => !isArchived(c.term, now));
  const lastAdd = liveAdds[liveAdds.length - 1];
  const freshest = liveCourses.reduce<CourseOffering | undefined>(
    (best, c) => (best === undefined || (c.capturedAt ?? '') > (best.capturedAt ?? '') ? c : best),
    undefined,
  );
  const term = lastAdd?.course.term ?? freshest?.term;
  if (!term) return null;
  const key = termKey(term);
  const picked = new Map<string, PlanEntry>();
  for (const a of liveAdds) {
    if (termKey(a.course.term) !== key) continue;
    picked.delete(a.course.id); // a later click on the same course moves it to the end
    picked.set(a.course.id, { course: a.course, selectedOptionId: a.selectedOptionId });
  }
  const browsed = liveCourses
    .filter((c) => termKey(c.term) === key && !picked.has(c.id))
    .sort((a, b) => a.courseCode.localeCompare(b.courseCode));
  return { term, plan: { version: 1, term, entries: [...picked.values()] }, browsed };
}
