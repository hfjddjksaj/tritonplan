import { describe, expect, it } from 'vitest';
import type { Component, CourseOffering, PlanState } from '@triton/shared';
import { makeCourse, makePlan } from './fixtures';
import { entryHue } from './plan';
import { walkPlaces } from './walk-places';

/** Fills in the two housekeeping fields every Component carries but no case here cares about. */
const component = (
  c: Omit<Component, 'sectionCode' | 'instructors' | 'unscheduled' | 'rawSched'> & Partial<Component>,
): Component => ({ sectionCode: 'A00', instructors: [], unscheduled: false, rawSched: '', ...c });

/**
 * fixtures.ts's makeCourse() is deliberately schedule-less, so the meetings,
 * midterm and final each case needs are bolted onto it here — the same thing
 * map-pins.test.ts does, and for the same reason: real building names have to
 * reach the real matcher for `coords` to mean anything.
 */
function cse8a(): CourseOffering {
  const course = makeCourse('CSE-8A|2026|2', 'CSE-8A');
  const option = course.options[0]!;
  option.components = [
    component({
      id: 'E-1',
      type: 'LE',
      typeText: 'Lecture',
      // Three weekdays in one room: the case the dedupe exists for.
      meetings: [
        {
          days: ['Mon', 'Wed', 'Fri'],
          start: '11:00',
          end: '11:50',
          modality: 'In Person',
          building: 'Center Hall',
          room: '109',
          location: 'Center Hall 109',
        },
      ],
      rawSched: 'Midterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person @ Center Hall Room 109',
    }),
    component({
      id: 'E-2',
      type: 'LA',
      typeText: 'Laboratory',
      // A building the GIS layer has never heard of.
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
    }),
    component({
      id: 'E-3',
      type: 'DI',
      typeText: 'Discussion',
      meetings: [{ days: ['Tue'], start: '09:00', end: '09:50', modality: 'Live Online' }],
    }),
  ];
  option.final = {
    date: '2026-12-09',
    start: '11:30',
    end: '14:29',
    modality: 'In Person',
    location: 'York Hall Room 2622',
    building: 'York Hall',
    room: '2622',
  };
  return course;
}

/** A second course lecturing in the SAME building as the first. */
function math20c(): CourseOffering {
  const course = makeCourse('MATH-20C|2026|2', 'MATH-20C');
  course.options[0]!.components = [
    component({
      id: 'E-9',
      type: 'LE',
      typeText: 'Lecture',
      meetings: [
        {
          days: ['Tue', 'Thu'],
          start: '08:00',
          end: '08:50',
          modality: 'In Person',
          building: 'Center Hall',
          room: '115',
        },
      ],
    }),
  ];
  return course;
}

function planWith(...courses: CourseOffering[]): PlanState {
  const colors = ['231', '12'];
  return {
    ...makePlan(),
    entries: courses.map((course, i) => ({
      course,
      selectedOptionId: course.options[0]!.id,
      color: colors[i],
    })),
  };
}

describe('walkPlaces', () => {
  const plan = planWith(cse8a(), math20c());
  const places = walkPlaces(plan);

  it('lists a course once per component, not once per weekday', () => {
    const ids = places.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The MWF lecture is one place a student walks to, not three.
    const lectures = places.filter((p) => p.courseCode === 'CSE-8A' && p.label === 'LEC');
    expect(lectures).toHaveLength(1);
    expect(lectures[0]!.place).toBe('Center Hall');
    expect(lectures[0]!.coords).not.toBeNull();
  });

  it('splits one course into separate entries when its components differ in building', () => {
    const cse = places.filter((p) => p.courseCode === 'CSE-8A');
    expect(cse.map((p) => p.label)).toContain('LEC');
    expect(cse.map((p) => p.label)).toContain('LAB');
    const lec = cse.find((p) => p.label === 'LEC')!;
    const lab = cse.find((p) => p.label === 'LAB')!;
    expect(lab.id).not.toBe(lec.id);
  });

  it('keeps two courses that share a building apart', () => {
    const inCenterHall = places.filter((p) => p.place === 'Center Hall' && p.label === 'LEC');
    expect(inCenterHall.map((p) => p.courseCode).sort()).toEqual(['CSE-8A', 'MATH-20C']);
    expect(new Set(inCenterHall.map((p) => p.id)).size).toBe(2);
  });

  it('merges classes, midterms and finals into one list, whatever the map is showing', () => {
    // A distance does not depend on which view the reader happens to be on.
    const labels = places.filter((p) => p.courseCode === 'CSE-8A').map((p) => p.label);
    expect(labels).toEqual(expect.arrayContaining(['LEC', 'LAB', 'DIS', 'Midterm', 'Final']));
  });

  it('keeps unusable entries but marks them disabled with a reason', () => {
    for (const p of places) {
      if (p.coords === null) {
        expect(p.disabled).toBe(true);
        expect(p.disabledReason).toBeDefined();
      } else {
        expect(p.disabled).toBe(false);
        expect(p.disabledReason).toBeUndefined();
      }
    }
    // …and the reason separates "meets online" from "we could not place it".
    expect(places.find((p) => p.label === 'DIS')!.disabledReason).toBe('online');
    expect(places.find((p) => p.label === 'LAB')!.disabledReason).toBe('no-location');
  });

  it('carries the course hue, so a swatch matches the calendar block', () => {
    const cse = places.find((p) => p.courseCode === 'CSE-8A')!;
    const math = places.find((p) => p.courseCode === 'MATH-20C')!;
    expect(cse.hue).toBe(entryHue(plan, plan.entries[0]!));
    expect(math.hue).toBe(entryHue(plan, plan.entries[1]!));
    expect(cse.hue).not.toBe(math.hue);
  });

  it('gives every entry a stable id that survives a re-derivation', () => {
    const again = walkPlaces(planWith(cse8a(), math20c()));
    expect(again.map((p) => p.id)).toEqual(places.map((p) => p.id));
  });

  it('is empty for an empty plan, not throwing', () => {
    expect(walkPlaces({ ...makePlan(), entries: [] })).toEqual([]);
  });
});
