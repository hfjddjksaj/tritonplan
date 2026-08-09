import { describe, it, expect } from 'vitest';
import type { CourseOffering, MidtermExam, PlanState, SectionOption } from '@triton/shared';
import {
  finalsSorted,
  meetingInstances,
  midtermOverlapKeys,
  midtermsSorted,
  optionSummaryParts,
  refreshPlanEntries,
} from './plan';
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

describe('midtermsSorted / midtermOverlapKeys', () => {
  const mt = (date: string, start: string, end: string, modality?: string): MidtermExam => ({
    date,
    start,
    end,
    ...(modality ? { modality } : {}),
  });

  function entryWith(id: string, midterms?: MidtermExam[], selected = true) {
    const course = makeCourse(id, id);
    if (midterms !== undefined) course.options[0]!.midterms = midterms;
    return { course, selectedOptionId: selected ? course.options[0]!.id : null, color: '231' };
  }

  function plan(entries: ReturnType<typeof entryWith>[]) {
    return { version: 1 as const, term: { year: '2026', period: '2', label: 'Fall 2026' }, entries };
  }

  it('splits courses into dated (sorted by date+start) and TBD (sorted by code)', () => {
    const p = plan([
      entryWith('CSE-100', [mt('2026-11-05', '19:00', '20:50', 'In Person')]),
      entryWith('ZZZ-1'), // no midterms field, no rawSched → TBD
      entryWith('AAA-1', []), // explicitly empty → still TBD
      entryWith('CHEM-43A', [mt('2026-10-31', '10:00', '11:50')]),
    ]);
    const { dated, tbd } = midtermsSorted(p);
    expect(dated.map((d) => d.courseCode)).toEqual(['CHEM-43A', 'CSE-100']);
    expect(dated[1]!.midterm.modality).toBe('In Person');
    expect(tbd.map((t) => t.courseCode)).toEqual(['AAA-1', 'ZZZ-1']);
  });

  it('labels multiple midterms of one course "Midterm N" in date order', () => {
    const p = plan([
      entryWith('CHEM-40A', [mt('2026-11-14', '10:00', '11:50'), mt('2026-10-17', '10:00', '11:50')]),
      entryWith('CSE-100', [mt('2026-11-01', '08:00', '09:50')]),
    ]);
    const { dated } = midtermsSorted(p);
    expect(dated.map((d) => [d.courseCode, d.label ?? ''])).toEqual([
      ['CHEM-40A', 'Midterm 1'],
      ['CSE-100', ''],
      ['CHEM-40A', 'Midterm 2'],
    ]);
  });

  it('derives midterms from component rawSched when the option has no explicit field', () => {
    const course = makeCourse('CHEM-43A');
    course.options[0]!.components = [
      {
        id: 'lec',
        type: 'LE',
        typeText: 'Lecture',
        sectionCode: '001-000',
        instructors: [],
        meetings: [],
        unscheduled: false,
        rawSched:
          'F 09:00 AM - 09:50 AM In Person @ York Hall Room 2622\n' +
          'Midterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person\n' +
          'Final Examination 12/05/2026 11:30 AM - 02:29 PM In Person',
      },
    ];
    const p = plan([{ course, selectedOptionId: course.options[0]!.id, color: '231' }]);
    const { dated, tbd } = midtermsSorted(p);
    expect(tbd).toHaveLength(0);
    expect(dated).toHaveLength(1);
    expect(dated[0]!.midterm).toEqual(mt('2026-10-31', '10:00', '11:50', 'In Person'));
  });

  it('a course with no selected option is TBD', () => {
    const { dated, tbd } = midtermsSorted(plan([entryWith('CSE-8A', [mt('2026-11-01', '08:00', '09:50')], false)]));
    expect(dated).toHaveLength(0);
    expect(tbd.map((t) => t.courseCode)).toEqual(['CSE-8A']);
  });

  it('flags overlaps between DIFFERENT courses only, same date + overlapping time', () => {
    const p = plan([
      entryWith('A-1', [mt('2026-11-05', '19:00', '20:50'), mt('2026-11-05', '20:00', '21:00')]),
      entryWith('B-1', [mt('2026-11-05', '20:00', '21:50')]),
      entryWith('C-1', [mt('2026-11-06', '19:00', '20:50')]), // other day — clear
    ]);
    const { dated } = midtermsSorted(p);
    const flagged = midtermOverlapKeys(dated);
    // A's two own midterms overlap each other but that never flags; both hit B.
    expect(flagged).toEqual(
      new Set([
        'A-1|2026-11-05|19:00',
        'A-1|2026-11-05|20:00',
        'B-1|2026-11-05|20:00',
      ]),
    );
  });
});

describe('full-section flag on calendar instances', () => {
  /** A plan with one course whose selected option has `seats` seats left. */
  function planWithSeats(seats: number | undefined): PlanState {
    const course = makeCourse('CSE-008A|2026|2', 'CSE-008A');
    const option = course.options[0]!;
    if (seats !== undefined) option.seatsAvailable = seats;
    option.components = [
      {
        id: 'E1',
        type: 'LE',
        typeText: 'Lecture',
        sectionCode: '001-000-LE',
        instructors: ['Leo Porter'],
        meetings: [{ days: ['Mon'], start: '09:00', end: '09:50', modality: 'In Person' }],
        unscheduled: false,
        rawSched: 'M 09:00 AM - 09:50 AM In Person\nFinal Examination 12/09/2026 11:30 AM - 2:29 PM In Person\nMidterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person',
      },
    ];
    option.final = { date: '2026-12-09', start: '11:30', end: '14:29' };
    return {
      version: 1,
      term: course.term,
      entries: [{ course, selectedOptionId: option.id, color: '231' }],
    };
  }

  it('marks weekly meetings, finals and midterms of a full section', () => {
    const plan = planWithSeats(0);
    expect(meetingInstances(plan).every((m) => m.full)).toBe(true);
    expect(finalsSorted(plan)[0]!.full).toBe(true);
    expect(midtermsSorted(plan).dated[0]!.full).toBe(true);
  });

  it('leaves them unmarked when seats remain', () => {
    const plan = planWithSeats(12);
    expect(meetingInstances(plan).some((m) => m.full)).toBe(false);
    expect(finalsSorted(plan)[0]!.full).toBe(false);
    expect(midtermsSorted(plan).dated[0]!.full).toBe(false);
  });

  it('leaves them unmarked when the seat count is unknown', () => {
    const plan = planWithSeats(undefined);
    expect(meetingInstances(plan).some((m) => m.full)).toBe(false);
    expect(finalsSorted(plan)[0]!.full).toBe(false);
  });
});
