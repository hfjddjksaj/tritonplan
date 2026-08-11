import { describe, it, expect } from 'vitest';
import type { Term } from '@triton/shared';
import {
  newWorkspace, ensureWorkspace, activeWorkspace, updateWorkspace,
  switchTermIn, newestTermKey, allPlansEmpty, adoptSeedPlan, migrateToTermsState,
  archiveSweep, routeCapture, type TermsState,
} from './terms-state';
import { emptyPlan } from './plan';
import { makeCourse } from './fixtures';
import {
  migratePlans, addPlan, addBrowsed, updateActivePlan,
  type PlansState,
} from './plans';

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

describe('migrateToTermsState', () => {
  it('groups a flat PlansState by each plan term and keeps activeId within its workspace', () => {
    const fall = { ...emptyPlan(FALL26), entries: [] };
    let flat = migratePlans(null, fall, NOW);           // "My plan" (Fall)
    flat = addPlan(flat, emptyPlan(WINTER27), 'W', NOW); // adds + activates Winter plan
    const s = migrateToTermsState(null, flat, null, [], NOW);
    expect(Object.keys(s.terms).sort()).toEqual(['2026|2', '2027|3']);
    expect(s.terms['2027|3']!.plans.activeId).toBe(flat.activeId);
    expect(s.activeTermKey).toBe('2027|3'); // newest
  });

  it('browsed init = term pool − hidden + own entries (pixel-identical list)', () => {
    const inPlan = makeCourse('CSE-100');
    const browsedKept = makeCourse('CSE-101');
    const hiddenOne = makeCourse('CSE-102');
    const plan = { ...emptyPlan(FALL26), entries: [{ course: inPlan, selectedOptionId: null }] };
    let flat = migratePlans(null, plan, NOW);
    // Legacy `hidden` is migration INPUT — hand-built, the writer API is gone.
    flat = {
      ...flat,
      plans: flat.plans.map((p) =>
        p.id === flat.activeId ? { ...p, hidden: [hiddenOne.id] } : p,
      ),
    };
    const s = migrateToTermsState(null, flat, null, [inPlan, browsedKept, hiddenOne], NOW);
    const migrated = s.terms['2026|2']!.plans.plans[0]!;
    expect(migrated.browsed).toEqual(expect.arrayContaining([browsedKept.id, inPlan.id]));
    expect(migrated.browsed).not.toContain(hiddenOne.id);
    expect('hidden' in migrated).toBe(false);
  });

  it('a valid existing TermsState wins and a dangling activeTermKey is repaired', () => {
    const good = adoptSeedPlan(base(), emptyPlan(FALL26), NOW);
    const dangling = { ...good, activeTermKey: 'gone|9' };
    expect(migrateToTermsState(good, null, null, [], NOW)).toBe(good);
    expect(migrateToTermsState(dangling, null, null, [], NOW).activeTermKey).toBe('2026|2');
  });

  it('nothing stored → single DEFAULT_TERM bootstrap workspace', () => {
    const s = migrateToTermsState(null, null, null, [], NOW);
    expect(Object.keys(s.terms)).toEqual(['2026|2']);
    expect(allPlansEmpty(s)).toBe(true);
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

describe('archiveSweep', () => {
  const DEC25 = new Date(2026, 11, 25); // past Fall 12/20 boundary, before Winter's

  // Test helper: put one course into the active plan AND its browsed list.
  function updateActivePlanForTest(ps: PlansState, course: ReturnType<typeof makeCourse>) {
    const withEntry = updateActivePlan(ps, (p) => ({ ...p, entries: [{ course, selectedOptionId: null }] }), NOW);
    return addBrowsed(withEntry, withEntry.activeId, [course.id], NOW);
  }
  function withCourse(state: TermsState, key: string, course = makeCourse('CHEM-043A')): TermsState {
    return updateWorkspace(state, key, (ps) => updateActivePlanForTest(ps, course));
  }

  it('deletes an archived EMPTY workspace, keeps + freezes a non-empty one, purges pool + collects moduleIds', () => {
    let s = ensureWorkspace(base(), WINTER27, NOW);       // Fall(empty at first) + Winter
    const fallCourse = makeCourse('CSE-100');
    s = withCourse(s, '2026|2', fallCourse);              // Fall now has a course
    const strayFallPoolCourse = makeCourse('CSE-199');    // browsed-only, in pool
    const winterCourse = { ...makeCourse('CSE-101'), term: WINTER27, id: `CSE-101|2027|3` };
    const { state, pool, forgetModuleIds } = archiveSweep(s, [fallCourse, strayFallPoolCourse, winterCourse], DEC25);
    expect(Object.keys(state.terms).sort()).toEqual(['2026|2', '2027|3']); // Fall kept (has a course)
    expect(state.terms['2026|2']!.plans.plans.every((p) => (p.browsed ?? []).length === 0)).toBe(true);
    expect(pool.map((c) => c.id)).toEqual([winterCourse.id]); // all Fall pool objects dropped
    expect(forgetModuleIds.sort()).toEqual([fallCourse.moduleId, strayFallPoolCourse.moduleId].sort());
  });

  it('deletes an archived empty workspace and repairs activeTermKey', () => {
    let s = ensureWorkspace(base(), WINTER27, NOW); // Fall stays empty
    s = { ...s, activeTermKey: '2026|2' };
    const { state } = archiveSweep(s, [], DEC25);
    expect(Object.keys(state.terms)).toEqual(['2027|3']);
    expect(state.activeTermKey).toBe('2027|3');
  });

  it('never deletes the last remaining workspace', () => {
    const { state } = archiveSweep(base(), [], DEC25); // only an empty archived Fall
    expect(Object.keys(state.terms)).toEqual(['2026|2']);
  });

  it('is idempotent', () => {
    const fallCourse = makeCourse('CSE-100');
    const s = withCourse(base(), '2026|2', fallCourse);
    const first = archiveSweep(s, [fallCourse], DEC25);
    const second = archiveSweep(first.state, first.pool, DEC25);
    expect(second.forgetModuleIds).toEqual([]);
    expect(second.state).toBe(first.state);
    expect(second.pool).toBe(first.pool);
  });
});

describe('routeCapture', () => {
  const NOW_D = new Date(2026, 10, 15); // Nov 2026: nothing archived

  it('new course joins its own term active-plan browsed list and does not leak elsewhere', () => {
    const winterCourse = { ...makeCourse('CSE-101'), term: WINTER27, id: 'CSE-101|2027|3', capturedAt: '2026-11-15T00:00:00.000Z' };
    const { state, switchTo } = routeCapture(base(), [], [winterCourse], NOW, NOW_D);
    expect(switchTo).toBe('2027|3');
    const winterWs = state.terms['2027|3']!;
    expect(winterWs.plans.plans[0]!.browsed).toEqual(['CSE-101|2027|3']);
  });

  it('a pool course with unchanged capturedAt is NOT fresh (seat refresh does not re-add)', () => {
    const c = { ...makeCourse('CSE-100'), capturedAt: '2026-11-01T00:00:00.000Z' };
    const s = base();
    const r = routeCapture(s, [c], [c], NOW, NOW_D);
    expect(r.state).toBe(s);
    expect(r.switchTo).toBeNull();
  });

  it('a RE-browsed course (newer capturedAt) re-enters the current active plan (the ×-recovery path)', () => {
    const old = { ...makeCourse('CSE-100'), capturedAt: '2026-11-01T00:00:00.000Z' };
    const fresh = { ...old, capturedAt: '2026-11-16T00:00:00.000Z' };
    const { state } = routeCapture(base(), [old], [fresh], NOW, NOW_D);
    expect(state.terms['2026|2']!.plans.plans[0]!.browsed).toContain(old.id);
  });

  it('fresh courses in the ACTIVE term do not trigger a switch', () => {
    const c = { ...makeCourse('CSE-100'), capturedAt: '2026-11-15T00:00:00.000Z' };
    expect(routeCapture(base(), [], [c], NOW, NOW_D).switchTo).toBeNull();
  });

  it('routing to a real term drops the pristine bootstrap workspace', () => {
    const winterCourse = { ...makeCourse('CSE-101'), term: WINTER27, id: 'CSE-101|2027|3', capturedAt: '2026-11-15T00:00:00.000Z' };
    const { state } = routeCapture(base(), [], [winterCourse], NOW, NOW_D); // base() Fall ws is pristine
    expect(Object.keys(state.terms)).toEqual(['2027|3']);
  });
});
