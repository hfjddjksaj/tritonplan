import { describe, expect, it } from 'vitest';
import type { CourseOffering } from '@triton/shared';
import { makeCourse } from './fixtures';
import { courseInstructors, rmpSearchUrl } from './rmp';

type Opt = { code: string; instructors: string[][] };

/** A course whose options each carry components with the given instructor lists. */
function course(opts: Opt[]): CourseOffering {
  const c = makeCourse('CSE-8A|2026|2', 'CSE-8A');
  c.options = opts.map((o, i) => ({
    id: `o${i}`,
    code: o.code,
    enrollCode: `o${i}`,
    components: o.instructors.map((instructors, j) => ({
      id: `c${i}${j}`, type: 'LE', typeText: 'Lecture', sectionCode: 'x', instructors,
      meetings: [], unscheduled: true, rawSched: '',
    })) as CourseOffering['options'][number]['components'],
  }));
  return c;
}

describe('courseInstructors', () => {
  it('dedupes across components and options, case-insensitively, keeping the first spelling', () => {
    const r = courseInstructors(course([
      { code: 'P-001', instructors: [['Joshua Figueroa'], ['Ada Lovelace']] },
      { code: 'P-002', instructors: [['joshua figueroa'], [' Joshua Figueroa ']] },
    ]));
    expect(r.map((x) => x.name)).toEqual(['Joshua Figueroa', 'Ada Lovelace']);
  });

  it('drops Staff, TBA and empty strings, whatever the case or padding', () => {
    const r = courseInstructors(course([
      { code: 'P-001', instructors: [['Staff', ' tba ', '', '   ', 'STAFF', 'Leo Porter']] },
    ]));
    expect(r).toEqual([{ name: 'Leo Porter', sections: ['P-001'] }]);
  });

  it('lists each option code the teacher appears in, once, in order', () => {
    const r = courseInstructors(course([
      { code: 'P-001', instructors: [['A One'], ['A One']] },
      { code: 'P-002', instructors: [['B Two']] },
      { code: 'P-003', instructors: [['a one']] },
    ]));
    expect(r).toEqual([
      { name: 'A One', sections: ['P-001', 'P-003'] },
      { name: 'B Two', sections: ['P-002'] },
    ]);
  });

  it('returns nothing when TSS lists nobody', () => {
    expect(courseInstructors(course([{ code: 'P-001', instructors: [['Staff']] }]))).toEqual([]);
  });
});

describe('rmpSearchUrl', () => {
  it('builds the UCSD search page, encoding the name', () => {
    expect(rmpSearchUrl('Joshua Figueroa')).toBe(
      'https://www.ratemyprofessors.com/search/professors/1079?q=Joshua%20Figueroa',
    );
  });
});
