import { describe, it, expect } from 'vitest';
import type { PlanState, Term } from '@triton/shared';
import { makeCourse } from './fixtures';
import { newWorkspace, type TermsState, type TermWorkspace } from './terms-state';
import { mapTerms } from './map-terms';

const FALL26: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WINTER26: Term = { year: '2026', period: '3', label: 'Winter 2026' };
const FALL25: Term = { year: '2025', period: '2', label: 'Fall 2025' };
const NOW = new Date(2026, 10, 7); // Fall 2026 is live; Fall 2025 archived last December

/** A workspace whose active plan holds `codes` (none: the empty plan a new term starts with). */
function ws(term: Term, codes: string[], booked: string[] = []): TermWorkspace {
  const w = newWorkspace(term, '2026-11-07T00:00:00.000Z');
  const named = w.plans.plans[0]!;
  const entries = codes.map((c) => {
    const course = makeCourse(`${c}|${term.year}|${term.period}`, c);
    return { course, selectedOptionId: course.options[0]?.id ?? null };
  });
  return {
    ...w,
    plans: { ...w.plans, plans: [{ ...named, plan: { ...named.plan, entries } }] },
    bookedOn: booked,
  };
}

function state(active: Term, ...spaces: TermWorkspace[]): TermsState {
  return {
    version: 1,
    activeTermKey: `${active.year}|${active.period}`,
    terms: Object.fromEntries(spaces.map((s) => [`${s.term.year}|${s.term.period}`, s])),
  };
}

/** What the planner has on view — the map opens on it. */
function view(term: Term, entries = 1): { plan: PlanState; booked: ReadonlySet<string>; readOnly: boolean } {
  const plan: PlanState = {
    version: 1,
    term,
    entries: Array.from({ length: entries }, (_, i) => {
      const course = makeCourse(`VIEW-${i}|${term.year}|${term.period}`);
      return { course, selectedOptionId: null };
    }),
  };
  return { plan, booked: new Set(['VIEW-0']), readOnly: false };
}

describe('mapTerms', () => {
  it('lists every term whose active plan has a course, oldest first', () => {
    const s = state(WINTER26, ws(WINTER26, ['CSE-12']), ws(FALL26, ['CSE-8A', 'MATH-18']));
    const terms = mapTerms(s, view(WINTER26), NOW);
    expect(terms.map((t) => t.key)).toEqual(['2026|2', '2026|3']);
  });

  it('carries each other term’s own active plan and enrolment', () => {
    const s = state(WINTER26, ws(WINTER26, ['CSE-12']), ws(FALL26, ['CSE-8A', 'MATH-18'], ['CSE-8A|2026|2']));
    const fall = mapTerms(s, view(WINTER26), NOW).find((t) => t.key === '2026|2')!;
    expect(fall.plan.entries.map((e) => e.course.courseCode)).toEqual(['CSE-8A', 'MATH-18']);
    expect([...fall.booked]).toEqual(['CSE-8A|2026|2']);
    expect(fall.archived).toBe(false);
  });

  it('uses the planner’s own view for the term on view, not the stored workspace', () => {
    // The view is what the map opens on and what the planner shows; for a shared
    // plan it is not in the account's workspaces at all.
    const v = view(WINTER26, 3);
    const s = state(WINTER26, ws(WINTER26, ['CSE-12']), ws(FALL26, ['CSE-8A']));
    const winter = mapTerms(s, v, NOW).find((t) => t.key === '2026|3')!;
    expect(winter.plan).toBe(v.plan);
    expect(winter.booked).toBe(v.booked);
  });

  it('skips a term whose active plan is empty, but always keeps the term on view', () => {
    const s = state(WINTER26, ws(WINTER26, []), ws(FALL26, []));
    expect(mapTerms(s, view(WINTER26, 0), NOW).map((t) => t.key)).toEqual(['2026|3']);
  });

  it('marks an archived term', () => {
    const s = state(FALL26, ws(FALL26, ['CSE-8A']), ws(FALL25, ['CSE-11']));
    const terms = mapTerms(s, view(FALL26), NOW);
    expect(terms.map((t) => [t.key, t.archived])).toEqual([
      ['2025|2', true],
      ['2026|2', false],
    ]);
  });

  it('is just the view when the account has no workspaces (a shared plan)', () => {
    const s: TermsState = { version: 1, activeTermKey: '2026|2', terms: {} };
    expect(mapTerms(s, view(FALL26), NOW).map((t) => t.key)).toEqual(['2026|2']);
  });
});
