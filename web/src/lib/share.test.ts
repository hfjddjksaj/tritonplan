import { describe, it, expect } from 'vitest';
import type { CourseOffering, PlanState } from '@triton/shared';
import LZString from 'lz-string';
import {
  encodePlan,
  decodePlan,
  planToHash,
  planFromHash,
  planFromLinkText,
  shareUrl,
  parsePlanJson,
} from './share';
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
    const back = decodePlan(encodePlan(plan))!;
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
    const back = decodePlan(encodePlan(plan))!;
    expect(back.entries[0]!.course.options).toHaveLength(1);
    expect(back.entries[0]!.course.options[0]!.enrollCode).toBe('SE00154302');
  });

  it('is dramatically shorter than encoding the full plan', () => {
    const plan = richPlan();
    const slim = encodePlan(plan).length;
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
    const back = decodePlan(encodePlan(plan))!;
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

describe('hash helpers', () => {
  it('round-trips a render-equivalent plan through a location hash', () => {
    const plan = richPlan();
    const hash = `#${planToHash(plan)}`;
    expect(hash.startsWith('#p=')).toBe(true);
    const back = planFromHash(hash)!;
    expect(back.entries[0]!.course.courseCode).toBe('CSE-008A');
    expect(back.entries[0]!.selectedOptionId).toBe('SE00154302');
  });

  it('returns null when the hash has no plan token', () => {
    expect(planFromHash('')).toBeNull();
    expect(planFromHash('#foo=bar')).toBeNull();
  });

  it('builds an absolute share URL carrying the plan', () => {
    const plan = richPlan();
    const url = shareUrl(plan, 'https://plan.example/app/');
    expect(url.startsWith('https://plan.example/app/#p=')).toBe(true);
    expect(planFromHash(new URL(url).hash)!.entries[0]!.course.courseCode).toBe('CSE-008A');
  });
});

describe('planFromLinkText — pasted share links', () => {
  it('accepts a full URL, a hash fragment, and a bare token', () => {
    const plan = richPlan();
    const url = shareUrl(plan, 'https://plan.example/app/');
    const token = encodePlan(plan);
    for (const text of [url, `#p=${token}`, `p=${token}`, token, `  ${url}  `]) {
      const parsed = planFromLinkText(text);
      expect(parsed, `failed for: ${text.slice(0, 30)}`).not.toBeNull();
      expect(parsed!.entries[0]!.course.courseCode).toBe('CSE-008A');
    }
  });

  it('rejects garbage and empty input', () => {
    expect(planFromLinkText('')).toBeNull();
    expect(planFromLinkText('   ')).toBeNull();
    expect(planFromLinkText('hello world')).toBeNull();
    expect(planFromLinkText('https://plan.example/app/')).toBeNull();
    expect(planFromLinkText('https://plan.example/app/#other=1')).toBeNull();
  });
});

describe('parsePlanJson (full import, unchanged)', () => {
  it('parses a valid plan and rejects junk', () => {
    const plan = makePlan();
    expect(parsePlanJson(JSON.stringify(plan))).toEqual(plan);
    expect(parsePlanJson('{"nope":true}')).toBeNull();
    expect(parsePlanJson('not json')).toBeNull();
  });
});
