import { describe, it, expect } from 'vitest';
import type { CourseOffering } from '@triton/shared';
import { refreshPlanEntries } from './plan';
import { makeCourse, makePlan } from './fixtures';

/** A re-captured copy of `course` with new seat counts (and optionally new option ids). */
function recaptured(course: CourseOffering, seats: number, optionId?: string): CourseOffering {
  return {
    ...course,
    capturedAt: '2026-07-24T10:00:00.000Z',
    options: course.options.map((o) => ({
      ...o,
      id: optionId ?? o.id,
      seatsAvailable: seats,
      limit: 100,
    })),
  };
}

describe('refreshPlanEntries', () => {
  it('replaces an entry’s frozen course with the fresh copy, keeping the selection', () => {
    const plan = makePlan();
    const fresh = recaptured(plan.entries[0]!.course, 3);
    const next = refreshPlanEntries(plan, [fresh]);
    expect(next.entries[0]!.course.options[0]!.seatsAvailable).toBe(3);
    expect(next.entries[0]!.course.capturedAt).toBe('2026-07-24T10:00:00.000Z');
    expect(next.entries[0]!.selectedOptionId).toBe(plan.entries[0]!.selectedOptionId);
  });

  it('falls back to the first option when the selected one vanished from fresh data', () => {
    const plan = makePlan();
    const fresh = recaptured(plan.entries[0]!.course, 5, 'brand-new-opt');
    const next = refreshPlanEntries(plan, [fresh]);
    expect(next.entries[0]!.selectedOptionId).toBe('brand-new-opt');
  });

  it('returns the same plan object when no incoming course matches an entry', () => {
    const plan = makePlan();
    const unrelated = makeCourse('MATH-20A|2026|2', 'MATH-20A');
    expect(refreshPlanEntries(plan, [unrelated])).toBe(plan);
    expect(refreshPlanEntries(plan, [])).toBe(plan);
  });

  it('leaves non-matching entries untouched while refreshing matching ones', () => {
    const plan = makePlan();
    const other = makeCourse('MATH-20A|2026|2', 'MATH-20A');
    plan.entries.push({ course: other, selectedOptionId: other.options[0]!.id, color: '12' });
    const fresh = recaptured(plan.entries[0]!.course, 7);
    const next = refreshPlanEntries(plan, [fresh]);
    expect(next.entries[0]!.course.options[0]!.seatsAvailable).toBe(7);
    expect(next.entries[1]!).toBe(plan.entries[1]!);
  });
});
