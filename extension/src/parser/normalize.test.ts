import { describe, it, expect } from 'vitest';
import { normalizeSections, prereqTreeToGroups } from './normalize.js';
import { loadNormalizedFixture, denormalize, prereqTreeRows } from './fixtures.js';

const fx = loadNormalizedFixture();

describe('prereqTreeToGroups — captured CHEM-043A tree', () => {
  it('roots become AND-ed groups; children become OR options in order', () => {
    expect(prereqTreeToGroups(prereqTreeRows())).toEqual([
      {
        label: '1 of the following:',
        options: [
          "CHEM-007L - General Chemistry Laboratory with a 'D' or higher",
          "CHEM-007LM - General Chemistry Lab - Majors with a 'D' or higher",
        ],
      },
      {
        label: '1 of the following:',
        options: [
          "CHEM-041A - Organic I: Struct & React with a 'D' or higher",
          "CHEM-040A - Organic Chem for Life Sci I with a 'D' or higher",
          "CHEM-040AH - Honors Organic Chemistry I with a 'D' or higher",
        ],
      },
    ]);
  });

  it('empty tree → no groups; orphan and childless rows degrade gracefully', () => {
    expect(prereqTreeToGroups([])).toEqual([]);
    // A childless root is its own requirement; an orphan (unknown parent) too.
    expect(
      prereqTreeToGroups([
        { id: 'R1', parent_id: '', text: 'CHEM-006B with a C- or higher' },
        { id: 'X9', parent_id: 'GONE', text: 'Orphaned requirement' },
      ]),
    ).toEqual([
      { label: 'CHEM-006B with a C- or higher', options: [] },
      { label: 'Orphaned requirement', options: [] },
    ]);
  });

  it('nested descendants flatten into the root group', () => {
    expect(
      prereqTreeToGroups([
        { id: 'R', parent_id: '', text: 'All of the following:' },
        { id: 'R.1', parent_id: 'R', text: 'MATH-020A' },
        { id: 'R.1.1', parent_id: 'R.1', text: 'MATH-010A with a C or higher' },
      ]),
    ).toEqual([
      { label: 'All of the following:', options: ['MATH-020A', 'MATH-010A with a C or higher'] },
    ]);
  });
});

describe('normalizeSections — real captured CSE data', () => {
  it('CSE-008A: 9 packages, each = lecture + one lab + discussion, with final', () => {
    const course = normalizeSections(denormalize(fx['CSE-008A']!), {
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
    const course = normalizeSections(denormalize(fx['CSE-008A']!), { courseCode: 'CSE-008A', title: 't' });
    const labRooms = course.options.map(
      (o) => o.components.find((c) => c.type === 'LA')!.meetings[0]!.start,
    );
    // 9 distinct lab start times 09:00..17:00
    expect(new Set(labRooms).size).toBe(9);
    for (const o of course.options) {
      expect(o.components.find((c) => c.type === 'LE')!.id).toBe('E 00000958');
    }
  });

  it('CSE-011: 4 packages across 2 lecture sections, finals differ per lecture', () => {
    const course = normalizeSections(denormalize(fx['CSE-011']!), { courseCode: 'CSE-011', title: 't' });
    expect(course.options).toHaveLength(4);
    const p1 = course.options.find((o) => o.code === 'P-001-001')!;
    const p2 = course.options.find((o) => o.code === 'P-002-001')!;
    expect(p1.components.find((c) => c.type === 'LE')!.instructors).toEqual(['Joe Politz']);
    expect(p2.components.find((c) => c.type === 'LE')!.instructors).toEqual(['Benjamin Ochoa']);
    expect(p1.final?.date).toBe('2026-12-10');
    expect(p2.final?.date).toBe('2026-12-07');
  });

  it('CSE-030: minimal course (1 lecture + 1 discussion, 1 package)', () => {
    const course = normalizeSections(denormalize(fx['CSE-030']!), { courseCode: 'CSE-030', title: 't' });
    expect(course.options).toHaveLength(1);
    expect(course.options[0]!.components.map((c) => c.type)).toEqual(['LE', 'DI']);
    expect(course.options[0]!.final?.date).toBe('2026-12-10');
  });
});

import { apptPeriodsFixture } from './fixtures.js';
import type { TssApptPeriodsRow } from './tss-types.js';
import { apptPeriodsToApptTimes } from './normalize.js';

describe('apptPeriodsToApptTimes', () => {
  const fx = apptPeriodsFixture();

  it('maps the fixture row: windows sorted by begin, unit caps joined, texts taken', () => {
    const appt = apptPeriodsToApptTimes(fx.row, '2026-07-25T12:00:00Z');
    expect(appt).not.toBeNull();
    expect(appt!.academicYear).toBe('2026');
    expect(appt!.academicSession).toBe('2');
    expect(appt!.yearText).toBe('2026/2027');
    expect(appt!.sessionText).toBe('Fall Quarter');
    expect(appt!.capturedAt).toBe('2026-07-25T12:00:00Z');
    // fixture order is 08-10, 09-12, 08-21, 09-28 — output must be begin-sorted
    expect(appt!.windows.map((w) => w.beginsAt.slice(5, 10))).toEqual([
      '08-10', '08-21', '09-12', '09-28',
    ]);
    expect(appt!.windows[0]).toEqual({
      label: 'First Pass',
      beginsAt: '2026-08-10T21:00:00Z',
      endsAt: '2026-08-14T05:59:59Z',
      unitCap: '11.50',
      waitlists: 'Not Allowed',
    });
    expect(appt!.windows[3]!.label).toBe('Instruction Session Enrollment');
    expect(appt!.windows[3]!.unitCap).toBe('22.00');
  });

  it('whitelists output — no PII field can survive', () => {
    const dirty = {
      ...fx.row,
      studentNumber: '200355050',
      studentObjid: '355047',
      studyObjid: '170130',
    } as unknown as TssApptPeriodsRow;
    const appt = apptPeriodsToApptTimes(dirty, '2026-07-25T12:00:00Z')!;
    const json = JSON.stringify(appt);
    expect(json).not.toContain('studentNumber');
    expect(json).not.toContain('200355050');
    expect(json).not.toContain('355047');
    expect(json).not.toContain('170130');
    expect(Object.keys(appt).sort()).toEqual([
      'academicSession', 'academicYear', 'capturedAt', 'sessionText', 'windows', 'yearText',
    ]);
  });

  it('keeps an empty windows list and falls back to code-derived texts', () => {
    const appt = apptPeriodsToApptTimes(
      { academicYear: '2026', academicSession: '3' },
      '2026-07-25T12:00:00Z',
    );
    expect(appt).not.toBeNull();
    expect(appt!.windows).toEqual([]);
    expect(appt!.yearText).toBe('2026');
    expect(appt!.sessionText).toBe('Period 3');
  });

  it('rejects a structurally unusable row', () => {
    expect(apptPeriodsToApptTimes({} as TssApptPeriodsRow, 'x')).toBeNull();
  });
});
