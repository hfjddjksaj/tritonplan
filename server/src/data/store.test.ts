import { expect, test } from 'vitest';
import type { ApptTimes, StateSnapshot, SyncOp } from '@triton/shared';
import { createUser } from '../auth/users';
import { testDeps } from '../test-helpers';
import { applyOps, snapshotJson } from './store';

const now = new Date('2026-01-15T12:00:00.000Z');
const T = now.toISOString();
const course = (id: string) => ({ id }) as never;
// What GET /api/state answers with, read back the way the planner reads it.
const getSnapshot = (db: Parameters<typeof snapshotJson>[0], userId: string) => JSON.parse(snapshotJson(db, userId)) as StateSnapshot;
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

// What a pool row is charged against the cap: its doc, its id and 200 bytes. {"id":"a","pad":""} is 19 bytes,
// so with a one-character id `pad` picks the charge exactly, from 220 up.
const sized = (id: string, charged: number, ch = 'x') => ({ id, pad: ch.repeat(charged - 220) }) as never;
const capped = (db: Parameters<typeof applyOps>[0], user: string, ops: SyncOp[], cap = 1000) => applyOps(db, user, ops, T, new Map(), cap);
const FULL = { ok: false, error: 'account_full' };

test('a batch that leaves the account over its storage cap is refused whole; at the cap is fine', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 500), sized('b', 500)] }]).ok).toBe(true);
  const before = getSnapshot(db, u);

  const over = capped(db, u, [
    { op: 'putPlan', planId: 'p1', termKey: 'FA26', baseVersion: 0, data: 1 },
    { op: 'putCourses', courses: [sized('c', 220)] },
  ]);
  expect(over).toEqual(FULL);
  expect(getSnapshot(db, u)).toEqual(before);
  // The version counter rolled back with the batch.
  expect(db.prepare('SELECT version_seq FROM users WHERE id = ?').get(u)).toEqual({ version_seq: 0 });
});

test('a row costs its keys and 200 bytes however small its doc, so many tiny rows cannot slip under the cap', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  const other = mk('b@ucsd.edu');
  const plan = (i: number): SyncOp => ({ op: 'putPlan', planId: `p${i}`, termKey: 'FA26', baseVersion: 0, data: 1 });
  // Each plan: 1 byte of doc + "p1" + "FA26" + 200 = 207.
  expect(capped(db, u, [plan(1), plan(2), plan(3), plan(4)]).ok).toBe(true);
  expect(capped(db, u, [plan(5)])).toEqual(FULL);

  // Four terms whose doc is one byte: with 50-character keys 4 x 251 = 1004, with 49-character keys 1000.
  const terms = (keyLength: number): SyncOp[] =>
    ['a', 'b', 'c', 'd'].map((ch) => ({ op: 'putTerm', termKey: ch.repeat(keyLength), baseVersion: 0, data: 1 }));
  expect(capped(db, other, terms(50))).toEqual(FULL);
  expect(capped(db, other, terms(49)).ok).toBe(true);
});

test('the cap counts every kind of doc the account stores, in bytes, and each account by itself', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  const other = mk('b@ucsd.edu');
  // Each of the three is 300: a string as JSON is its length plus two quotes, the appt list two brackets more.
  expect(capped(db, u, [
    { op: 'putTerm', termKey: 'FA26', baseVersion: 0, data: 'x'.repeat(94) }, // 96 + "FA26" + 200
    { op: 'putPlan', planId: 'p1', termKey: 'FA26', baseVersion: 0, data: 'x'.repeat(92) }, // 94 + "p1" + "FA26" + 200
    { op: 'putAppt', data: ['x'.repeat(92)] as unknown as ApptTimes[] }, // 96 + "appt" + 200
  ], 1120).ok).toBe(true);
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 221)] }], 1120)).toEqual(FULL);
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 220)] }], 1120).ok).toBe(true);

  // 391 two-byte characters: charged 220 + 782 = 1002, though it is only 611 characters long.
  expect(capped(db, other, [{ op: 'putCourses', courses: [sized('m', 220 + 391, 'é')] }])).toEqual(FULL);
  expect(capped(db, other, [{ op: 'putCourses', courses: [sized('m', 220 + 390, 'é')] }]).ok).toBe(true);
});

test('a full account can still delete, shrink a doc, and swap one doc for another in one batch', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 500), sized('b', 500)] }]).ok).toBe(true);
  expect(capped(db, u, [{ op: 'deleteCourses', ids: ['b'] }, { op: 'putCourses', courses: [sized('c', 500)] }]).ok).toBe(true);
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('c', 501)] }])).toEqual(FULL);
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 300)] }]).ok).toBe(true);
  expect(capped(db, u, [{ op: 'deleteCourses', ids: ['a', 'c'] }]).ok).toBe(true);
  expect(getSnapshot(db, u).pool).toEqual([]);
});

test('an account that is already over the cap can shrink and delete, but not grow', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  // Stored while the cap was higher.
  expect(applyOps(db, u, [{ op: 'putCourses', courses: [sized('a', 800), sized('b', 700)] }], T).ok).toBe(true);
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 801)] }])).toEqual(FULL);
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('c', 220)] }])).toEqual(FULL);
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 800)] }]).ok).toBe(true); // same size: an edit in place
  expect(capped(db, u, [{ op: 'putCourses', courses: [sized('a', 700)] }]).ok).toBe(true);
  expect(capped(db, u, [{ op: 'deleteCourses', ids: ['b'] }, { op: 'putCourses', courses: [sized('c', 300)] }]).ok).toBe(true);
});

test('an empty account is this exact text', () => {
  const { db, mk } = setup();
  expect(snapshotJson(db, mk('a@ucsd.edu'))).toBe('{"terms":{},"plans":{},"pool":[],"appt":null}');
});

test('a stored doc goes into the answer as it is stored: reading an account never parses its docs', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  // Not how JSON.stringify would write them, so a parse and re-serialize on the way out would show.
  const term = '{ "a" : 1.50 }';
  const plan = '[ 1,2 ,3 ]';
  const pool = '{ "id" : "c1" }';
  const appt = '[ ]';
  db.prepare('INSERT INTO term_docs (user_id, term_key, version, data, updated_at) VALUES (?, ?, 7, ?, ?)').run(u, 'FA26', term, T);
  db.prepare('INSERT INTO plan_docs (user_id, plan_id, term_key, version, data, updated_at) VALUES (?, ?, ?, 9, ?, ?)').run(u, 'p1', 'FA26', plan, T);
  db.prepare('INSERT INTO pool_courses (user_id, course_id, data, updated_at) VALUES (?, ?, ?, ?)').run(u, 'c1', pool, T);
  db.prepare("INSERT INTO user_docs (user_id, kind, data, updated_at) VALUES (?, 'appt', ?, ?)").run(u, appt, T);
  expect(snapshotJson(db, u)).toBe(
    `{"terms":{"FA26":{"version":7,"data":${term}}},"plans":{"p1":{"version":9,"termKey":"FA26","data":${plan}}},"pool":[${pool}],"appt":${appt}}`,
  );
});

test('keys that need escaping, and several rows of each kind in key order, still read back as JSON', () => {
  const { db, mk } = setup();
  const u = mk('a@ucsd.edu');
  // A quote, a backslash, a newline, U+2028 and a two-byte letter.
  const odd = ['te"rm', String.fromCharCode(92), 'key', String.fromCharCode(10, 0x2028), 'é'].join('');
  const v = ok(applyOps(db, u, [
    { op: 'putTerm', termKey: odd, baseVersion: 0, data: { t: 1 } },
    { op: 'putTerm', termKey: 'B', baseVersion: 0, data: 2 },
    { op: 'putPlan', planId: 'z"p', termKey: odd, baseVersion: 0, data: null },
    { op: 'putPlan', planId: 'a', termKey: 'B', baseVersion: 0, data: 'x' },
    { op: 'putCourses', courses: [course('c2'), course('c1')] },
  ], T));
  expect(getSnapshot(db, u)).toEqual({
    terms: { B: { version: v.terms.B, data: 2 }, [odd]: { version: v.terms[odd], data: { t: 1 } } },
    plans: { a: { version: v.plans.a, termKey: 'B', data: 'x' }, 'z"p': { version: v.plans['z"p'], termKey: odd, data: null } },
    pool: [{ id: 'c1' }, { id: 'c2' }],
    appt: null,
  });
  expect(Object.keys(getSnapshot(db, u).terms)).toEqual(['B', odd]);
});
