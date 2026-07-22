import { describe, it, expect, beforeEach } from 'vitest';
import { savePlan, loadPlan, clearPlan, isPlanState, savePool, loadPool, isCoursePool } from './storage';
import { makePlan, makeCourse } from './fixtures';

beforeEach(() => {
  localStorage.clear();
});

describe('storage', () => {
  it('saves and loads an identical plan', () => {
    const plan = makePlan();
    savePlan(plan);
    expect(loadPlan()).toEqual(plan);
  });

  it('returns null when nothing is stored', () => {
    expect(loadPlan()).toBeNull();
  });

  it('returns null and does not throw on corrupt storage', () => {
    localStorage.setItem('triton-planner:plan:v1', '{ broken json');
    expect(loadPlan()).toBeNull();
  });

  it('rejects a stored value with the wrong shape', () => {
    localStorage.setItem('triton-planner:plan:v1', JSON.stringify({ version: 2, entries: [] }));
    expect(loadPlan()).toBeNull();
  });

  it('clears the stored plan', () => {
    savePlan(makePlan());
    clearPlan();
    expect(loadPlan()).toBeNull();
  });
});

describe('isPlanState', () => {
  it('accepts a well-formed plan and rejects others', () => {
    expect(isPlanState(makePlan())).toBe(true);
    expect(isPlanState(null)).toBe(false);
    expect(isPlanState({ version: 1 })).toBe(false);
    expect(isPlanState({ version: 1, term: {}, entries: 'x' })).toBe(false);
  });
});

describe('pool storage', () => {
  it('saves and loads the browsed pool', () => {
    const pool = [makeCourse('A'), makeCourse('B')];
    savePool(pool);
    expect(loadPool()).toEqual(pool);
  });

  it('returns null when nothing is stored', () => {
    expect(loadPool()).toBeNull();
  });

  it('returns null on corrupt or wrong-shape pool storage', () => {
    localStorage.setItem('triton-planner:pool:v1', '{ broken');
    expect(loadPool()).toBeNull();
    localStorage.setItem('triton-planner:pool:v1', JSON.stringify([{ nope: true }]));
    expect(loadPool()).toBeNull();
  });

  it('isCoursePool validates array-of-courses', () => {
    expect(isCoursePool([makeCourse('A')])).toBe(true);
    expect(isCoursePool([])).toBe(true);
    expect(isCoursePool('x')).toBe(false);
    expect(isCoursePool([{ id: 'A' }])).toBe(false); // missing options[]
  });
});
