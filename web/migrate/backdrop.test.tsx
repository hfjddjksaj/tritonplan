import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { CourseOffering, PlanState, Term } from '@triton/shared';
import { makeCourse } from '../src/lib/fixtures';
import type { MigrationPayload } from '../src/lib/migration';
import type { NamedPlan } from '../src/lib/plans';
import type { TermsState } from '../src/lib/terms-state';
import { mountBackdrop } from './backdrop';
import { backdropView } from './backdrop-view';

const NOW = '2026-10-26T15:00:00.000Z';
const FALL: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WINTER: Term = { year: '2027', period: '0', label: 'Winter 2027' };

/** A course whose one option meets MWF 10:00–10:50, so it lands on the grid. */
function scheduled(code: string, term = FALL): CourseOffering {
  const c = makeCourse(`${code}|${term.year}|${term.period}`, code);
  c.term = term;
  c.options[0]!.components = [
    {
      id: `${code}-le`, type: 'LE', typeText: 'Lecture', sectionCode: '001-000-LE', instructors: [],
      meetings: [{ days: ['Mon', 'Wed', 'Fri'], start: '10:00', end: '10:50', modality: 'In Person' }],
      unscheduled: false, rawSched: '',
    },
  ];
  return c;
}

function plan(term: Term, ...courses: CourseOffering[]): PlanState {
  return { version: 1, term, entries: courses.map((c) => ({ course: c, selectedOptionId: c.options[0]!.id })) };
}

function named(id: string, p: PlanState, browsed: string[] = []): NamedPlan {
  return { id, name: id, plan: p, createdAt: NOW, updatedAt: NOW, browsed };
}

function payload(over: Partial<MigrationPayload> = {}): MigrationPayload {
  return {
    kind: 'tritonplan-migration', version: 1, exportedAt: NOW,
    terms: null, plans: null, plan: null, pool: [], appt: null, received: null, hashPlan: null,
    ...over,
  };
}

const codes = (p: PlanState) => p.entries.map((e) => e.course.courseCode);

describe('backdropView', () => {
  const cse = scheduled('CSE-8A');
  const math = scheduled('MATH-20A');
  const hum = scheduled('HUM-1', WINTER);
  const terms: TermsState = {
    version: 1,
    activeTermKey: '2027|0',
    terms: {
      '2026|2': { term: FALL, plans: { activeId: 'a', plans: [named('a', plan(FALL, cse)), named('b', plan(FALL, math))] } },
      '2027|0': {
        term: WINTER,
        plans: { activeId: 'w', plans: [named('w', plan(WINTER, hum), [hum.id, 'PHYS-2A|2027|0', 'gone'])] },
        bookedAuto: [hum.id],
      },
    },
  };
  const phys = makeCourse('PHYS-2A|2027|0', 'PHYS-2A');

  test('the active plan of the active term, with its term-mates, browsed list and booked marks', () => {
    const v = backdropView(payload({ terms, pool: [hum, phys] }), NOW);
    expect(codes(v.plan)).toEqual(['HUM-1']);
    expect(v.activeId).toBe('w');
    expect(v.plans.map((p) => p.id)).toEqual(['w']);
    expect(v.terms.map((t) => t.label)).toEqual(['Fall 2026', 'Winter 2027']);
    // added courses and ids missing from the pool are not "browsed"
    expect(v.browsed.map((c) => c.courseCode)).toEqual(['PHYS-2A']);
    expect([...v.booked]).toEqual([hum.id]);
  });

  test('a #m= bookmark opens the plan it matches, in whichever term', () => {
    const v = backdropView(payload({ terms, hashPlan: plan(FALL, math) }), NOW);
    expect(v.activeId).toBe('b');
    expect(v.plans.map((p) => p.id)).toEqual(['a', 'b']);
    expect(codes(v.plan)).toEqual(['MATH-20A']);
  });

  test('an unmatched #m= plan seeds a browser with nothing of its own, and is ignored otherwise', () => {
    const seed = plan(FALL, math);
    expect(codes(backdropView(payload({ hashPlan: seed }), NOW).plan)).toEqual(['MATH-20A']);
    expect(codes(backdropView(payload({ terms, hashPlan: plan(FALL, scheduled('BILD-1')) }), NOW).plan)).toEqual([
      'HUM-1',
    ]);
  });

  test('the pre-terms plan:v1 key alone still yields its plan', () => {
    expect(codes(backdropView(payload({ plan: plan(FALL, cse, math) }), NOW).plan)).toEqual(['CSE-8A', 'MATH-20A']);
  });
});

describe('mountBackdrop', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test("draws the old planner behind the page, inert and hidden from assistive tech", async () => {
    await act(async () => {
      mountBackdrop(document, payload({ plan: plan(FALL, scheduled('CSE-8A')) }), NOW);
    });
    const host = document.body.firstElementChild as HTMLElement;
    expect(host.className).toBe('moved-backdrop');
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.inert).toBe(true);
    expect(host.nextElementSibling?.id).toBe('app');
    expect(host.querySelector('.topbar')?.textContent).toContain('Fall 2026');
    expect(host.querySelector('.rail')?.textContent).toContain('CSE-8A');
    expect(host.querySelectorAll('.cal-canvas .block')).toHaveLength(3); // Mon, Wed, Fri
    // a picture only: nothing written to the old site's storage
    expect(localStorage.length).toBe(0);
  });
});
