/**
 * Booked status is device-local. The campus map reads it, so this file exists
 * to keep the map from ever becoming the leak: a plan whose courses are all
 * booked must encode to the same bytes as one with nothing booked, and asking
 * for pins must never grow a new field — of ANY name, not just "booked" — on
 * the plan or its entries. (`entry.course`, the extension-sourced
 * CourseOffering shape, is out of scope here; it has its own surface and its
 * own tests.)
 */
import { describe, it, expect } from 'vitest';
import type { PlanState } from '@triton/shared';
import { encodePlan } from './share';
import { makePlan } from './fixtures';
import { meetingPins } from './map-pins';

const PLAN_STATE_KEYS = ['version', 'term', 'entries'];
const PLAN_ENTRY_KEYS = ['course', 'selectedOptionId', 'color'];

/** Keys present on `obj` that aren't in `allowed` — a subset check, not exact
 *  equality, since e.g. PlanEntry.color is optional and may legitimately be
 *  absent from a given fixture. */
function unexpectedKeys(obj: object, allowed: string[]): string[] {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

describe('booked status never reaches a share payload', () => {
  const plan: PlanState = makePlan();
  const allBooked = new Set(plan.entries.map((e) => e.course.id));

  it('encodes identically whether or not the courses are booked', () => {
    meetingPins(plan, allBooked); // marking pins must not mutate the plan
    expect(encodePlan(plan, 'full')).toBe(encodePlan(makePlan(), 'full'));
    expect(encodePlan(plan, 'lite')).toBe(encodePlan(makePlan(), 'lite'));
  });

  it('never grows an unexpected field on the plan or its entries', () => {
    meetingPins(plan, allBooked);

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
    expect(meetingPins(plan).every((p) => p.booked === false)).toBe(true);
    expect(meetingPins(plan, allBooked).every((p) => p.booked === true)).toBe(true);
    expect(meetingPins(plan).every((p) => p.booked === false)).toBe(true);
  });
});
