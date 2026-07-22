import { describe, it, expect } from 'vitest';
import { normalizeSections } from './normalize.js';
import { loadNormalizedFixture, denormalize } from './fixtures.js';

const fx = loadNormalizedFixture();

describe('normalizeSections — real captured CSE data', () => {
  it('CSE-008A: 9 packages, each = lecture + one lab + discussion, with final', () => {
    const course = normalizeSections(denormalize(fx['CSE-008A']), {
      courseCode: 'CSE-008A',
      title: 'Introduction to Programming and Computational Problem Solving - 1',
    });
    expect(course.subject).toBe('CSE');
    expect(course.number).toBe('008A');
    expect(course.term.label).toBe('Fall 2026');
    expect(course.options).toHaveLength(9);

    const opt = course.options.find((o) => o.code === 'P-001-001')!;
    expect(opt).toBeTruthy();
    // sorted lecture, discussion, lab
    expect(opt.components.map((c) => c.type)).toEqual(['LE', 'DI', 'LA']);
    const le = opt.components.find((c) => c.type === 'LE')!;
    expect(le.instructors).toEqual(['Leo Porter']);
    expect(le.meetings[0]).toMatchObject({ days: ['Tue', 'Thu'], start: '11:00', end: '12:20' });
    const lab = opt.components.find((c) => c.type === 'LA')!;
    expect(lab.meetings[0]).toMatchObject({ days: ['Wed'], start: '09:00', end: '09:50', room: 'B260' });
    // final derived from the lecture
    expect(opt.final).toEqual({ date: '2026-12-09', start: '11:30', end: '14:29', modality: 'In Person' });
  });

  it('CSE-008A: every package shares the same lecture but a distinct lab', () => {
    const course = normalizeSections(denormalize(fx['CSE-008A']), { courseCode: 'CSE-008A', title: 't' });
    const labRooms = course.options.map(
      (o) => o.components.find((c) => c.type === 'LA')!.meetings[0].start,
    );
    // 9 distinct lab start times 09:00..17:00
    expect(new Set(labRooms).size).toBe(9);
    for (const o of course.options) {
      expect(o.components.find((c) => c.type === 'LE')!.id).toBe('E 00000958');
    }
  });

  it('CSE-011: 4 packages across 2 lecture sections, finals differ per lecture', () => {
    const course = normalizeSections(denormalize(fx['CSE-011']), { courseCode: 'CSE-011', title: 't' });
    expect(course.options).toHaveLength(4);
    const p1 = course.options.find((o) => o.code === 'P-001-001')!;
    const p2 = course.options.find((o) => o.code === 'P-002-001')!;
    expect(p1.components.find((c) => c.type === 'LE')!.instructors).toEqual(['Joe Politz']);
    expect(p2.components.find((c) => c.type === 'LE')!.instructors).toEqual(['Benjamin Ochoa']);
    expect(p1.final?.date).toBe('2026-12-10');
    expect(p2.final?.date).toBe('2026-12-07');
  });

  it('CSE-030: minimal course (1 lecture + 1 discussion, 1 package)', () => {
    const course = normalizeSections(denormalize(fx['CSE-030']), { courseCode: 'CSE-030', title: 't' });
    expect(course.options).toHaveLength(1);
    expect(course.options[0].components.map((c) => c.type)).toEqual(['LE', 'DI']);
    expect(course.options[0].final?.date).toBe('2026-12-10');
  });
});
