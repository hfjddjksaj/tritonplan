import { describe, it, expect } from 'vitest';
import type { CourseOffering, PlanState } from '@triton/shared';
import LZString from 'lz-string';
import { encodePlan, decodePlan, planToMirrorHash, mirrorTokenFromHash, readHash } from './share';
import { makePlan } from './fixtures';

/** A realistic course: two sections, meetings, a final, extra debug fields. */
function richCourse(): CourseOffering {
  const meeting = (days: ('Tue' | 'Thu' | 'Mon')[]) => ({
    days,
    start: '11:00',
    end: '12:20',
    modality: 'In Person',
    building: 'Galbraith Hall',
    room: '242',
    location: 'Galbraith Hall Room 242',
  });
  const comp = (id: string) => ({
    id,
    type: 'LE' as const,
    typeText: 'Lecture',
    sectionCode: '001-000-LE',
    instructors: ['Leo Porter'],
    instructorEmails: ['leporter@ucsd.edu'],
    meetings: [meeting(['Tue', 'Thu'])],
    unscheduled: false,
    rawSched: 'Tu, Th 11:00 AM - 12:20 PM In Person @ Galbraith Hall Room 242',
  });
  return {
    id: 'CSE-008A|2026|2',
    moduleId: '8461',
    subject: 'CSE',
    number: '008A',
    courseCode: 'CSE-008A',
    title: 'Introduction to Programming',
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    units: 4,
    options: [
      {
        id: 'SE00154302',
        code: 'P-001-001',
        enrollCode: 'SE00154302',
        limit: 15,
        seatsAvailable: 3,
        components: [comp('E1')],
        final: { date: '2026-12-09', start: '11:30', end: '14:29', modality: 'In Person' },
      },
      {
        id: 'SE00154303',
        code: 'P-001-002',
        enrollCode: 'SE00154303',
        limit: 15,
        seatsAvailable: 0,
        components: [comp('E2')],
      },
    ],
  };
}

function richPlan(): PlanState {
  const course = richCourse();
  return {
    version: 1,
    term: course.term,
    entries: [{ course, selectedOptionId: 'SE00154302', color: '231' }],
  };
}

describe('slim share round-trip', () => {
  it('preserves everything needed to render the chosen section', () => {
    const plan = richPlan();
    const back = decodePlan(encodePlan(plan, 'lite'))!;
    expect(back).not.toBeNull();
    const src = plan.entries[0]!;
    const got = back.entries[0]!;

    expect(back.term).toEqual(plan.term);
    expect(got.color).toBe(src.color);
    expect(got.course.courseCode).toBe('CSE-008A');
    expect(got.course.title).toBe(src.course.title);
    expect(got.course.units).toBe(4);
    expect(got.course.moduleId).toBe('8461');
    expect(got.course.subject).toBe('CSE');
    expect(got.course.number).toBe('008A');

    const opt = got.course.options.find((o) => o.id === got.selectedOptionId)!;
    expect(opt.code).toBe('P-001-001');
    expect(opt.enrollCode).toBe('SE00154302');
    expect(opt.seatsAvailable).toBe(3);
    expect(opt.limit).toBe(15);
    expect(opt.final).toEqual({ date: '2026-12-09', start: '11:30', end: '14:29', modality: 'In Person' });
    expect(opt.components[0]!.meetings[0]).toEqual({
      days: ['Tue', 'Thu'],
      start: '11:00',
      end: '12:20',
      modality: 'In Person',
      building: 'Galbraith Hall',
      room: '242',
      location: 'Galbraith Hall Room 242',
    });
    expect(opt.components[0]!.typeText).toBe('Lecture');
    expect(opt.components[0]!.unscheduled).toBe(false);
  });

  it('carries only the selected section (drops the others)', () => {
    const plan = richPlan(); // course has 2 options; SE00154302 selected
    const back = decodePlan(encodePlan(plan, 'lite'))!;
    expect(back.entries[0]!.course.options).toHaveLength(1);
    expect(back.entries[0]!.course.options[0]!.enrollCode).toBe('SE00154302');
  });

  it('is dramatically shorter than encoding the full plan', () => {
    const plan = richPlan();
    const slim = encodePlan(plan, 'lite').length;
    const full = LZString.compressToEncodedURIComponent(JSON.stringify(plan)).length;
    expect(slim).toBeLessThan(full * 0.7);
  });

  it('returns null for a corrupt or empty token', () => {
    expect(decodePlan('!!!not-valid!!!')).toBeNull();
    expect(decodePlan('')).toBeNull();
  });

  it('marks a component with no meetings as unscheduled on restore', () => {
    const plan = richPlan();
    plan.entries[0]!.course.options[0]!.components[0]!.meetings = [];
    const back = decodePlan(encodePlan(plan, 'lite'))!;
    expect(back.entries[0]!.course.options[0]!.components[0]!.unscheduled).toBe(true);
  });
});

describe('backward compatibility', () => {
  it('still opens a legacy full-format share link', () => {
    // old links encoded the whole PlanState verbatim
    const plan = makePlan();
    const legacyToken = LZString.compressToEncodedURIComponent(JSON.stringify(plan));
    expect(decodePlan(legacyToken)).toEqual(plan);
  });
});

describe('v3 full format via the share.ts API', () => {
  it('full links round-trip through decodePlan with every option intact', () => {
    const plan = richPlan(); // course has 2 options
    const token = encodePlan(plan, 'full');
    const back = decodePlan(token)!;
    expect(back.entries[0]!.course.options.length).toBe(plan.entries[0]!.course.options.length);
  });
});

/**
 * Regression: the address-bar mirror wrote `#p=…` — the very same key a share
 * link used — and told the two apart with a sessionStorage echo marker. A
 * bookmark always opens in a FRESH tab, where sessionStorage is empty, so the
 * user's own mirrored plan came back every time as "this is not your plan".
 * The mirror has its own `#m=` key, which needs no per-tab state.
 */
describe('reading a location hash', () => {
  it('writes the mirror under its own key, never read as a share link', () => {
    const hash = `#${planToMirrorHash(richPlan())}`;
    expect(hash.startsWith('#m=')).toBe(true);
    expect(readHash(hash, []).kind).toBe('mirror');
    expect(decodePlan(mirrorTokenFromHash(hash)!)).toEqual(decodePlan(encodePlan(richPlan())));
  });

  it('reads our own mirror as mine in a fresh tab — no echo marker needed', () => {
    const mine = decodePlan(encodePlan(richPlan()))!;
    expect(readHash(`#${planToMirrorHash(richPlan())}`, [makePlan(), mine])).toEqual({ kind: 'mine', index: 1 });
  });

  /*
   * The URL is the plan. A bookmarked #m= opened on a device that already holds
   * OTHER plans (an iPad with old test plans) used to be read as "mine" and then
   * overwritten by the device's own active plan — the bookmark's plan was lost,
   * and a copied address-bar link showed the recipient their own plan.
   */
  it('reads a #m= mirror that matches none of my plans as a foreign mirror, never as mine', () => {
    const hash = `#${planToMirrorHash(richPlan())}`;
    expect(readHash(hash, [makePlan()]).kind).toBe('mirror');
    expect(readHash(hash, []).kind).toBe('mirror');
  });

  it('reads every #p= as a share link: even one re-encoding a plan I hold, or one that does not decode', () => {
    const mine = decodePlan(encodePlan(richPlan()))!;
    expect(readHash(`#p=${encodePlan(mine)}`, [mine]).kind).toBe('share');
    expect(readHash(`#p=${encodePlan(richPlan(), 'lite')}`, []).kind).toBe('share');
    expect(readHash('p=abc', []).kind).toBe('share');
    expect(readHash('#p=@@@', []).kind).toBe('share');
  });

  it('ignores an absent hash, another key, and a #m= that does not decode', () => {
    expect(readHash('', []).kind).toBe('ignore');
    expect(readHash('#other=1', []).kind).toBe('ignore');
    expect(readHash('#m=@@@', []).kind).toBe('ignore');
  });
});
