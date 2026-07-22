import { describe, it, expect } from 'vitest';
import { meetingsConflict, findWeeklyConflicts, findFinalConflicts, type SelectedCourse } from './conflicts.js';
import type { Meeting, SectionOption } from './types.js';

const m = (days: Meeting['days'], start: string, end: string): Meeting => ({
  days, start, end, modality: 'In Person',
});

function opt(id: string, meetings: Meeting[]): SectionOption {
  return {
    id, code: id, enrollCode: id,
    components: [{ id: id + '-le', type: 'LE', typeText: 'Lecture', sectionCode: '001', instructors: [], meetings, unscheduled: false, rawSched: '' }],
  };
}

describe('meetingsConflict', () => {
  it('same day overlapping times conflict', () => {
    expect(meetingsConflict(m(['Mon'], '10:00', '11:00'), m(['Mon'], '10:30', '11:30'))).toBe(true);
  });
  it('different days never conflict', () => {
    expect(meetingsConflict(m(['Mon'], '10:00', '11:00'), m(['Tue'], '10:00', '11:00'))).toBe(false);
  });
  it('back-to-back same day do not conflict', () => {
    expect(meetingsConflict(m(['Mon'], '10:00', '11:00'), m(['Mon'], '11:00', '12:00'))).toBe(false);
  });
});

describe('findWeeklyConflicts', () => {
  it('detects a cross-course clash', () => {
    const selected: SelectedCourse[] = [
      { courseId: 'A', option: opt('A', [m(['Mon', 'Wed'], '10:00', '10:50')]) },
      { courseId: 'B', option: opt('B', [m(['Wed'], '10:30', '11:20')]) },
      { courseId: 'C', option: opt('C', [m(['Fri'], '10:00', '10:50')]) },
    ];
    const conflicts = findWeeklyConflicts(selected);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ aCourseId: 'A', bCourseId: 'B', day: 'Wed' });
  });
});

describe('findFinalConflicts', () => {
  it('detects overlapping finals on the same date', () => {
    const selected: SelectedCourse[] = [
      { courseId: 'A', option: opt('A', []), final: { date: '2026-12-09', start: '11:30', end: '14:29' } },
      { courseId: 'B', option: opt('B', []), final: { date: '2026-12-09', start: '14:00', end: '16:59' } },
      { courseId: 'C', option: opt('C', []), final: { date: '2026-12-10', start: '11:30', end: '14:29' } },
    ];
    const conflicts = findFinalConflicts(selected);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ aCourseId: 'A', bCourseId: 'B', date: '2026-12-09' });
  });
});
