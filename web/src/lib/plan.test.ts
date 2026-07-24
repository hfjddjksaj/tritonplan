import { describe, it, expect } from 'vitest';
import type { CourseOffering, SectionOption } from '@triton/shared';
import { optionSummaryParts, refreshPlanEntries } from './plan';
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

describe('optionSummaryParts', () => {
  // CHEM-043A shape: a real lecture meeting, a phantom exam-time meeting from
  // pre-0.2.1 captures, and an undefined "Other" component.
  const chemOption: SectionOption = {
    id: 'pkg',
    code: 'P-001-001',
    enrollCode: 'pkg',
    components: [
      {
        id: 'lec',
        type: 'LE',
        typeText: 'Lecture',
        sectionCode: '001-000',
        instructors: [],
        meetings: [
          { days: ['Fri'], start: '09:00', end: '09:50', modality: 'In Person' },
          // Old extension builds turned "Midterm Examination 10/31/2026 …" into this:
          { days: [], start: '10:00', end: '11:50', modality: 'In Person' },
        ],
        unscheduled: false,
        rawSched: 'F 09:00 AM - 09:50 AM In Person @ York Hall Room 2622',
      },
      {
        id: 'other',
        type: 'OT',
        typeText: 'Other',
        sectionCode: '003-001',
        instructors: [],
        meetings: [],
        unscheduled: true,
        rawSched: 'Schedule Not Defined',
      },
    ],
  };

  it('skips day-less phantom meetings but keeps undefined components as "undefined"', () => {
    expect(optionSummaryParts(chemOption)).toEqual([
      { type: 'LEC', time: 'F 09:00–09:50' },
      { type: 'OTH', time: 'undefined' },
    ]);
  });

  it('shows undefined components in place (ETHN-001R: async lecture, scheduled discussion)', () => {
    const option: SectionOption = {
      id: 'pkg2',
      code: 'P-001-001',
      enrollCode: 'pkg2',
      components: [
        {
          id: 'lec',
          type: 'LE',
          typeText: 'Lecture',
          sectionCode: '001-000',
          instructors: [],
          meetings: [],
          unscheduled: true,
          rawSched: 'Schedule Not Defined',
        },
        {
          id: 'dis',
          type: 'DI',
          typeText: 'Discussion',
          sectionCode: '001-001',
          instructors: [],
          meetings: [{ days: ['Wed'], start: '09:00', end: '09:50', modality: 'Live Online' }],
          unscheduled: false,
          rawSched: 'W 09:00 AM - 09:50 AM Live Online',
        },
      ],
    };
    expect(optionSummaryParts(option)).toEqual([
      { type: 'LEC', time: 'undefined' },
      { type: 'DIS', time: 'W 09:00–09:50' },
    ]);
  });

  it('path 2 (standby): hideOther drops TeachingMethod "Other" components entirely', () => {
    expect(optionSummaryParts(chemOption, true)).toEqual([{ type: 'LEC', time: 'F 09:00–09:50' }]);
  });
});

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
