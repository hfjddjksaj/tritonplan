import { describe, expect, it } from 'vitest';
import { V3_PREFIX, decodePlanV3, encodePlanV3 } from './share-v3';
import { makePlan } from './share-v3.test-helpers';

describe('encodePlanV3 / decodePlanV3', () => {
  it('round-trips ALL section options, selection, prereqs and capturedAt', () => {
    const plan = makePlan(3, 5);
    const token = encodePlanV3(plan);
    expect(token.startsWith(V3_PREFIX)).toBe(true);
    const back = decodePlanV3(token);
    expect(back).not.toBeNull();
    expect(back!.entries).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const src = plan.entries[i]!;
      const dst = back!.entries[i]!;
      expect(dst.course.options).toHaveLength(5); // full fidelity: every option survives
      expect(dst.selectedOptionId).toBe(src.selectedOptionId);
      expect(dst.color).toBe(src.color);
      expect(dst.course.courseCode).toBe(src.course.courseCode);
      expect(dst.course.units).toBe(4);
      expect(dst.course.capturedAt).toBe('2026-07-24T10:00:00.000Z');
      expect(dst.course.prereqs).toEqual(src.course.prereqs);
      const o = dst.course.options[2]!;
      const so = src.course.options[2]!;
      expect(o.enrollCode).toBe(so.enrollCode);
      expect(o.seatsAvailable).toBe(so.seatsAvailable);
      expect(o.limit).toBe(so.limit);
      expect(o.final).toEqual(so.final);
      expect(o.components.map((c) => c.sectionCode)).toEqual(so.components.map((c) => c.sectionCode));
      expect(o.components[0]!.meetings).toEqual(so.components[0]!.meetings);
    }
  });

  it('shares one lecture component object across options (dedup by component id)', () => {
    const back = decodePlanV3(encodePlanV3(makePlan(1, 4)))!;
    const opts = back.entries[0]!.course.options;
    expect(opts[0]!.components[0]).toBe(opts[3]!.components[0]); // same reference = table dedup worked
  });

  it('preserves an empty prereqs array ([] = confirmed none) and absent prereqs (undefined)', () => {
    const plan = makePlan(2, 2);
    plan.entries[0]!.course.prereqs = [];
    delete plan.entries[1]!.course.prereqs;
    const back = decodePlanV3(encodePlanV3(plan))!;
    expect(back.entries[0]!.course.prereqs).toEqual([]);
    expect(back.entries[1]!.course.prereqs).toBeUndefined();
  });

  it('keeps a 5-course / all-options plan comfortably inside the QR budget', () => {
    const token = encodePlanV3(makePlan(5, 8));
    expect(token.length).toBeLessThan(2500); // measured prototype: ~1.8K for this density
  });

  it('rejects garbage tokens', () => {
    expect(decodePlanV3('3~not-base64!!!')).toBeNull();
    expect(decodePlanV3('nonsense')).toBeNull();
  });
});
