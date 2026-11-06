/** Tiny hand-built fixtures for unit tests (kept out of the app bundle by naming). */
import type { Component, CourseOffering, PlanState, Weekday } from '@triton/shared';

export function makeCourse(id: string, code = id, units = 4): CourseOffering {
  return {
    id,
    moduleId: id,
    subject: 'CSE',
    number: '1',
    courseCode: code,
    title: `Course ${code}`,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    units,
    options: [
      {
        id: `${id}-opt`,
        code: 'P-001-001',
        enrollCode: `${id}-opt`,
        components: [],
      },
    ],
  };
}

export function makePlan(): PlanState {
  const course = makeCourse('CSE-8A|2026|2', 'CSE-8A');
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }],
  };
}

function lecture(id: string, days: Weekday[], start: string, end: string): Component {
  return {
    id, type: 'LE', typeText: 'Lecture', sectionCode: 'A00', instructors: [], unscheduled: false, rawSched: '',
    meetings: [{ days, start, end, modality: 'In Person', building: 'Center Hall', room: '109' }],
  };
}

/**
 * CSE-8A on section o1 clashes with MATH-18 on Mondays and at the final, and has a
 * midterm; switching CSE-8A to o2 clears both clashes.
 */
export function makeClashPlan(): PlanState {
  const final = { date: '2026-12-07', start: '11:30', end: '14:29' };
  const cse = makeCourse('CSE-8A|2026|2', 'CSE-8A');
  cse.options = [
    {
      id: 'o1', code: 'P-001', enrollCode: 'o1', components: [lecture('E1', ['Mon'], '11:00', '11:50')], final,
      midterms: [{ date: '2026-10-28', start: '11:00', end: '11:50' }],
    },
    { id: 'o2', code: 'P-002', enrollCode: 'o2', components: [lecture('E2', ['Tue'], '11:00', '11:50')] },
  ];
  const math = makeCourse('MATH-18|2026|2', 'MATH-18');
  math.options = [
    { id: 'm1', code: 'P-001', enrollCode: 'm1', components: [lecture('E3', ['Mon', 'Wed'], '11:30', '12:20')], final },
  ];
  return {
    version: 1,
    term: cse.term,
    entries: [
      { course: cse, selectedOptionId: 'o1', color: '231' },
      { course: math, selectedOptionId: 'm1', color: '120' },
    ],
  };
}
