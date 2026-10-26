import { describe, it, expect } from 'vitest';
import type { PlanState, Term } from '@triton/shared';
import type { NamedPlan } from '../plans';
import type { TermsState } from '../terms-state';
import { assembleTerms, splitTerms } from './records';

const FA: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WI: Term = { year: '2027', period: '3', label: 'Winter 2027' };
const ps = (term: Term): PlanState => ({ version: 1, term, entries: [] });
const np = (id: string, term: Term, extra: Partial<NamedPlan> = {}): NamedPlan =>
  ({ id, name: id, plan: ps(term), createdAt: 'c', updatedAt: 'u', browsed: ['x'], ...extra });

function multi(): TermsState {
  return {
    version: 1,
    activeTermKey: '2027|3',
    terms: {
      '2026|2': {
        term: FA,
        plans: { activeId: 'b', plans: [np('a', FA), np('b', FA)] },
        bookedAuto: ['A'], bookedOn: ['B'], bookedOff: [], waitlistedAuto: ['C'],
      },
      '2027|3': { term: WI, plans: { activeId: 'c', plans: [np('c', WI)] } },
    },
  };
}

describe('splitTerms / assembleTerms', () => {
  it('split → assemble round-trips a multi-term state', () => {
    const state = multi();
    const { terms, plans } = splitTerms(state);
    expect(Object.keys(plans).sort()).toEqual(['a', 'b', 'c']);
    expect(plans.a).toEqual({ termKey: '2026|2', plan: state.terms['2026|2']!.plans.plans[0] });
    expect(terms['2026|2']).not.toHaveProperty('plans');
    expect(terms['2027|3']).not.toHaveProperty('bookedAuto'); // absent stays absent
    expect(terms['2026|2']!.bookedOff).toEqual([]); // empty stays empty
    expect(assembleTerms(terms, plans)).toEqual(state);
  });

  it('returns null when there are no terms', () => {
    expect(assembleTerms({}, {})).toBeNull();
  });

  it('orders plans by planOrder and appends unlisted ones', () => {
    const { terms, plans } = splitTerms(multi());
    terms['2026|2']!.planOrder = ['b'];
    const out = assembleTerms(terms, plans)!;
    expect(out.terms['2026|2']!.plans.plans.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('skips planOrder ids that have no plan record', () => {
    const { terms, plans } = splitTerms(multi());
    terms['2026|2']!.planOrder = ['ghost', 'a', 'b'];
    expect(assembleTerms(terms, plans)!.terms['2026|2']!.plans.plans.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('assemble repairs: orphan plan gets a workspace, empty term dropped, dangling activeId fixed', () => {
    const { terms, plans } = splitTerms(multi());
    plans.z = { termKey: '2028|2', plan: np('z', { year: '2028', period: '2', label: 'Fall 2028' }) };
    delete plans.c; // winter now has meta but no plans
    terms['2026|2']!.activeId = 'gone';
    const out = assembleTerms(terms, plans)!;
    expect(Object.keys(out.terms).sort()).toEqual(['2026|2', '2028|2']);
    expect(out.terms['2028|2']!.term.label).toBe('Fall 2028');
    expect(out.terms['2028|2']!.plans.activeId).toBe('z');
    expect(out.terms['2026|2']!.plans.activeId).toBe('a');
    expect(out.activeTermKey).toBe('2028|2'); // newest
  });

  it('returns null when every term ends up empty', () => {
    const { terms } = splitTerms(multi());
    expect(assembleTerms(terms, {})).toBeNull();
  });

  it('does not mutate its inputs', () => {
    const { terms, plans } = splitTerms(multi());
    terms['2026|2']!.activeId = 'gone';
    const before = JSON.stringify({ terms, plans });
    assembleTerms(terms, plans);
    expect(JSON.stringify({ terms, plans })).toBe(before);
  });
});
