/**
 * Booked status is device-local. The campus map reads it, so this file exists
 * to keep the map from ever becoming the leak: a plan whose courses are all
 * booked must encode to the same bytes as one with nothing booked.
 */
import { describe, it, expect } from 'vitest';
import type { PlanState } from '@triton/shared';
import { encodePlan } from './share';
import { makePlan } from './fixtures';
import { meetingPins } from './map-pins';

describe('booked status never reaches a share payload', () => {
  const plan: PlanState = makePlan();
  const allBooked = new Set(plan.entries.map((e) => e.course.id));

  it('encodes identically whether or not the courses are booked', () => {
    meetingPins(plan, allBooked); // marking pins must not mutate the plan
    expect(encodePlan(plan, 'full')).toBe(encodePlan(makePlan(), 'full'));
    expect(encodePlan(plan, 'lite')).toBe(encodePlan(makePlan(), 'lite'));
  });

  it('leaves no booked marker in the plan object itself', () => {
    meetingPins(plan, allBooked);
    expect(JSON.stringify(plan).toLowerCase()).not.toContain('booked');
  });

  it('computes booked per call, never caching it onto the pin source', () => {
    expect(meetingPins(plan).every((p) => p.booked === false)).toBe(true);
    expect(meetingPins(plan, allBooked).every((p) => p.booked === true)).toBe(true);
    expect(meetingPins(plan).every((p) => p.booked === false)).toBe(true);
  });
});
