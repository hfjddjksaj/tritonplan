import { describe, it, expect } from 'vitest';
import type { CourseOffering, PlanState } from '@triton/shared';
import {
  meetingPins,
  midtermPins,
  finalPins,
  slicesFor,
  defaultSliceId,
  todayKey,
  isOnlineModality,
  hasNoLocation,
  weekStartIso,
  weekLabel,
  type MapPin,
} from './map-pins';
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

/** A located exam pin on `date` — for slice tests that only care about when, not where. */
function examPinAt(date: string, over: Partial<MapPin> = {}): MapPin {
  return {
    courseId: 'CSE-8A|2026|2',
    courseCode: 'CSE-8A',
    hue: 231,
    kind: 'midterm',
    label: 'Midterm',
    when: { date, start: '10:00', end: '11:50' },
    building: 'Center Hall',
    place: 'Center Hall',
    room: '109',
    coords: { lat: 32.8779, lng: -117.2415 },
    booked: false,
    ...over,
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
    expect(lab.place).toBeUndefined();
    expect(lab.building).toBe('A Building That Does Not Exist');
  });

  it('carries the official building name next to the raw TSS text', () => {
    // TSS caps the building field at 40 chars; the footprint layer and the
    // popover key on the repaired name, not the truncated one.
    const course = courseWithMeetings();
    const m = course.options[0]!.components[0]!.meetings[0]!;
    m.building = 'Computer Science and Engineering Buildin';
    const lec = meetingPins(planWith(course))[0]!;
    expect(lec.building).toBe('Computer Science and Engineering Buildin');
    expect(lec.place).toBe('Computer Science and Engineering Building');
    expect(lec.coords).not.toBeNull();
  });

  it('marks pins booked only for course ids in the booked set', () => {
    const plan = planWith(courseWithMeetings());
    const none = meetingPins(plan);
    expect(none.every((p) => p.booked === false)).toBe(true);
    const some = meetingPins(plan, new Set(['CSE-8A|2026|2']));
    expect(some.every((p) => p.booked === true)).toBe(true);
  });

  it('carries the meeting modality through, so an online section is not a failed match', () => {
    const course = courseWithMeetings();
    const lab = course.options[0]!.components[1]!.meetings[0]!;
    lab.modality = 'Live Online';
    lab.building = undefined;
    lab.room = undefined;
    const pins = meetingPins(planWith(course));
    expect(pins[0]!.modality).toBe('In Person');
    expect(pins[2]!.modality).toBe('Live Online');
    expect(pins[2]!.coords).toBeNull();
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
    // …and the modality half of that tail, split off, not left glued to the location.
    expect(legacy.modality).toBe('In Person');
    expect(modern.modality).toBe('In Person');
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

describe('isOnlineModality', () => {
  it('recognizes the remote modalities TSS actually emits', () => {
    // "Live Online" is what real Sched lines carry; "Online" is what the site's
    // own Modality filter lists (docs/tss-recon/tss-api-notes.md).
    expect(isOnlineModality('Live Online')).toBe(true);
    expect(isOnlineModality('Online')).toBe(true);
  });

  it('never guesses from In Person, Other, or missing text', () => {
    expect(isOnlineModality('In Person')).toBe(false);
    expect(isOnlineModality('Other')).toBe(false);
    expect(isOnlineModality('Unknown')).toBe(false);
    expect(isOnlineModality(undefined)).toBe(false);
  });
});

describe('hasNoLocation', () => {
  it('is true only when TSS gave no place at all: no building, no raw location, not online', () => {
    const bare = examPinAt('2026-10-31', { building: undefined, place: undefined, room: undefined, rawLocation: undefined, coords: null });
    expect(hasNoLocation(bare)).toBe(true);
  });

  it('is false for a place TSS did give, however it fared on the map', () => {
    // matched and placed
    expect(hasNoLocation(examPinAt('2026-10-31'))).toBe(false);
    // given but not matched to a building
    expect(
      hasNoLocation(
        examPinAt('2026-10-31', { building: 'A Building That Does Not Exist', place: undefined, coords: null, rawLocation: 'A Building That Does Not Exist 000' }),
      ),
    ).toBe(false);
    // only the raw text survived (legacy captures)
    expect(hasNoLocation(examPinAt('2026-10-31', { building: undefined, place: undefined, coords: null, rawLocation: 'TBA' }))).toBe(false);
    // online is its own story, not "no location"
    expect(
      hasNoLocation(examPinAt('2026-10-31', { building: undefined, place: undefined, coords: null, rawLocation: undefined, modality: 'Live Online' })),
    ).toBe(false);
  });
});

describe('slicesFor', () => {
  it('offers All plus the calendar weekday set for weekly meetings', () => {
    const { slices, predicate } = slicesFor(meetingPins(planWith(courseWithMeetings())), 'weekday');
    expect(slices.map((s) => s.id)).toEqual(['all', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(slices[1]!.label).toBe('Mon');

    const pins = meetingPins(planWith(courseWithMeetings()));
    expect(pins.filter(predicate('all'))).toHaveLength(3);
    expect(pins.filter(predicate('Fri'))).toHaveLength(1);
    expect(pins.filter(predicate('Tue'))).toHaveLength(0);
  });

  it('appends a weekend column only when something actually meets then', () => {
    const c = courseWithMeetings();
    c.options[0]!.components[1]!.meetings[0]!.days = ['Sat'];
    const { slices } = slicesFor(meetingPins(planWith(c)), 'weekday');
    expect(slices.map((s) => s.id)).toEqual(['all', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('offers All plus real exam dates for dated pins', () => {
    const { slices, predicate } = slicesFor(finalPins(planWith(courseWithModernFinal())), 'date');
    expect(slices.map((s) => s.id)).toEqual(['all', '2026-12-09']);
    expect(slices[1]!.label).toBe('Dec 09');
    const pins = finalPins(planWith(courseWithModernFinal()));
    expect(pins.filter(predicate('2026-12-09'))).toHaveLength(1);
    expect(pins.filter(predicate('2026-12-10'))).toHaveLength(0);
  });

  it('offers only All when there are no pins', () => {
    expect(slicesFor([], 'weekday').slices.map((s) => s.id)).toEqual(['all']);
  });
});

describe('todayKey', () => {
  it('names today at each granularity: weekday, ISO date, Monday of the week', () => {
    const wed = new Date(2026, 9, 21, 9); // Wed Oct 21 2026
    expect(todayKey('weekday', wed)).toBe('Wed');
    expect(todayKey('date', wed)).toBe('2026-10-21');
    expect(todayKey('week', wed)).toBe('2026-10-19');
  });
});

describe('defaultSliceId', () => {
  it("opens on today's column when today is on the map", () => {
    const pins = meetingPins(planWith(courseWithMeetings()));
    expect(defaultSliceId(slicesFor(pins, 'weekday'), pins, 'Wed')).toBe('Wed');
  });

  it('falls back to All when today has no column', () => {
    const pins = meetingPins(planWith(courseWithMeetings()));
    expect(defaultSliceId(slicesFor(pins, 'weekday'), pins, 'Sun')).toBe('all');
    expect(defaultSliceId(slicesFor([], 'weekday'), [], 'Wed')).toBe('all');
  });

  it('falls back to All on a weekday column that carries no class', () => {
    // visibleDays() renders Mon–Fri whether or not they're used, so a Tue column
    // EXISTS for this MWF course — opening on it would show an empty map above
    // "no class locations to place yet", which is a lie about a located plan.
    const pins = meetingPins(planWith(courseWithMeetings()));
    const sliced = slicesFor(pins, 'weekday');
    expect(sliced.slices.map((s) => s.id)).toContain('Tue');
    expect(pins.some((p) => p.when.weekday === 'Tue')).toBe(false);
    expect(defaultSliceId(sliced, pins, 'Tue')).toBe('all');
  });

  it("opens on today's date when a final falls on it, else All", () => {
    const pins = finalPins(planWith(courseWithModernFinal()));
    const sliced = slicesFor(pins, 'date');
    expect(defaultSliceId(sliced, pins, '2026-12-09')).toBe('2026-12-09');
    expect(defaultSliceId(sliced, pins, '2026-12-10')).toBe('all');
  });

  it("opens on this week's bucket when a midterm falls in it, else All", () => {
    const pins = [examPinAt('2026-10-21'), examPinAt('2026-11-14')];
    const sliced = slicesFor(pins, 'week');
    expect(defaultSliceId(sliced, pins, '2026-10-19')).toBe('2026-10-19');
    expect(defaultSliceId(sliced, pins, '2026-10-26')).toBe('all'); // a week with no exam
  });
});

describe('weekStartIso', () => {
  it('returns the Monday of the week containing the date', () => {
    expect(weekStartIso('2026-10-21')).toBe('2026-10-19'); // Wed → Mon
    expect(weekStartIso('2026-10-19')).toBe('2026-10-19'); // a Monday stays
    expect(weekStartIso('2026-10-25')).toBe('2026-10-19'); // Sunday closes the week that began Oct 19
    expect(weekStartIso('2026-11-01')).toBe('2026-10-26'); // across a month boundary
  });
});

describe('weekLabel', () => {
  it('prints Monday–Sunday with the month once when the week stays inside it', () => {
    expect(weekLabel('2026-10-19')).toBe('Oct 19–25');
    expect(weekLabel('2026-10-05')).toBe('Oct 05–11'); // two-digit days, like the Dec 09 date chips
  });

  it('names both months when the week crosses one', () => {
    expect(weekLabel('2026-10-26')).toBe('Oct 26–Nov 01');
  });
});

describe('slicesFor by week', () => {
  it('buckets dated pins into Monday–Sunday weeks that actually carry an exam', () => {
    const pins = [examPinAt('2026-10-21'), examPinAt('2026-10-25'), examPinAt('2026-11-01')];
    const { slices, predicate } = slicesFor(pins, 'week');
    expect(slices.map((s) => s.id)).toEqual(['all', '2026-10-19', '2026-10-26']);
    expect(slices.map((s) => s.label)).toEqual(['All', 'Oct 19–25', 'Oct 26–Nov 01']);
    expect(pins.filter(predicate('2026-10-19')).map((p) => p.when.date)).toEqual(['2026-10-21', '2026-10-25']);
    expect(pins.filter(predicate('2026-10-26')).map((p) => p.when.date)).toEqual(['2026-11-01']);
    expect(pins.filter(predicate('all'))).toHaveLength(3);
  });

  it('orders weeks by time whatever order the pins arrive in', () => {
    const { slices } = slicesFor([examPinAt('2026-11-14'), examPinAt('2026-10-31')], 'week');
    expect(slices.map((s) => s.id)).toEqual(['all', '2026-10-26', '2026-11-09']);
  });

  it('is only All for pins that carry no date', () => {
    const { slices } = slicesFor(meetingPins(planWith(courseWithMeetings())), 'week');
    expect(slices.map((s) => s.id)).toEqual(['all']);
  });
});
