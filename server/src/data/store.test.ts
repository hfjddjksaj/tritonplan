import { expect, test } from 'vitest';
import type { SyncOp } from '@triton/shared';
import { createUser } from '../auth/users';
import { testDeps } from '../test-helpers';
import { applyOps, getSnapshot } from './store';

const now = new Date('2026-01-15T12:00:00.000Z');
const T = now.toISOString();
const course = (id: string) => ({ id }) as never;
const ok = (r: ReturnType<typeof applyOps>) => {
  if (!r.ok) throw new Error('unexpected conflict');
  return r.versions;
};

function setup() {
  const deps = testDeps();
  const mk = (email: string) => createUser(deps.db, { email, verified: true, passwordHash: null, googleSub: null }, now).id;
  return { db: deps.db, mk };
}

test('puts read back with the versions the sync returned; versions are positive, distinct and increasing', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  const v = ok(applyOps(db, u, [
    { op: 'putTerm', termKey: 'FA26', baseVersion: 0, data: { x: 1 } },
    { op: 'putPlan', planId: 'p1', termKey: 'FA26', baseVersion: 0, data: [1] },
    { op: 'putCourses', courses: [course('c1'), course('c2')] },
    { op: 'putAppt', data: [] },
  ], T));
  expect(v.terms.FA26).toBeGreaterThan(0);
  expect(v.plans.p1).toBeGreaterThan(v.terms.FA26!);
  expect(getSnapshot(db, u)).toEqual({
    terms: { FA26: { version: v.terms.FA26, data: { x: 1 } } },
    plans: { p1: { version: v.plans.p1, termKey: 'FA26', data: [1] } },
    pool: [{ id: 'c1' }, { id: 'c2' }],
    appt: [],
  });
  const v2 = ok(applyOps(db, u, [{ op: 'putPlan', planId: 'p1', termKey: 'SP27', baseVersion: v.plans.p1!, data: [2] }], T));
  expect(v2.plans.p1).toBeGreaterThan(v.plans.p1!);
  expect(getSnapshot(db, u).plans.p1).toEqual({ version: v2.plans.p1, termKey: 'SP27', data: [2] });
});

test('a recreated plan never reuses a version: a stale device holding the old one conflicts', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  const a = ok(applyOps(db, u, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 'old' }], T)).plans.p!;
  expect(applyOps(db, u, [{ op: 'deletePlan', planId: 'p', baseVersion: a }], T).ok).toBe(true);
  const b = ok(applyOps(db, u, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 'new' }], T)).plans.p!;
  expect(b).toBeGreaterThan(a);
  expect(applyOps(db, u, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: a, data: 'stale' }], T))
    .toEqual({ ok: false, error: 'conflict', conflicts: [{ kind: 'plan', id: 'p' }] });
  expect(getSnapshot(db, u).plans.p).toEqual({ version: b, termKey: 'FA26', data: 'new' });
});

test('updated_at is the passed timestamp', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  applyOps(db, u, [
    { op: 'putTerm', termKey: 'FA26', baseVersion: 0, data: 1 },
    { op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 1 },
    { op: 'putCourses', courses: [course('c')] }, { op: 'putAppt', data: [] },
  ], '2030-05-05T05:05:05.000Z');
  for (const t of ['term_docs', 'plan_docs', 'pool_courses', 'user_docs']) {
    expect((db.prepare(`SELECT updated_at FROM ${t} WHERE user_id = ?`).get(u) as { updated_at: string }).updated_at).toBe('2030-05-05T05:05:05.000Z');
  }
});

test('a non-conflict error mid-batch rolls everything back, including the version counter', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  const bad = { id: 'c' } as Record<string, unknown>;
  bad.self = bad; // JSON.stringify throws on the cycle, after the plan write
  expect(() => applyOps(db, u, [
    { op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 1 },
    { op: 'putCourses', courses: [bad as never] },
  ], T)).toThrow();
  expect(getSnapshot(db, u)).toEqual({ terms: {}, plans: {}, pool: [], appt: null });
  expect((db.prepare('SELECT version_seq FROM users WHERE id = ?').get(u) as { version_seq: number }).version_seq).toBe(0);
});

test('__proto__ keys stay plain entries', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  const v = ok(applyOps(db, u, [{ op: 'putTerm', termKey: '__proto__', baseVersion: 0, data: 1 }], T));
  expect(Object.keys(v.terms)).toEqual(['__proto__']);
  expect(Object.keys(getSnapshot(db, u).terms)).toEqual(['__proto__']);
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
    conflicts: [{ kind: 'plan', id: 'p1' }, { kind: 'term', id: 'FA26' }],
  });
  const snap = getSnapshot(db, u);
  expect(Object.keys(snap.plans)).toEqual(['p1']);
  expect(snap.plans.p1!.data).toBe(1);
  expect(snap.pool).toEqual([]);
});

test('missing row with base > 0 conflicts on put; delete of a missing row succeeds; base 0 creates', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  expect(applyOps(db, u, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 2, data: 1 }], T))
    .toEqual({ ok: false, error: 'conflict', conflicts: [{ kind: 'plan', id: 'p' }] });
  expect(applyOps(db, u, [{ op: 'deletePlan', planId: 'p', baseVersion: 2 }, { op: 'deleteTerm', termKey: 'X', baseVersion: 9 }], T))
    .toEqual({ ok: true, versions: { terms: {}, plans: {} } });
  const v = ok(applyOps(db, u, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 1 }], T)).plans.p!;
  expect(v).toBeGreaterThan(0);
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
  const vb = ok(applyOps(db, b, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 'B' }], T)).plans.p!;
  expect(applyOps(db, b, [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: vb, data: 'B2' }, { op: 'deleteCourses', ids: ['c'] }, { op: 'deleteTerm', termKey: 'FA26', baseVersion: 1 }], T).ok).toBe(true);
  const snap = getSnapshot(db, a);
  expect(snap.plans.p).toMatchObject({ termKey: 'FA26', data: 'A' });
  expect(snap.terms.FA26!.data).toBe('A');
  expect(snap.pool).toEqual([{ id: 'c' }]);
  expect(getSnapshot(db, b).plans.p!.data).toBe('B2');
});
