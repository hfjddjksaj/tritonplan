import { expect, test } from 'vitest';
import type { SyncOp } from '@triton/shared';
import { createUser } from '../auth/users';
import { testDeps } from '../test-helpers';
import { applyOps, getSnapshot } from './store';

const now = new Date('2026-01-15T12:00:00.000Z');
const T = now.toISOString();
const course = (id: string) => ({ id }) as never;

function setup() {
  const deps = testDeps();
  const mk = (email: string) => createUser(deps.db, { email, verified: true, passwordHash: null, googleSub: null }, now).id;
  return { db: deps.db, mk };
}

test('puts read back with versions, then bump by one', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  const r = applyOps(db, u, [
    { op: 'putTerm', termKey: 'FA26', baseVersion: 0, data: { x: 1 } },
    { op: 'putPlan', planId: 'p1', termKey: 'FA26', baseVersion: 0, data: [1] },
    { op: 'putCourses', courses: [course('c1'), course('c2')] },
    { op: 'putAppt', data: [] },
  ], T);
  expect(r).toEqual({ ok: true, versions: { terms: { FA26: 1 }, plans: { p1: 1 } } });
  expect(getSnapshot(db, u)).toEqual({
    terms: { FA26: { version: 1, data: { x: 1 } } },
    plans: { p1: { version: 1, termKey: 'FA26', data: [1] } },
    pool: [{ id: 'c1' }, { id: 'c2' }],
    appt: [],
  });
  const r2 = applyOps(db, u, [{ op: 'putPlan', planId: 'p1', termKey: 'SP27', baseVersion: 1, data: [2] }], T);
  expect(r2).toEqual({ ok: true, versions: { terms: {}, plans: { p1: 2 } } });
  expect(getSnapshot(db, u).plans.p1).toEqual({ version: 2, termKey: 'SP27', data: [2] });
});

test('empty account: appt is null', () => {
  const { db, mk } = setup();
  expect(getSnapshot(db, mk('a@ucsd.edu'))).toEqual({ terms: {}, plans: {}, pool: [], appt: null });
});

test('any conflict rolls back the whole batch and lists every conflict', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  applyOps(db, u, [{ op: 'putPlan', planId: 'p1', termKey: 'FA26', baseVersion: 0, data: 1 }], T);
  const ops: SyncOp[] = [
    { op: 'putPlan', planId: 'ok', termKey: 'FA26', baseVersion: 0, data: 1 },
    { op: 'putCourses', courses: [course('c1')] },
    { op: 'putPlan', planId: 'p1', termKey: 'FA26', baseVersion: 0, data: 2 },
    { op: 'putTerm', termKey: 'FA26', baseVersion: 3, data: 2 },
    { op: 'deletePlan', planId: 'p1', baseVersion: 5 },
  ];
  expect(applyOps(db, u, ops, T)).toEqual({
    ok: false, error: 'conflict',
    conflicts: [{ kind: 'plan', id: 'p1' }, { kind: 'term', id: 'FA26' }, { kind: 'plan', id: 'p1' }],
  });
  const snap = getSnapshot(db, u);
  expect(Object.keys(snap.plans)).toEqual(['p1']);
  expect(snap.plans.p1!.data).toBe(1);
  expect(snap.pool).toEqual([]);
});

test('missing row with base > 0 conflicts on put; delete of a missing row succeeds; base 0 recreates at 1', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  expect(applyOps(db, u, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 2, data: 1 }], T))
    .toEqual({ ok: false, error: 'conflict', conflicts: [{ kind: 'plan', id: 'p' }] });
  expect(applyOps(db, u, [{ op: 'deletePlan', planId: 'p', baseVersion: 2 }, { op: 'deleteTerm', termKey: 'X', baseVersion: 9 }], T))
    .toEqual({ ok: true, versions: { terms: {}, plans: {} } });
  applyOps(db, u, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 1 }], T);
  expect(applyOps(db, u, [{ op: 'deletePlan', planId: 'p', baseVersion: 1 }], T).ok).toBe(true);
  expect(applyOps(db, u, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 3 }], T))
    .toEqual({ ok: true, versions: { terms: {}, plans: { p: 1 } } });
});

test('deleteCourses removes, putCourses upserts, putAppt replaces', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  applyOps(db, u, [{ op: 'putCourses', courses: [course('a'), course('b')] }, { op: 'putAppt', data: [] }], T);
  applyOps(db, u, [{ op: 'deleteCourses', ids: ['a'] }, { op: 'putCourses', courses: [{ id: 'b', n: 2 } as never] }], T);
  expect(getSnapshot(db, u).pool).toEqual([{ id: 'b', n: 2 }]);
});

test('users are fully isolated', () => {
  const { db, mk } = setup();
  const a = mk('a@ucsd.edu');
  const b = mk('b@ucsd.edu');
  applyOps(db, a, [
    { op: 'putTerm', termKey: 'FA26', baseVersion: 0, data: 'A' },
    { op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 'A' },
    { op: 'putCourses', courses: [course('c')] }, { op: 'putAppt', data: [] },
  ], T);
  expect(getSnapshot(db, b)).toEqual({ terms: {}, plans: {}, pool: [], appt: null });
  // B's put with the same id creates B's own row at version 1; A's row is untouched.
  expect(applyOps(db, b, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 'B' }], T))
    .toEqual({ ok: true, versions: { terms: {}, plans: { p: 1 } } });
  expect(applyOps(db, b, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 1, data: 'B2' }, { op: 'deleteCourses', ids: ['c'] }, { op: 'deleteTerm', termKey: 'FA26', baseVersion: 1 }], T).ok).toBe(true);
  const snap = getSnapshot(db, a);
  expect(snap.plans.p).toEqual({ version: 1, termKey: 'FA26', data: 'A' });
  expect(snap.terms.FA26!.data).toBe('A');
  expect(snap.pool).toEqual([{ id: 'c' }]);
  expect(getSnapshot(db, b).plans.p!.data).toBe('B2');
});
