/** Tiny hand-built fixtures for unit tests (kept out of the app bundle by naming). */
import type { CourseOffering, PlanState } from '@triton/shared';

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
