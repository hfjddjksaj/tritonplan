import type { CourseOffering, PlanState, Weekday } from '@triton/shared';

/** Realistic course: 1 shared lecture + per-option discussion, prereqs, capturedAt. */
export function makeCourse(seed: number, nOpts: number): CourseOffering {
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

export function makePlan(nCourses: number, nOpts: number): PlanState {
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: Array.from({ length: nCourses }, (_, i) => {
      const course = makeCourse(i, nOpts);
      return { course, selectedOptionId: course.options[1]?.id ?? course.options[0]!.id, color: String(140 + i) };
    }),
  };
}
