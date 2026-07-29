import { describe, expect, it } from 'vitest';
import { deflateSync, strToU8 } from 'fflate';
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

  it('carries midterms derived from rawSched (receiver has no rawSched to derive from)', () => {
    const plan = makePlan(2, 2);
    // Give course 0's lecture (shared across options) a real midterm line.
    for (const o of plan.entries[0]!.course.options) {
      o.components[0]!.rawSched +=
        '\nMidterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person';
    }
    const back = decodePlanV3(encodePlanV3(plan))!;
    for (const o of back.entries[0]!.course.options) {
      expect(o.midterms).toEqual([
        { date: '2026-10-31', start: '10:00', end: '11:50', modality: 'In Person' },
      ]);
    }
    // Course 1 has none — decoded options carry no midterms field.
    expect(back.entries[1]!.course.options[0]!.midterms).toBeUndefined();
  });

  it('still decodes pre-midterms tokens (6-element option arrays)', () => {
    // A wire plan exactly as the previous encoder wrote it — no 7th opt element.
    const oldWire = {
      v: 3,
      y: '2026',
      p: '2',
      l: 'Fall 2026',
      e: [
        {
          c: 'TEST-100',
          ti: 'Test Course',
          mi: '2000',
          x: [['LE', 'Lecture', '001-000', [], []]],
          o: [['P-001-001', 'SE001', -1, -1, 0, [0]]],
          si: 0,
        },
      ],
    };
    const packed = deflateSync(strToU8(JSON.stringify(oldWire)), { level: 9 });
    let bin = '';
    for (const b of packed) bin += String.fromCharCode(b);
    const token = V3_PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const back = decodePlanV3(token);
    expect(back).not.toBeNull();
    expect(back!.entries[0]!.course.options[0]!.midterms).toBeUndefined();
  });
});
