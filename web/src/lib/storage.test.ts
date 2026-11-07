import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApptTimes } from '@triton/shared';
import {
  savePlan,
  loadPlan,
  clearPlan,
  isPlanState,
  savePool,
  loadPool,
  isCoursePool,
  loadReceived,
  dropRetiredState,
  saveCalView,
  loadCalView,
  saveApptTimes,
  loadApptTimes,
} from './storage';
import { makePlan, makeCourse } from './fixtures';

const APPT: ApptTimes = {
  academicYear: '2026',
  academicSession: '2',
  yearText: '2026/2027',
  sessionText: 'Fall Quarter',
  capturedAt: '2026-07-25T12:00:00Z',
  windows: [
    { label: 'First Pass', beginsAt: '2026-08-10T21:00:00Z', endsAt: '2026-08-14T05:59:59Z', unitCap: '11.50', waitlists: 'Not Allowed' },
    { label: 'Second Pass', beginsAt: '2026-08-21T17:00:00Z', endsAt: '2026-08-27T05:59:59Z', unitCap: '19.50', waitlists: 'Allowed' },
  ],
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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

describe('the received-plan slot an older version kept (read by the old site\'s hand-off)', () => {
  it('reads what an older version stored', () => {
    const received = { plan: makePlan(), source: 'link' as const, receivedAt: '2026-07-24T10:00:00.000Z' };
    localStorage.setItem('triton-planner:received:v1', JSON.stringify(received));
    expect(loadReceived()).toEqual(received);
  });

  it('returns null when nothing is stored, on corrupt JSON, and on wrong shapes', () => {
    expect(loadReceived()).toBeNull();
    localStorage.setItem('triton-planner:received:v1', '{ broken');
    expect(loadReceived()).toBeNull();
    localStorage.setItem(
      'triton-planner:received:v1',
      JSON.stringify({ plan: makePlan(), source: 'email', receivedAt: 'x' }),
    );
    expect(loadReceived()).toBeNull();
    localStorage.setItem(
      'triton-planner:received:v1',
      JSON.stringify({ plan: { version: 2 }, source: 'json', receivedAt: 'x' }),
    );
    expect(loadReceived()).toBeNull();
  });
});

describe('dropRetiredState', () => {
  const LOCAL = ['triton-planner:received:v1', 'triton-planner:saved-shares:v1'];
  const SESSION = ['triton-planner:viewing:v1', 'triton-planner:synced-hash:v1', 'triton-planner:pending-save:v1'];

  it('removes what an older version kept, and nothing else', () => {
    for (const k of LOCAL) localStorage.setItem(k, '{}');
    for (const k of SESSION) sessionStorage.setItem(k, 'x');
    const mine = makePlan();
    savePlan(mine);
    localStorage.setItem('triton-planner:pending-share:v1', '{}');
    sessionStorage.setItem('triton-planner:pending-hash:v1', '#m=x');
    dropRetiredState();
    for (const k of LOCAL) expect(localStorage.getItem(k)).toBeNull();
    for (const k of SESSION) expect(sessionStorage.getItem(k)).toBeNull();
    expect(loadPlan()).toEqual(mine);
    expect(localStorage.getItem('triton-planner:pending-share:v1')).toBe('{}');
    expect(sessionStorage.getItem('triton-planner:pending-hash:v1')).toBe('#m=x');
  });

  it('blocked storage is not an error', () => {
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(() => dropRetiredState()).not.toThrow();
    } finally {
      remove.mockRestore();
    }
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

describe('calendar view preference', () => {
  it('defaults to fit and persists scroll', () => {
    expect(loadCalView()).toBe('fit');
    saveCalView('scroll');
    expect(loadCalView()).toBe('scroll');
    saveCalView('fit');
    expect(loadCalView()).toBe('fit');
  });

  it('falls back to fit on an unrecognized stored value', () => {
    localStorage.setItem('triton-planner:cal-view:v1', 'garbage');
    expect(loadCalView()).toBe('fit');
  });
});

describe('appointment-times slot', () => {
  it('round-trips through localStorage', () => {
    saveApptTimes([APPT]);
    expect(loadApptTimes()).toEqual([APPT]);
  });

  it('rejects corrupt or wrong-shaped values', () => {
    localStorage.setItem('triton-planner:appt:v1', 'not json');
    expect(loadApptTimes()).toBeNull();
    localStorage.setItem(
      'triton-planner:appt:v1',
      JSON.stringify([{ ...APPT, windows: [{ label: 1 }] }]),
    );
    expect(loadApptTimes()).toBeNull();
  });
});

describe('terms storage', () => {
  it('round-trips a TermsState', async () => {
    const { saveTerms, loadTerms } = await import('./storage');
    const { newWorkspace } = await import('./terms-state');
    const state = { version: 1 as const, activeTermKey: '2026|2', terms: { '2026|2': newWorkspace({ year: '2026', period: '2', label: 'Fall 2026' }, '2026-08-11T00:00:00.000Z') } };
    saveTerms(state);
    expect(loadTerms()).toEqual(state);
  });
  it('rejects junk', async () => {
    const { isTermsState } = await import('./storage');
    expect(isTermsState(null)).toBe(false);
    expect(isTermsState({ version: 1, activeTermKey: 'x', terms: {} })).toBe(false); // empty terms
    expect(isTermsState({ version: 2, activeTermKey: 'x', terms: {} })).toBe(false);
  });
  it('round-trips booked fields', async () => {
    const { saveTerms, loadTerms } = await import('./storage');
    const { newWorkspace } = await import('./terms-state');
    const A = 'CHEM-114A|2026|2';
    const ws = newWorkspace({ year: '2026', period: '2', label: 'Fall 2026' }, '2026-08-11T00:00:00.000Z');
    const state = { version: 1 as const, activeTermKey: '2026|2', terms: { '2026|2': { ...ws, bookedAuto: [A], bookedOn: [], bookedOff: [] } } };
    saveTerms(state);
    expect(loadTerms()).toEqual(state);
  });
  it('rejects malformed booked fields', async () => {
    const { isTermsState } = await import('./storage');
    const { newWorkspace } = await import('./terms-state');
    const ws = newWorkspace({ year: '2026', period: '2', label: 'Fall 2026' }, '2026-08-11T00:00:00.000Z');
    expect(isTermsState({ version: 1, activeTermKey: '2026|2', terms: { '2026|2': { ...ws, bookedAuto: 'nope' } } })).toBe(false);
  });
});

