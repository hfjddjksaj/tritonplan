import { expect, test } from 'vitest';
import { applySelection, SHARED_PLAN_TTL_MS } from './shared-plan';
import type { CourseOffering, PlanState } from './types';

function course(id: string, optionIds: string[]): CourseOffering {
  return {
    id, moduleId: id, subject: 'CSE', number: id, courseCode: `CSE-${id}`, title: id,
    term: { year: '2026', period: '010', label: 'Winter 2026' },
    options: optionIds.map((o) => ({ id: o, label: o, components: [] })),
  } as unknown as CourseOffering;
}

function plan(): PlanState {
  return {
    version: 1,
    term: { year: '2026', period: '010', label: 'Winter 2026' },
    entries: [
      { course: course('a', ['a1', 'a2']), selectedOptionId: 'a1' },
      { course: course('b', ['b1', 'b2']), selectedOptionId: null },
    ],
  };
}

test('ttl is exactly seven days', () => {
  expect(SHARED_PLAN_TTL_MS).toBe(7 * 24 * 3_600_000);
});

test('applySelection switches only the named entry', () => {
  const next = applySelection(plan(), 'b', 'b2')!;
  expect(next.entries.map((e) => e.selectedOptionId)).toEqual(['a1', 'b2']);
});

test('applySelection returns null for an unknown course or option', () => {
  expect(applySelection(plan(), 'zzz', 'a1')).toBeNull();
  expect(applySelection(plan(), 'a', 'b1')).toBeNull();
});

test('applySelection never mutates its input', () => {
  const p = plan();
  const clone = structuredClone(p);
  applySelection(p, 'a', 'a2');
  expect(p).toEqual(clone);
});
