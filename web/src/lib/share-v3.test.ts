import { describe, expect, it } from 'vitest';
import type { CourseOffering, PlanState, Weekday } from '@triton/shared';
import { V3_PREFIX, decodePlanV3, encodePlanV3 } from './share-v3';

/** Realistic course: 1 shared lecture + per-option discussion, prereqs, capturedAt. */
function makeCourse(seed: number, nOpts: number): CourseOffering {
  const code = `TEST-${100 + seed}`;
  const lecture = {
    id: `E 0000${1000 + seed}`,
    type: 'LE',
    typeText: 'Lecture',
    sectionCode: '001-000',
    instructors: ['Joshua Figueroa'],
    meetings: [
      {
        days: ['Mon', 'Wed', 'Fri'] as Weekday[],
        start: '09:00',
        end: '09:50',
        modality: 'In Person',
        building: 'York Hall',
        room: '2622',
        location: 'York Hall Room 2622',
      },
    ],
    unscheduled: false,
    rawSched: 'M, W, F 09:00 AM - 09:50 AM In Person @ York Hall Room 2622',
  };
  return {
    id: `${code}|2026|2`,
    moduleId: String(2000 + seed),
    subject: 'TEST',
    number: String(100 + seed),
    courseCode: code,
    title: `Test Course ${seed}`,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    units: 4,
    capturedAt: '2026-07-24T10:00:00.000Z',
    prereqs: [{ label: '1 of the following:', options: ['TEST-001 - Intro with a D or higher'] }],
    options: Array.from({ length: nOpts }, (_, i) => ({
      id: `SE00${152000 + seed * 100 + i}`,
      code: `P-001-00${i + 1}`,
      enrollCode: `SE00${152000 + seed * 100 + i}`,
      limit: 16 + i,
      seatsAvailable: (i * 3) % 17,
      final: { date: '2026-12-07', start: '08:00', end: '10:59', modality: 'In Person' },
      components: [
        structuredClone(lecture),
        {
          id: `E 0000${2000 + seed * 10 + i}`,
          type: 'DI',
          typeText: 'Discussion',
          sectionCode: `001-0${20 + i}`,
          instructors: ['Joshua Figueroa'],
          meetings: [
            {
              days: [i % 2 ? 'Tue' : 'Thu'] as Weekday[],
              start: `${10 + (i % 7)}:00`.padStart(5, '0'),
              end: `${10 + (i % 7)}:50`.padStart(5, '0'),
              modality: 'In Person',
              building: 'Center Hall',
              room: '119',
              location: 'Center Hall Room 119',
            },
          ],
          unscheduled: false,
          rawSched: 'x',
        },
      ],
    })),
  } as CourseOffering;
}

function makePlan(nCourses: number, nOpts: number): PlanState {
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: Array.from({ length: nCourses }, (_, i) => {
      const course = makeCourse(i, nOpts);
      return { course, selectedOptionId: course.options[1]?.id ?? course.options[0]!.id, color: String(140 + i) };
    }),
  };
}

describe('encodePlanV3 / decodePlanV3', () => {
  it('round-trips ALL section options, selection, prereqs and capturedAt', () => {
    const plan = makePlan(3, 5);
    const token = encodePlanV3(plan);
    expect(token.startsWith(V3_PREFIX)).toBe(true);
    const back = decodePlanV3(token);
    expect(back).not.toBeNull();
    expect(back!.entries).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const src = plan.entries[i]!;
      const dst = back!.entries[i]!;
      expect(dst.course.options).toHaveLength(5); // full fidelity: every option survives
      expect(dst.selectedOptionId).toBe(src.selectedOptionId);
      expect(dst.color).toBe(src.color);
      expect(dst.course.courseCode).toBe(src.course.courseCode);
      expect(dst.course.units).toBe(4);
      expect(dst.course.capturedAt).toBe('2026-07-24T10:00:00.000Z');
      expect(dst.course.prereqs).toEqual(src.course.prereqs);
      const o = dst.course.options[2]!;
      const so = src.course.options[2]!;
      expect(o.enrollCode).toBe(so.enrollCode);
      expect(o.seatsAvailable).toBe(so.seatsAvailable);
      expect(o.limit).toBe(so.limit);
      expect(o.final).toEqual(so.final);
      expect(o.components.map((c) => c.sectionCode)).toEqual(so.components.map((c) => c.sectionCode));
      expect(o.components[0]!.meetings).toEqual(so.components[0]!.meetings);
    }
  });

  it('shares one lecture component object across options (dedup by component id)', () => {
    const back = decodePlanV3(encodePlanV3(makePlan(1, 4)))!;
    const opts = back.entries[0]!.course.options;
    expect(opts[0]!.components[0]).toBe(opts[3]!.components[0]); // same reference = table dedup worked
  });

  it('preserves an empty prereqs array ([] = confirmed none) and absent prereqs (undefined)', () => {
    const plan = makePlan(2, 2);
    plan.entries[0]!.course.prereqs = [];
    delete plan.entries[1]!.course.prereqs;
    const back = decodePlanV3(encodePlanV3(plan))!;
    expect(back.entries[0]!.course.prereqs).toEqual([]);
    expect(back.entries[1]!.course.prereqs).toBeUndefined();
  });

  it('keeps a 5-course / all-options plan comfortably inside the QR budget', () => {
    const token = encodePlanV3(makePlan(5, 8));
    expect(token.length).toBeLessThan(2500); // measured prototype: ~1.8K for this density
  });

  it('rejects garbage tokens', () => {
    expect(decodePlanV3('3~not-base64!!!')).toBeNull();
    expect(decodePlanV3('nonsense')).toBeNull();
  });
});
