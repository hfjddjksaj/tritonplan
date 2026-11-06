import type { PlanState } from './types.js';

export const SHARED_PLAN_TTL_MS = 7 * 24 * 3_600_000;

/** The only edit a shared plan allows: pick another section option that the course already offers. */
export function applySelection(plan: PlanState, courseId: string, optionId: string): PlanState | null {
  const entry = plan.entries.find((e) => e.course.id === courseId);
  if (!entry || !entry.course.options.some((o) => o.id === optionId)) return null;
  return {
    ...plan,
    entries: plan.entries.map((e) => (e === entry ? { ...e, selectedOptionId: optionId } : e)),
  };
}
