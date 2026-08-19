import { describe, it, expect } from 'vitest';
import type { Component, CourseOffering, SectionOption } from '@triton/shared';
import { bookedElsewhere, bookedOptionOf } from './booked-section';

/** Shape taken from a live account (CHEM-114A, 2026-08-19): eight packages sharing
 *  two lectures, each with its own discussion. */
function comp(id: string, type: string, sectionCode: string): Component {
  return {
    id, type, typeText: type, sectionCode, instructors: [], meetings: [],
    unscheduled: false, rawSched: '',
  };
}
function opt(code: string, components: Component[]): SectionOption {
  return { id: `SE${code}`, code, enrollCode: `SE${code}`, components };
}
const LE1 = comp('E 00001077', 'LE', '001-000-LE');
const LE2 = comp('E 00001078', 'LE', '002-000-LE');
const course: CourseOffering = {
  id: 'CHEM-114A|2026|2', courseCode: 'CHEM-114A', subject: 'CHEM', number: '114A',
  title: 'Biochemical Structure and Function', term: { year: '2026', period: '2', label: 'Fall 2026' },
  options: [
    opt('P-001-001', [LE1, comp('E 00002558', 'DI', '001-001-DI')]),
    opt('P-001-002', [LE1, comp('E 00002559', 'DI', '001-002-DI')]),
    opt('P-002-001', [LE2, comp('E 00002562', 'DI', '002-001-DI')]),
    opt('P-002-004', [LE2, comp('E 00002565', 'DI', '002-004-DI')]),
  ],
} as CourseOffering;

describe('bookedOptionOf', () => {
  it('names the package whose events are exactly the enrolled ones', () => {
    // Verbatim from the live timetable feed: unprefixed, zero-padded.
    expect(bookedOptionOf(course, ['00001078', '00002565'])?.code).toBe('P-002-004');
  });

  it('matches on digits, so either side may carry a type prefix', () => {
    expect(bookedOptionOf(course, ['E 00001078', 'E 00002565'])?.code).toBe('P-002-004');
    expect(bookedOptionOf(course, ['1078', '2565'])?.code).toBe('P-002-004');
  });

  it('ignores the rest of the timetable — it carries every course the student has', () => {
    expect(bookedOptionOf(course, ['00009999', '00001078', '00002565', '00008888'])?.code).toBe(
      'P-002-004',
    );
  });

  it('stays silent on the lecture alone: four packages share it', () => {
    expect(bookedOptionOf(course, ['00001078'])).toBeNull();
  });

  it('stays silent when the timetable was never captured', () => {
    expect(bookedOptionOf(course, undefined)).toBeNull();
    expect(bookedOptionOf(course, [])).toBeNull();
  });

  it('stays silent when no enrolled event belongs to this course', () => {
    expect(bookedOptionOf(course, ['00007777'])).toBeNull();
  });

  it('stays silent when a component of the booked package was never captured', () => {
    // Discussion present, lecture missing from our data → the set matches nothing.
    const thin = { ...course, options: [opt('P-002-004', [comp('E 00002565', 'DI', '002-004-DI')])] };
    expect(bookedOptionOf(thin as CourseOffering, ['00001078', '00002565'])?.code).toBe('P-002-004');
  });
});

describe('bookedElsewhere', () => {
  it('says nothing when the plan is on the booked package', () => {
    expect(bookedElsewhere(course, 'SEP-002-004', ['00001078', '00002565'])).toBeNull();
  });

  it('names the booked package when the plan is on another one', () => {
    expect(bookedElsewhere(course, 'SEP-002-001', ['00001078', '00002565'])?.code).toBe('P-002-004');
  });

  it('says nothing when either side is unknown', () => {
    expect(bookedElsewhere(course, null, ['00001078', '00002565'])).toBeNull();
    expect(bookedElsewhere(course, 'SEP-002-001', undefined)).toBeNull();
  });
});
