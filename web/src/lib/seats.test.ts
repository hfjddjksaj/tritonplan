import { describe, it, expect } from 'vitest';
import type { CourseOffering, SectionOption } from '@triton/shared';
import { optionFull, courseFull } from './seats';

/** A section option carrying only what the seat rule looks at. */
function opt(seatsAvailable?: number): SectionOption {
  return {
    id: 'SE1',
    code: 'P-001-001',
    enrollCode: 'SE1',
    components: [],
    ...(seatsAvailable === undefined ? {} : { seatsAvailable }),
  };
}

function course(...options: SectionOption[]): CourseOffering {
  return {
    id: 'CSE-008A|2026|2',
    moduleId: '8461',
    subject: 'CSE',
    number: '008A',
    courseCode: 'CSE-008A',
    title: 'Introduction to Programming',
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    options,
  };
}

describe('optionFull', () => {
  it('is full at zero seats and below', () => {
    expect(optionFull(opt(0))).toBe(true);
    expect(optionFull(opt(-3))).toBe(true); // TSS has been seen reporting overfill
  });

  it('is not full with seats left', () => {
    expect(optionFull(opt(1))).toBe(false);
    expect(optionFull(opt(15))).toBe(false);
  });

  it('is NOT full when the seat count is unknown', () => {
    // Older captures and some decoded links carry no seat count. Painting
    // "we don't know" as "no seats left" would be a claim the user acts on.
    expect(optionFull(opt(undefined))).toBe(false);
  });
});

describe('courseFull', () => {
  it('is full only when every section is full', () => {
    expect(courseFull(course(opt(0), opt(0)))).toBe(true);
    expect(courseFull(course(opt(0), opt(4)))).toBe(false);
  });

  it('is not full when any section has an unknown seat count', () => {
    expect(courseFull(course(opt(0), opt(undefined)))).toBe(false);
  });

  it('is not full with no sections at all', () => {
    expect(courseFull(course())).toBe(false);
  });
});
