import { expect, test } from 'vitest';
import { createApp } from '../app';
import { createSession } from '../auth/sessions';
import { createUser } from '../auth/users';
import { testDeps } from '../test-helpers';

const now = new Date('2026-01-15T12:00:00.000Z');

function setup() {
  const deps = testDeps();
  const app = createApp(deps);
  const user = (email: string) => {
    const u = createUser(deps.db, { email, verified: true, passwordHash: null, googleSub: null }, now);
    return createSession(deps.db, u.id, now);
  };
  const sync = (body: unknown, token?: string, raw?: string) =>
    app.request('/api/sync', {
      method: 'POST',
      headers: { Origin: 'https://tritonplan.cn', 'Content-Type': 'application/json', ...(token ? { Cookie: `tp_session=${token}` } : {}) },
      body: raw ?? JSON.stringify(body),
    });
  const state = (token?: string) => app.request('/api/state', { headers: token ? { Cookie: `tp_session=${token}` } : {} });
  const snap = async (token?: string) => (await state(token)).json() as Promise<any>;
  return { user, sync, state, snap };
}

const course = (id: string, pad = 0) => ({ id, pad: 'x'.repeat(pad) });

test('put then read back through /api/state', async () => {
  const { user, sync, state, snap } = setup();
  const t = user('a@ucsd.edu');
  const res = await sync({ ops: [
    { op: 'putTerm', termKey: 'FA26', baseVersion: 0, data: { a: 1 } },
    { op: 'putPlan', planId: 'p1', termKey: 'FA26', baseVersion: 0, data: { n: 1 } },
    { op: 'putPlan', planId: 'p2', termKey: 'FA26', baseVersion: 0, data: { n: 2 } },
    { op: 'putCourses', courses: [course('c1'), course('c2'), course('c3')] },
    { op: 'putAppt', data: [] },
  ] }, t);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, versions: { terms: { FA26: 1 }, plans: { p1: 1, p2: 1 } } });
  const s = await snap(t);
  expect(s.terms).toEqual({ FA26: { version: 1, data: { a: 1 } } });
  expect(Object.values(s.plans).map((p: any) => p.version)).toEqual([1, 1]);
  expect(s.pool).toHaveLength(3);
  expect(s.appt).toEqual([]);
});

test('a stale baseVersion is 409 and nothing in the batch is applied', async () => {
  const { user, sync, snap } = setup();
  const t = user('a@ucsd.edu');
  await sync({ ops: [{ op: 'putPlan', planId: 'p1', termKey: 'FA26', baseVersion: 0, data: 1 }] }, t);
  const res = await sync({ ops: [
    { op: 'putPlan', planId: 'fresh', termKey: 'FA26', baseVersion: 0, data: 1 },
    { op: 'putPlan', planId: 'p1', termKey: 'FA26', baseVersion: 0, data: 2 },
  ] }, t);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ ok: false, error: 'conflict', conflicts: [{ kind: 'plan', id: 'p1' }] });
  expect(Object.keys((await snap(t)).plans)).toEqual(['p1']);
});

test('putPlan on a plan deleted elsewhere is a conflict; delete of a missing row is fine; base 0 recreates', async () => {
  const { user, sync } = setup();
  const t = user('a@ucsd.edu');
  await sync({ ops: [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 1 }] }, t);
  await sync({ ops: [{ op: 'deletePlan', planId: 'p', baseVersion: 1 }] }, t);
  expect((await sync({ ops: [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 1, data: 2 }] }, t)).status).toBe(409);
  expect((await sync({ ops: [{ op: 'deletePlan', planId: 'p', baseVersion: 1 }] }, t)).status).toBe(200);
  const res = await sync({ ops: [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 3 }] }, t);
  expect(await res.json()).toEqual({ ok: true, versions: { terms: {}, plans: { p: 1 } } });
});

test("users cannot see or touch each other's data", async () => {
  const { user, sync, snap } = setup();
  const a = user('a@ucsd.edu');
  const b = user('b@ucsd.edu');
  await sync({ ops: [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 'A' }, { op: 'putCourses', courses: [course('c')] }] }, a);
  expect(await snap(b)).toEqual({ terms: {}, plans: {}, pool: [], appt: null });
  expect((await sync({ ops: [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 'B' }] }, b)).status).toBe(200);
  await sync({ ops: [{ op: 'deletePlan', planId: 'p', baseVersion: 1 }, { op: 'deleteCourses', ids: ['c'] }] }, b);
  const snapA = await snap(a);
  expect(snapA.plans.p.data).toBe('A');
  expect(snapA.pool).toEqual([{ id: 'c', pad: '' }]);
});

test('a 3 MB pool upload is accepted; a 9 MB body is 413', async () => {
  const { user, sync, snap } = setup();
  const t = user('a@ucsd.edu');
  const courses = Array.from({ length: 30 }, (_, i) => course(`c${i}`, 100_000));
  expect((await sync({ ops: [{ op: 'putCourses', courses }] }, t)).status).toBe(200);
  expect((await snap(t)).pool).toHaveLength(30);
  const big = await sync({ ops: [{ op: 'putCourses', courses: [course('x', 9_000_000)] }] }, t);
  expect(big.status).toBe(413);
  expect(await big.json()).toEqual({ error: 'too_large' });
});

test('one oversized doc or course is 413 doc_too_large and nothing is written', async () => {
  const { user, sync, snap } = setup();
  const t = user('a@ucsd.edu');
  const res = await sync({ ops: [
    { op: 'putCourses', courses: [course('ok')] },
    { op: 'putTerm', termKey: 'FA26', baseVersion: 0, data: 'x'.repeat(1_100_000) },
  ] }, t);
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: 'doc_too_large' });
  const res2 = await sync({ ops: [{ op: 'putCourses', courses: [course('big', 1_100_000)] }] }, t);
  expect(res2.status).toBe(413);
  expect((await snap(t)).pool).toEqual([]);
});

test('more than 500 ops or a malformed op is 400', async () => {
  const { user, sync } = setup();
  const t = user('a@ucsd.edu');
  const del = { op: 'deleteCourses', ids: ['a'] };
  expect((await sync({ ops: Array(501).fill(del) }, t)).status).toBe(400);
  expect((await sync({ ops: Array(500).fill(del) }, t)).status).toBe(200);
  const bad: unknown[] = [
    [], { ops: [] }, { ops: [{ op: 'nope' }] },
    { ops: [{ op: 'putTerm', termKey: '', baseVersion: 0, data: 1 }] },
    { ops: [{ op: 'putTerm', termKey: 'x'.repeat(101), baseVersion: 0, data: 1 }] },
    { ops: [{ op: 'putTerm', termKey: 'a', baseVersion: -1, data: 1 }] },
    { ops: [{ op: 'putTerm', termKey: 'a', baseVersion: 1.5, data: 1 }] },
    { ops: [{ op: 'putPlan', planId: 'p', baseVersion: 0, data: 1 }] },
    { ops: [{ op: 'putCourses', courses: [{ name: 'no id' }] }] },
    { ops: [{ op: 'putCourses', courses: ['str'] }] },
    { ops: [{ op: 'deleteCourses', ids: [1] }] },
    { ops: [{ op: 'putAppt', data: 'x' }] },
  ];
  for (const b of bad) {
    const res = await sync(b, t);
    expect(res.status, JSON.stringify(b)).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  }
  const malformed = await sync(null, t, '{not json');
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ error: 'invalid_request' });
});

test('/api/state and /api/sync require a session', async () => {
  const { sync, state } = setup();
  expect((await state()).status).toBe(401);
  expect((await sync({ ops: [] })).status).toBe(401);
});
