import { describe, it, expect } from 'vitest';
import { tssDeepLink } from './tss';
import { makeCourse } from './fixtures';

describe('tssDeepLink', () => {
  it('builds a TSS Fiori module link from the course term + moduleId', () => {
    const course = makeCourse('CSE-8A|2026|2', 'CSE-8A');
    course.moduleId = '8461';
    course.term = { year: '2026', period: '2', label: 'Fall 2026' };

    const link = tssDeepLink(course);
    expect(link).toBe(
      "https://tss.ucsd.edu/fiori#YSchedule-view?sap-app-origin-hint=&/YUCSD_CON_MODULE(AcademicYear='2026',AcademicPeriod='2',ModuleID='8461')",
    );
    expect(link.startsWith('https://tss.ucsd.edu/fiori#')).toBe(true);
  });
});
