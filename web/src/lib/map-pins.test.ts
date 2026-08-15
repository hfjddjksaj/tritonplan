import { describe, it, expect } from 'vitest';
import type { CourseOffering, PlanState } from '@triton/shared';
import { meetingPins, midtermPins, finalPins } from './map-pins';
import { entryHue } from './plan';

/** A course whose lecture meets in a real, matchable UCSD building. */
function courseWithMeetings(): CourseOffering {
  return {
    id: 'CSE-8A|2026|2',
    moduleId: '8461',
    subject: 'CSE',
    number: '8A',
    courseCode: 'CSE-8A',
    title: 'Intro to Programming',
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    units: 4,
    options: [
      {
        id: 'opt-1',
        code: 'P-001-001',
        enrollCode: 'SE00152185',
        components: [
          {
            id: 'E-1',
            type: 'LE',
            typeText: 'Lecture',
            sectionCode: 'A00',
            instructors: ['Ada Lovelace'],
            meetings: [
              {
                days: ['Mon', 'Wed'],
                start: '11:00',
                end: '11:50',
                modality: 'In Person',
                building: 'Center Hall',
                room: '109',
                location: 'Center Hall 109',
              },
            ],
          },
          {
            id: 'E-2',
            type: 'LA',
            typeText: 'Laboratory',
            sectionCode: 'A01',
            instructors: [],
            meetings: [
              {
                days: ['Fri'],
                start: '13:00',
                end: '15:50',
                modality: 'In Person',
                building: 'A Building That Does Not Exist',
                room: '3224',
              },
            ],
          },
        ],
      },
    ],
  } as CourseOffering;
}

function planWith(course: CourseOffering): PlanState {
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }],
  };
}

describe('meetingPins', () => {
  it('emits one pin per weekday of every meeting, tagged LEC / LAB', () => {
    const plan = planWith(courseWithMeetings());
    const pins = meetingPins(plan);
    expect(pins).toHaveLength(3); // Mon + Wed lecture, Fri lab
    expect(pins.map((p) => p.label)).toEqual(['LEC', 'LEC', 'LAB']);
    expect(pins.map((p) => p.when.weekday)).toEqual(['Mon', 'Wed', 'Fri']);
    expect(pins.every((p) => p.kind === 'meeting')).toBe(true);
    expect(pins[0]!.courseCode).toBe('CSE-8A');
    expect(pins[0]!.when.start).toBe('11:00');
    // Same hue the calendar uses for this course's blocks — the colour link to the map.
    expect(pins[0]!.hue).toBe(entryHue(plan, plan.entries[0]!));
    expect(pins[0]!.rawLocation).toBe('Center Hall 109');
  });

  it('resolves coordinates for a known building', () => {
    const pins = meetingPins(planWith(courseWithMeetings()));
    expect(pins[0]!.coords).not.toBeNull();
    expect(pins[0]!.coords!.lat).toBeGreaterThan(32.86);
    expect(pins[0]!.coords!.lng).toBeLessThan(-117.2);
    expect(pins[0]!.room).toBe('109');
  });

  it('keeps an unmatched building as a pin with null coords, never a guess', () => {
    const lab = meetingPins(planWith(courseWithMeetings()))[2]!;
    expect(lab.coords).toBeNull();
    expect(lab.building).toBe('A Building That Does Not Exist');
  });

  it('marks pins booked only for course ids in the booked set', () => {
    const plan = planWith(courseWithMeetings());
    const none = meetingPins(plan);
    expect(none.every((p) => p.booked === false)).toBe(true);
    const some = meetingPins(plan, new Set(['CSE-8A|2026|2']));
    expect(some.every((p) => p.booked === true)).toBe(true);
  });

  it('falls back to the first three letters for an unknown teaching method', () => {
    const course = courseWithMeetings();
    course.options[0]!.components[0]!.type = 'ZZ';
    course.options[0]!.components[0]!.typeText = 'Colloquium';
    expect(meetingPins(planWith(course))[0]!.label).toBe('COL');
  });
});

/** Exam whose location TSS supplied as a structured field (post-2026-08-11). */
function courseWithModernFinal(): CourseOffering {
  const c = courseWithMeetings();
  c.options[0]!.final = {
    date: '2026-12-09',
    start: '11:30',
    end: '14:29',
    modality: 'In Person',
    location: 'York Hall Room 2622',
    building: 'York Hall',
    room: '2622',
  };
  return c;
}

/**
 * Exam captured BEFORE the parser learned to split "@ <Location>": the whole
 * tail sits in `modality`. Every plan captured before 2026-08-11 — and every
 * share link encoded from one — looks like this, so reading `final.building`
 * directly would silently lose the location for all of them.
 */
function courseWithLegacyFinal(): CourseOffering {
  const c = courseWithMeetings();
  c.options[0]!.final = {
    date: '2026-12-09',
    start: '11:30',
    end: '14:29',
    modality: 'In Person @ York Hall Room 2622',
  };
  return c;
}

describe('finalPins', () => {
  it('emits one dated pin per final, labelled Final', () => {
    const plan = planWith(courseWithModernFinal());
    const pins = finalPins(plan);
    expect(pins).toHaveLength(1);
    expect(pins[0]!.kind).toBe('final');
    expect(pins[0]!.label).toBe('Final');
    expect(pins[0]!.when).toEqual({ date: '2026-12-09', start: '11:30', end: '14:29' });
    expect(pins[0]!.when.weekday).toBeUndefined();
    expect(pins[0]!.booked).toBe(false);
    const booked = finalPins(plan, new Set(['CSE-8A|2026|2']));
    expect(booked[0]!.booked).toBe(true);
  });

  it('recovers the location from a legacy modality tail', () => {
    const modern = finalPins(planWith(courseWithModernFinal()))[0]!;
    const legacy = finalPins(planWith(courseWithLegacyFinal()))[0]!;
    expect(legacy.building).toBe('York Hall');
    expect(legacy.room).toBe('2622');
    expect(legacy.coords).toEqual(modern.coords);
    expect(legacy.coords).not.toBeNull();
  });

  it('emits nothing for a course with no final', () => {
    expect(finalPins(planWith(courseWithMeetings()))).toEqual([]);
  });
});

describe('midtermPins', () => {
  it('numbers multiple midterms and skips courses with none', () => {
    const c = courseWithMeetings();
    c.options[0]!.components[0]!.rawSched =
      'Midterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person @ Center Hall Room 109\n' +
      'Midterm Examination 11/14/2026 10:00 AM - 11:50 AM In Person @ Center Hall Room 109';
    const plan = planWith(c);
    const pins = midtermPins(plan);
    expect(pins).toHaveLength(2);
    expect(pins.map((p) => p.label)).toEqual(['Midterm 1', 'Midterm 2']);
    expect(pins.every((p) => p.kind === 'midterm')).toBe(true);
    expect(pins[0]!.when.date).toBe('2026-10-31');
    expect(pins[0]!.building).toBe('Center Hall');
    expect(pins.every((p) => p.booked === false)).toBe(true);
    const booked = midtermPins(plan, new Set(['CSE-8A|2026|2']));
    expect(booked.every((p) => p.booked === true)).toBe(true);
  });

  it('emits nothing when TSS has announced no midterm', () => {
    expect(midtermPins(planWith(courseWithMeetings()))).toEqual([]);
  });
});
