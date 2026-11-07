import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseOffering, PlanState, SyncOp, SyncVersions, Term } from '@triton/shared';
import { UnauthorizedError } from './cloud/api';
import type { SendResult, SyncEngine } from './cloud/engine';
import { termsFromSnapshot, type WebSnapshot } from './cloud/records';
import { makeCourse } from './fixtures';
import type { NamedPlan } from './plans';
import {
  ACCOUNT_CHANGED_KEY, applySharedSave, notifyAccountChanged, saveSharedToAccount, type SharedSave,
} from './shared-save';
import type { TermsState } from './terms-state';
import { snapshotOf } from '../test/boot';

// Every engine a save makes, so a test can see it was disposed.
const { engines } = vi.hoisted(() => ({ engines: [] as (SyncEngine & { dispose: ReturnType<typeof vi.fn> })[] }));
vi.mock('./cloud/engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./cloud/engine')>();
  return {
    ...mod,
    createSyncEngine: (...args: Parameters<typeof mod.createSyncEngine>) => {
      const e = mod.createSyncEngine(...args);
      const wrapped = { ...e, dispose: vi.fn(() => e.dispose()) };
      engines.push(wrapped);
      return wrapped;
    },
  };
});

const FA: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WI: Term = { year: '2027', period: '3', label: 'Winter 2027' };
const NOW = new Date('2026-10-01T19:00:00Z');

function course(code: string, term: Term = FA): CourseOffering {
  return { ...makeCourse(`${code}|${term.year}|${term.period}`, code), term };
}
function planOf(term: Term, ...codes: string[]): PlanState {
  return {
    version: 1,
    term,
    entries: codes.map((code, i) => {
      const c = course(code, term);
      return { course: c, selectedOptionId: c.options[0]!.id, color: String(i * 40) };
    }),
  };
}
const named = (id: string, name: string, plan: PlanState, browsed: string[] = []): NamedPlan => ({
  id, name, plan, createdAt: 'c', updatedAt: 'u', browsed,
});

/** Fall 2026: "Mine" (CSE-8A, active) and "Backup" (CSE-11). */
function account(): TermsState {
  return {
    version: 1,
    activeTermKey: '2026|2',
    terms: {
      '2026|2': {
        term: FA,
        plans: {
          activeId: 'plan-1',
          plans: [
            named('plan-1', 'Mine', planOf(FA, 'CSE-8A'), ['CSE-8A|2026|2']),
            named('plan-2', 'Backup', planOf(FA, 'CSE-11'), ['CSE-11|2026|2', 'CSE-30|2026|2']),
          ],
        },
      },
    },
  };
}

/** The friend's MATH-18 + CSE-12, of which only MATH-18 was picked. */
const picked = (term: Term = FA) => planOf(term, 'MATH-18');
const asNew = (name: string, plan: PlanState = picked()): SharedSave => ({ plan, mode: { kind: 'new', name } });
const asReplace = (planId: string, plan: PlanState = picked()): SharedSave => ({ plan, mode: { kind: 'replace', planId } });

const plansIn = (t: TermsState, key = '2026|2') => t.terms[key]!.plans.plans;

describe('applySharedSave', () => {
  it('a new plan holds only the picked courses, under its own name; the plan on screen stays active', () => {
    const start = account();
    const pool = [course('CSE-8A')];
    const r = applySharedSave(start, pool, asNew('Fall draft'), NOW);
    expect(r.outcome).toEqual({ kind: 'new', planName: 'Fall draft' });
    const plans = plansIn(r.terms);
    expect(plans.map((p) => p.name)).toEqual(['Mine', 'Backup', 'Fall draft']);
    const added = plans[2]!;
    expect(added.plan.entries.map((e) => e.course.id)).toEqual(['MATH-18|2026|2']);
    expect(added.browsed).toEqual(['MATH-18|2026|2']);
    expect(r.terms.activeTermKey).toBe('2026|2');
    expect(r.terms.terms['2026|2']!.plans.activeId).toBe('plan-1');
    expect(plans[0]).toBe(start.terms['2026|2']!.plans.plans[0]);
    expect(r.pool.map((c) => c.id)).toEqual(['CSE-8A|2026|2', 'MATH-18|2026|2']);
  });

  it('a name the account already uses gets one of its own', () => {
    const r = applySharedSave(account(), [], asNew('Mine'), NOW);
    expect(r.outcome).toEqual({ kind: 'new', planName: 'Mine (shared)' });
    expect(plansIn(r.terms).map((p) => p.name)).toEqual(['Mine', 'Backup', 'Mine (shared)']);
  });

  it('a term the account lacks gets a workspace of just this plan, and the term on screen stays', () => {
    const r = applySharedSave(account(), [], asNew('Winter', picked(WI)), NOW);
    expect(r.terms.activeTermKey).toBe('2026|2');
    expect(plansIn(r.terms, '2027|3').map((p) => p.name)).toEqual(['Winter']);
    expect(plansIn(r.terms).map((p) => p.name)).toEqual(['Mine', 'Backup']);
  });

  it('an account with nothing in it yet starts with just this plan', () => {
    const r = applySharedSave(null, [], asNew('My plan'), NOW);
    expect(Object.keys(r.terms.terms)).toEqual(['2026|2']);
    expect(plansIn(r.terms).map((p) => p.name)).toEqual(['My plan']);
    expect(r.outcome).toEqual({ kind: 'new', planName: 'My plan' });
  });

  it('replace swaps the courses of that plan in place; the plan on screen stays active', () => {
    const start = account();
    const r = applySharedSave(start, [], asReplace('plan-2'), NOW);
    expect(r.outcome).toEqual({ kind: 'replaced', planName: 'Backup' });
    const plans = plansIn(r.terms);
    expect(plans.map((p) => [p.id, p.name])).toEqual([['plan-1', 'Mine'], ['plan-2', 'Backup']]);
    expect(plans[1]!.plan.entries.map((e) => e.course.id)).toEqual(['MATH-18|2026|2']);
    expect(plans[1]!.browsed).toEqual(['CSE-11|2026|2', 'CSE-30|2026|2', 'MATH-18|2026|2']);
    expect(r.terms.terms['2026|2']!.plans.activeId).toBe('plan-1');
    expect(r.pool.map((c) => c.id)).toEqual(['MATH-18|2026|2']);
  });

  it('replace falls back to new when target is missing', () => {
    const r = applySharedSave(account(), [], asReplace('deleted-on-phone'), NOW);
    expect(r.outcome.kind).toBe('new');
    const plans = plansIn(r.terms);
    expect(plans).toHaveLength(3);
    expect(plans.slice(0, 2).map((p) => p.plan.entries.map((e) => e.course.id))).toEqual([['CSE-8A|2026|2'], ['CSE-11|2026|2']]);
    expect(plans[2]!.name).toBe(r.outcome.planName);
    expect(plans[2]!.plan.entries.map((e) => e.course.id)).toEqual(['MATH-18|2026|2']);
    expect(r.pool.map((c) => c.id)).toEqual(['MATH-18|2026|2']);
  });
});

/** An in-memory server answering POST /api/sync like the real one: a fresh version per put. */
function fakeServer(snapshot: WebSnapshot) {
  let counter = 900;
  const sent: SyncOp[][] = [];
  const ok = async (ops: SyncOp[]): Promise<SendResult> => {
    sent.push(ops);
    const versions: SyncVersions = { terms: {}, plans: {} };
    for (const op of ops) {
      if (op.op === 'putTerm') versions.terms[op.termKey] = ++counter;
      if (op.op === 'putPlan') versions.plans[op.planId] = ++counter;
    }
    return { ok: true, versions };
  };
  return {
    sent,
    fetchState: vi.fn(async () => snapshot),
    postSync: vi.fn(ok),
    now: () => NOW,
  };
}

describe('saveSharedToAccount', () => {
  beforeEach(() => {
    engines.length = 0;
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('writes the new plan and its courses into the account, and tells other tabs', async () => {
    const deps = fakeServer(snapshotOf(account(), [course('CSE-8A')]));
    const r = await saveSharedToAccount(asNew('Fall draft'), deps);
    expect(r).toEqual({ ok: true, outcome: { kind: 'new', planName: 'Fall draft' } });
    const ops = deps.sent.flat();
    expect(ops.map((o) => o.op)).toEqual(['putTerm', 'putPlan', 'putCourses']);
    const put = ops.find((o) => o.op === 'putPlan') as Extract<SyncOp, { op: 'putPlan' }>;
    expect(put.baseVersion).toBe(0);
    expect((put.data as NamedPlan).name).toBe('Fall draft');
    const term = ops.find((o) => o.op === 'putTerm') as Extract<SyncOp, { op: 'putTerm' }>;
    expect(term.data).toMatchObject({ activeId: 'plan-1' }); // the plan on screen in their own planner stays
    expect((ops.find((o) => o.op === 'putCourses') as Extract<SyncOp, { op: 'putCourses' }>).courses.map((c) => c.id))
      .toEqual(['MATH-18|2026|2']);
    expect(localStorage.getItem(ACCOUNT_CHANGED_KEY)).toBe(String(NOW.getTime()));
    expect(engines).toHaveLength(1);
    expect(engines[0]!.dispose).toHaveBeenCalled();
  });

  it('a replace writes that plan only, at the version the server had', async () => {
    const snap = snapshotOf(account());
    const deps = fakeServer(snap);
    const r = await saveSharedToAccount(asReplace('plan-2'), deps);
    expect(r).toEqual({ ok: true, outcome: { kind: 'replaced', planName: 'Backup' } });
    const ops = deps.sent.flat();
    expect(ops.map((o) => o.op)).toEqual(['putPlan', 'putCourses']);
    expect(ops[0]).toMatchObject({ op: 'putPlan', planId: 'plan-2', baseVersion: snap.plans['plan-2']!.version });
    const read = termsFromSnapshot(snap); // the answer it read is left as it was
    expect(read?.terms['2026|2']!.plans.plans[1]!.plan.entries.map((e) => e.course.id)).toEqual(['CSE-11|2026|2']);
  });

  it('signed out before it starts: nothing is sent and no engine is made', async () => {
    const deps = fakeServer(snapshotOf(account()));
    deps.fetchState.mockRejectedValue(new UnauthorizedError());
    expect(await saveSharedToAccount(asNew('Fall draft'), deps)).toEqual({ ok: false, reason: 'signed-out' });
    expect(deps.postSync).not.toHaveBeenCalled();
    expect(engines).toHaveLength(0);
    expect(localStorage.getItem(ACCOUNT_CHANGED_KEY)).toBeNull();
  });

  it('the account cannot be read: offline, nothing sent', async () => {
    const deps = fakeServer(snapshotOf(account()));
    deps.fetchState.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await saveSharedToAccount(asNew('Fall draft'), deps)).toEqual({ ok: false, reason: 'offline' });
    expect(deps.postSync).not.toHaveBeenCalled();
  });

  it.each([
    ['a 401 on the write', 'unauthorized', 'signed-out'],
    ['a dropped connection', 'network', 'offline'],
    ['a version clash', 'conflict', 'failed'],
    ['a refused request', 'rejected', 'failed'],
  ] as const)('%s: %s → %s, the engine disposed and never retrying', async (_, kind, reason) => {
    const deps = fakeServer(snapshotOf(account()));
    deps.postSync.mockResolvedValue({ ok: false, kind });
    expect(await saveSharedToAccount(asNew('Fall draft'), deps)).toEqual({ ok: false, reason });
    expect(engines).toHaveLength(1);
    expect(engines[0]!.dispose).toHaveBeenCalled();
    const posts = deps.postSync.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000); // past every retry the engine would have scheduled
    expect(deps.postSync).toHaveBeenCalledTimes(posts);
    expect(localStorage.getItem(ACCOUNT_CHANGED_KEY)).toBeNull();
  });
});

describe('notifyAccountChanged', () => {
  it('stamps the time under its key, so every other tab hears a storage event', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    notifyAccountChanged();
    expect(localStorage.getItem(ACCOUNT_CHANGED_KEY)).toBe(String(NOW.getTime()));
    vi.useRealTimers();
  });
});
