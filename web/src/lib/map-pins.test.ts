import { describe, it, expect } from 'vitest';
import type { CourseOffering, PlanState } from '@triton/shared';
import { meetingPins } from './map-pins';

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
    const pins = meetingPins(planWith(courseWithMeetings()));
    expect(pins).toHaveLength(3); // Mon + Wed lecture, Fri lab
    expect(pins.map((p) => p.label)).toEqual(['LEC', 'LEC', 'LAB']);
    expect(pins.map((p) => p.when.weekday)).toEqual(['Mon', 'Wed', 'Fri']);
    expect(pins.every((p) => p.kind === 'meeting')).toBe(true);
    expect(pins[0]!.courseCode).toBe('CSE-8A');
    expect(pins[0]!.when.start).toBe('11:00');
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
