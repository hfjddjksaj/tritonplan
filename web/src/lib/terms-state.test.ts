import { describe, it, expect } from 'vitest';
import type { Term } from '@triton/shared';
import {
  newWorkspace, ensureWorkspace, activeWorkspace, updateWorkspace,
  switchTermIn, newestTermKey, allPlansEmpty, adoptSeedPlan, type TermsState,
} from './terms-state';
import { emptyPlan } from './plan';
import { makeCourse } from './fixtures';

const NOW = '2026-08-11T10:00:00.000Z';
const FALL26: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WINTER27: Term = { year: '2027', period: '3', label: '' };

function base(): TermsState {
  const ws = newWorkspace(FALL26, NOW);
  return { version: 1, activeTermKey: '2026|2', terms: { '2026|2': ws } };
}

describe('newWorkspace / ensureWorkspace', () => {
  it('a new workspace has one empty "My plan" with an empty browsed list, bound to the term', () => {
    const ws = newWorkspace(WINTER27, NOW);
    expect(ws.term).toEqual(WINTER27);
    expect(ws.plans.plans).toHaveLength(1);
    expect(ws.plans.plans[0]!.plan.term).toEqual(WINTER27);
    expect(ws.plans.plans[0]!.browsed).toEqual([]);
  });
  it('ensureWorkspace creates once and is a no-op after', () => {
    const s1 = ensureWorkspace(base(), WINTER27, NOW);
    expect(Object.keys(s1.terms).sort()).toEqual(['2026|2', '2027|3']);
    expect(ensureWorkspace(s1, WINTER27, NOW)).toBe(s1);
    expect(s1.activeTermKey).toBe('2026|2'); // ensure does NOT switch the view
  });
});

describe('switchTermIn / newestTermKey', () => {
  it('switch is a no-op for unknown keys and same key', () => {
    const s = base();
    expect(switchTermIn(s, 'nope')).toBe(s);
    expect(switchTermIn(s, '2026|2')).toBe(s);
  });
  it('newestTermKey picks the max chrono index (Winter calendar-2027 beats Fall 2026)', () => {
    const s = ensureWorkspace(base(), WINTER27, NOW);
    expect(newestTermKey(s)).toBe('2027|3');
  });
  it('newestTermKey falls back to latest plan update when no term joins the timeline', () => {
    const a = newWorkspace({ year: '2026', period: '8', label: '' }, '2026-01-01T00:00:00.000Z');
    const b = newWorkspace({ year: '2026', period: '9', label: '' }, '2026-06-01T00:00:00.000Z');
    const s: TermsState = { version: 1, activeTermKey: '2026|8', terms: { '2026|8': a, '2026|9': b } };
    expect(newestTermKey(s)).toBe('2026|9');
  });
});

describe('adoptSeedPlan', () => {
  it('routes an address-bar seed into ITS term workspace, activates it, seeds browsed', () => {
    const course = makeCourse('CSE-100');
    const seed = { ...emptyPlan(FALL26), entries: [{ course, selectedOptionId: null }] };
    const s = adoptSeedPlan(base(), seed, NOW);
    expect(allPlansEmpty(s)).toBe(false);
    const ws = activeWorkspace(s);
    expect(ws.plans.plans[0]!.plan.entries).toHaveLength(1);
    expect(ws.plans.plans[0]!.browsed).toContain(course.id);
  });
});
