import { describe, expect, it } from 'vitest';
import type { CourseOffering, Term } from '@triton/shared';
import { makeCourse } from './fixtures';
import { previewOf } from './preview';

const NOW = new Date('2026-10-28T12:00:00Z');
const FALL: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WINTER: Term = { year: '2027', period: '3', label: 'Winter 2027' };
const SPRING_25: Term = { year: '2025', period: '2', label: 'Fall 2025' }; // long over: archived

function course(code: string, term: Term = FALL, capturedAt = '2026-10-20T00:00:00Z'): CourseOffering {
  return { ...makeCourse(`${code}|${term.year}|${term.period}`, code), term, capturedAt };
}
const add = (c: CourseOffering, i = 0) => ({ course: c, selectedOptionId: c.options[i]!.id });

describe('previewOf', () => {
  it('nothing from the extension → nothing to preview', () => {
    expect(previewOf({ courses: [], adds: [] }, NOW)).toBeNull();
  });

  it('the clicks fill the plan; the rest of that term is listed as browsed, by code', () => {
    const cse = course('CSE-100');
    const math = course('MATH-18');
    const bild = course('BILD-1');
    const p = previewOf({ courses: [math, cse, bild], adds: [add(cse)] }, NOW)!;
    expect(p.term).toEqual(FALL);
    expect(p.plan).toEqual({ version: 1, term: FALL, entries: [{ course: cse, selectedOptionId: cse.options[0]!.id }] });
    expect(p.browsed.map((c) => c.courseCode)).toEqual(['BILD-1', 'MATH-18']);
  });

  it('the latest click picks the term, and a course clicked twice keeps its last section', () => {
    const fallCse = course('CSE-100');
    const winterMath = course('MATH-20A', WINTER);
    const twice = { ...winterMath, options: [...winterMath.options, { ...winterMath.options[0]!, id: 'second-opt' }] };
    const p = previewOf(
      { courses: [fallCse, winterMath], adds: [add(twice), add(fallCse), add(twice, 1)] },
      NOW,
    )!;
    expect(p.term).toEqual(WINTER);
    expect(p.plan.entries).toEqual([{ course: twice, selectedOptionId: 'second-opt' }]);
    expect(p.browsed).toEqual([]);
  });

  it('with no clicks, the term TSS captured last', () => {
    const p = previewOf(
      { courses: [course('CSE-100', FALL, '2026-10-20T00:00:00Z'), course('MATH-20A', WINTER, '2026-10-27T00:00:00Z')], adds: [] },
      NOW,
    )!;
    expect(p.term).toEqual(WINTER);
    expect(p.plan.entries).toEqual([]);
    expect(p.browsed.map((c) => c.courseCode)).toEqual(['MATH-20A']);
  });

  it('archived terms are left out, as in the planner', () => {
    const old = course('CSE-8A', SPRING_25, '2026-10-27T00:00:00Z');
    expect(previewOf({ courses: [old], adds: [add(old)] }, NOW)).toBeNull();
    const p = previewOf({ courses: [old, course('CSE-100')], adds: [add(old)] }, NOW)!;
    expect(p.term).toEqual(FALL);
  });
});
