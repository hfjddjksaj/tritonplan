import { expect, test } from 'vitest';
import type { ApptTimes, SyncOp } from '@triton/shared';
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

test('deleteCourses removes, putCourses upserts, putAppt stores the list', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  applyOps(db, u, [{ op: 'putCourses', courses: [course('a'), course('b')] }, { op: 'putAppt', data: [] }], T);
  applyOps(db, u, [{ op: 'deleteCourses', ids: ['a'] }, { op: 'putCourses', courses: [{ id: 'b', n: 2 } as never] }], T);
  expect(getSnapshot(db, u).pool).toEqual([{ id: 'b', n: 2 }]);
});

test('putAppt merges per term', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  const appt = (academicSession: string, capturedAt: string): ApptTimes =>
    ({ academicYear: '2026', academicSession, yearText: '2026', sessionText: 's', windows: [], capturedAt });
  const fall = appt('2', '2026-09-01T00:00:00Z');
  const winter = appt('3', '2026-11-01T00:00:00Z');
  applyOps(db, u, [{ op: 'putAppt', data: [fall] }], T);
  applyOps(db, u, [{ op: 'putAppt', data: [winter] }], T);
  expect(getSnapshot(db, u).appt).toEqual([fall, winter]);
  applyOps(db, u, [{ op: 'putAppt', data: [appt('2', '2026-08-01T00:00:00Z')] }], T);
  expect(getSnapshot(db, u).appt).toEqual([fall, winter]);
  applyOps(db, u, [{ op: 'putAppt', data: [] }], T);
  expect(getSnapshot(db, u).appt).toEqual([fall, winter]);
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

// {"id":"a","pad":""} is 19 bytes, so `pad` picks the stored size exactly.
const sized = (id: string, bytes: number, ch = 'x') => ({ id, pad: ch.repeat(bytes - 19) }) as never;
const CAP = 1000;
const capped = (db: Parameters<typeof applyOps>[0], user: string, ops: SyncOp[]) => applyOps(db, user, ops, T, new Map(), CAP);

test('a batch that leaves the account over its storage cap is refused whole; at the cap is fine', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 500), sized('b', 500)] }]).ok).toBe(true);
  const before = getSnapshot(db, u);

  const over = capped(db, u, [
    { op: 'putPlan', planId: 'p1', termKey: 'FA26', baseVersion: 0, data: 1 },
    { op: 'putCourses', courses: [sized('c', 19)] },
  ]);
  expect(over).toEqual({ ok: false, error: 'account_full' });
  expect(getSnapshot(db, u)).toEqual(before);
  // The version counter rolled back with the batch.
  expect(db.prepare('SELECT version_seq FROM users WHERE id = ?').get(u)).toEqual({ version_seq: 0 });
});

test('the cap counts every kind of doc the account stores, in bytes, and each account by itself', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  const other = mk('b@ucsd.edu');
  // "xx…" as JSON is its length plus the two quotes.
  expect(capped(db, u, [
    { op: 'putTerm', termKey: 'FA26', baseVersion: 0, data: 'x'.repeat(298) },
    { op: 'putPlan', planId: 'p1', termKey: 'FA26', baseVersion: 0, data: 'x'.repeat(298) },
    { op: 'putAppt', data: ['x'.repeat(296)] as unknown as ApptTimes[] },
  ]).ok).toBe(true); // 300 + 300 + 300
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 101)] }])).toEqual({ ok: false, error: 'account_full' });
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 100)] }]).ok).toBe(true);

  // 495 two-byte characters: 514 characters but 1009 bytes.
  expect(capped(db, other, [{ op: 'putCourses', courses: [sized('m', 19 + 495, 'é')] }])).toEqual({ ok: false, error: 'account_full' });
  expect(capped(db, other, [{ op: 'putCourses', courses: [sized('m', 1000)] }]).ok).toBe(true);
});

test('a full account can still delete, shrink a doc, and swap one doc for another in one batch', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 500), sized('b', 500)] }]).ok).toBe(true);
  expect(capped(db, u, [{ op: 'deleteCourses', ids: ['b'] }, { op: 'putCourses', courses: [sized('c', 500)] }]).ok).toBe(true);
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 100)] }]).ok).toBe(true);
  expect(capped(db, u, [{ op: 'deleteCourses', ids: ['a', 'c'] }]).ok).toBe(true);
  expect(getSnapshot(db, u).pool).toEqual([]);
});

test('an account that is already over the cap can shrink and delete, but not grow', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  // Stored while the cap was higher.
  expect(applyOps(db, u, [{ op: 'putCourses', courses: [sized('a', 800), sized('b', 700)] }], T).ok).toBe(true);
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 801)] }])).toEqual({ ok: false, error: 'account_full' });
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('c', 19)] }])).toEqual({ ok: false, error: 'account_full' });
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 800)] }]).ok).toBe(true); // same size: an edit in place
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 700)] }]).ok).toBe(true);
  expect(capped(db, u, [{ op: 'deleteCourses', ids: ['b'] }, { op: 'putCourses', courses: [sized('c', 100)] }]).ok).toBe(true);
});
