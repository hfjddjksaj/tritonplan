import { describe, it, expect } from 'vitest';
import type { CourseOffering } from '@triton/shared';
import { foldCourse } from './course-merge';
import { makeCourse } from './fixtures';

/** A complete capture: the module row was seen, so title/units/level are real. */
function complete(): CourseOffering {
  return {
    ...makeCourse('PHYS-002CL|2026|2', 'PHYS-002CL'),
    title: 'Physics Laboratory — Mechanics',
    units: 2,
    academicLevel: 'Lower Division',
    department: 'Physics',
    prereqs: [],
    capturedAt: '2026-08-01T00:00:00.000Z',
  };
}

/**
 * A section-only capture: the extension saw the section rows but not the module
 * row, so `metaFor` fell back to `{courseCode, title: courseCode}` — no units,
 * no level, no department. This is what erased the user's units in the wild.
 */
function sectionOnly(): CourseOffering {
  const c = makeCourse('PHYS-002CL|2026|2', 'PHYS-002CL');
  return { ...c, title: 'PHYS-002CL', capturedAt: '2026-08-10T04:54:35.560Z' };
}

describe('foldCourse', () => {
  it('keeps units a partial capture does not carry', () => {
    expect(foldCourse(complete(), sectionOnly()).units).toBe(2);
  });

  it('keeps the real title when the fresh copy only has the course code', () => {
    expect(foldCourse(complete(), sectionOnly()).title).toBe('Physics Laboratory — Mechanics');
  });

  it('keeps level and department the same way', () => {
    const out = foldCourse(complete(), sectionOnly());
    expect(out.academicLevel).toBe('Lower Division');
    expect(out.department).toBe('Physics');
  });

  it('does not downgrade a known empty prereq list to "never captured"', () => {
    // [] means TSS listed no requirements; undefined means we never looked.
    expect(foldCourse(complete(), sectionOnly()).prereqs).toEqual([]);
  });

  it('lets a complete fresh capture win on every module-level field', () => {
    const prev = complete();
    const fresh: CourseOffering = {
      ...complete(),
      title: 'Physics Laboratory — Renamed',
      units: 4,
      academicLevel: 'Upper Division',
      department: 'Physics & Astronomy',
      prereqs: [{ label: '1 of the following:', options: ['PHYS-002A'] }],
    };
    const out = foldCourse(prev, fresh);
    expect(out.title).toBe('Physics Laboratory — Renamed');
    expect(out.units).toBe(4);
    expect(out.academicLevel).toBe('Upper Division');
    expect(out.department).toBe('Physics & Astronomy');
    expect(out.prereqs).toHaveLength(1);
  });

  it('always takes sections and freshness from the fresh copy', () => {
    // The whole point of a refresh is live seat counts — never fold those back.
    const prev = complete();
    prev.options[0]!.seatsAvailable = 30;
    const fresh = sectionOnly();
    fresh.options[0]!.seatsAvailable = 0;
    const out = foldCourse(prev, fresh);
    expect(out.options).toBe(fresh.options);
    expect(out.options[0]!.seatsAvailable).toBe(0);
    expect(out.capturedAt).toBe('2026-08-10T04:54:35.560Z');
  });

  it('leaves a field undefined when neither copy has it', () => {
    const bare = makeCourse('X-001|2026|2', 'X-001');
    expect(foldCourse(bare, { ...bare })).not.toHaveProperty('units');
  });

  it('keeps a title that legitimately equals the course code on both sides', () => {
    const a = sectionOnly();
    expect(foldCourse(a, { ...a }).title).toBe('PHYS-002CL');
  });
});
