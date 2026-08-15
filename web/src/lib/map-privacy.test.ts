/**
 * Booked status is device-local. The campus map reads it, so this file exists
 * to keep the map from ever becoming the leak: a plan whose courses are all
 * booked must encode to the same bytes as one with nothing booked, and asking
 * for pins must never grow a new field — of ANY name, not just "booked" — on
 * the plan or its entries. (`entry.course`, the extension-sourced
 * CourseOffering shape, is out of scope here; it has its own surface and its
 * own tests.)
 *
 * All three pin sources take the same `booked` argument, so all three are run
 * through the same assertions — a guard that covered only meetings would leave
 * two doors open.
 */
import { describe, it, expect } from 'vitest';
import type { CourseOffering, PlanState } from '@triton/shared';
import { encodePlan } from './share';
import { finalPins, meetingPins, midtermPins, type MapPin } from './map-pins';

const PLAN_STATE_KEYS = ['version', 'term', 'entries'];
const PLAN_ENTRY_KEYS = ['course', 'selectedOptionId', 'color'];

/**
 * A course carrying all three pin kinds at once: weekly meetings, a final, and
 * (via rawSched) two midterms. Rebuilt on every call so two "identical" plans
 * really are separate objects.
 */
function makeCourse(): CourseOffering {
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
        final: {
          date: '2026-12-09',
          start: '11:30',
          end: '14:29',
          modality: 'In Person',
          location: 'York Hall Room 2622',
          building: 'York Hall',
          room: '2622',
        },
        components: [
          {
            id: 'E-1',
            type: 'LE',
            typeText: 'Lecture',
            sectionCode: 'A00',
            instructors: ['Ada Lovelace'],
            rawSched:
              'M,W 11:00 AM - 11:50 AM In Person @ Center Hall Room 109\n' +
              'Midterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person @ Center Hall Room 109\n' +
              'Midterm Examination 11/14/2026 10:00 AM - 11:50 AM In Person @ Center Hall Room 109',
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
        ],
      },
    ],
  } as CourseOffering;
}

function makeMapPlan(): PlanState {
  const course = makeCourse();
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }],
  };
}

/** Every pin source, each a (plan, booked) → MapPin[] adapter over the same plan. */
const SOURCES: [string, (plan: PlanState, booked?: ReadonlySet<string>) => MapPin[]][] = [
  ['meetingPins', meetingPins],
  ['finalPins', finalPins],
  ['midtermPins', midtermPins],
];

/** Keys present on `obj` that aren't in `allowed` — a subset check, not exact
 *  equality, since e.g. PlanEntry.color is optional and may legitimately be
 *  absent from a given fixture. */
function unexpectedKeys(obj: object, allowed: string[]): string[] {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

describe('booked status never reaches a share payload', () => {
  const allBooked = new Set(['CSE-8A|2026|2']);

  it('the fixture actually exercises all three sources', () => {
    for (const [name, source] of SOURCES) {
      expect(source(makeMapPlan()).length, `${name} produced no pins`).toBeGreaterThan(0);
    }
  });

  for (const [name, source] of SOURCES) {
    describe(name, () => {
      it('encodes identically whether or not the courses are booked', () => {
        const plan = makeMapPlan();
        source(plan, allBooked); // marking pins must not mutate the plan
        expect(encodePlan(plan, 'full')).toBe(encodePlan(makeMapPlan(), 'full'));
        expect(encodePlan(plan, 'lite')).toBe(encodePlan(makeMapPlan(), 'lite'));
      });

      it('never grows an unexpected field on the plan or its entries', () => {
        const plan = makeMapPlan();
        source(plan, allBooked);

        const planKeys = unexpectedKeys(plan, PLAN_STATE_KEYS);
        expect(planKeys, `PlanState grew unexpected key(s): ${planKeys.join(', ')}`).toEqual([]);

        for (const entry of plan.entries) {
          const entryKeys = unexpectedKeys(entry, PLAN_ENTRY_KEYS);
          expect(
            entryKeys,
            `PlanEntry for ${entry.course.id} grew unexpected key(s): ${entryKeys.join(', ')}`,
          ).toEqual([]);
        }
      });

      it('computes booked per call, never caching it onto the pin source', () => {
        const plan = makeMapPlan();
        expect(source(plan).every((p) => p.booked === false)).toBe(true);
        expect(source(plan, allBooked).every((p) => p.booked === true)).toBe(true);
        expect(source(plan).every((p) => p.booked === false)).toBe(true);
      });
    });
  }
});
