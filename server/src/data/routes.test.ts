import { expect, test, vi } from 'vitest';
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
  const body = (await res.json()) as any;
  expect(body.ok).toBe(true);
  const all = [body.versions.terms.FA26, body.versions.plans.p1, body.versions.plans.p2];
  expect(all.every((v: number) => v > 0)).toBe(true);
  expect(new Set(all).size).toBe(3);
  const s = await snap(t);
  expect(s.terms).toEqual({ FA26: { version: body.versions.terms.FA26, data: { a: 1 } } });
  expect(s.plans.p1.version).toBe(body.versions.plans.p1);
  expect(s.plans.p2.version).toBe(body.versions.plans.p2);
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

test('putPlan on a plan deleted elsewhere is a conflict; delete of a missing row is fine; a stale base cannot hit the recreated doc', async () => {
  const { user, sync, snap } = setup();
  const t = user('a@ucsd.edu');
  const put = (base: number, data: unknown) => sync({ ops: [{ op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: base, data }] }, t);
  const a = ((await (await put(0, 'old')).json()) as any).versions.plans.p;
  await sync({ ops: [{ op: 'deletePlan', planId: 'p', baseVersion: a }] }, t);
  expect((await put(a, 'x')).status).toBe(409);
  expect((await sync({ ops: [{ op: 'deletePlan', planId: 'p', baseVersion: a }] }, t)).status).toBe(200);
  const b = ((await (await put(0, 'new')).json()) as any).versions.plans.p;
  expect(b).toBeGreaterThan(a);
  const stale = await put(a, 'stale');
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ ok: false, error: 'conflict', conflicts: [{ kind: 'plan', id: 'p' }] });
  expect((await snap(t)).plans.p).toEqual({ version: b, termKey: 'FA26', data: 'new' });
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
    { ops: [{ op: 'putTerm', termKey: 'a', baseVersion: 0 }] },
    { ops: [{ op: 'putTerm', termKey: '__proto__', baseVersion: 0, data: 1 }] },
    { ops: [{ op: 'putPlan', planId: 'constructor', termKey: 'a', baseVersion: 0, data: 1 }] },
    { ops: [{ op: 'deleteCourses', ids: Array(10_001).fill('a') }] },
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

test('an unexpected failure mid-batch answers 500 and applies nothing', async () => {
  const deps = testDeps();
  const app = createApp(deps);
  const u = createUser(deps.db, { email: 'a@ucsd.edu', verified: true, passwordHash: null, googleSub: null }, now);
  const token = createSession(deps.db, u.id, now);
  deps.db.exec('DROP TABLE pool_courses'); // the second op's statement fails after the first op wrote
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const res = await app.request('/api/sync', {
    method: 'POST',
    headers: { Origin: 'https://tritonplan.cn', 'Content-Type': 'application/json', Cookie: `tp_session=${token}` },
    body: JSON.stringify({ ops: [
      { op: 'putPlan', planId: 'p', termKey: 'FA26', baseVersion: 0, data: 1 },
      { op: 'putCourses', courses: [{ id: 'c' }] },
    ] }),
  });
  spy.mockRestore();
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'server' });
  expect(deps.db.prepare('SELECT COUNT(*) AS n FROM plan_docs').get()).toEqual({ n: 0 });
});
