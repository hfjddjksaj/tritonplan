import { expect, test } from 'vitest';
import { SHARED_PLAN_TTL_MS } from '@triton/shared';
import { createApp } from '../app';
import { createSession } from '../auth/sessions';
import { createUser } from '../auth/users';
import { testDeps } from '../test-helpers';
import { startSharedSweep } from './routes';

const start = new Date('2026-01-15T12:00:00.000Z');
const entry = (id: string, options: string[], selected: string | null = options[0]!) => ({
  course: { id, title: id, options: options.map((o) => ({ id: o, label: o, components: [] })) },
  selectedOptionId: selected,
});
const plan = {
  version: 1,
  term: { year: '2026', period: '010', label: 'Winter 2026' },
  entries: [entry('CSE 100', ['a', 'b']), entry('MATH 20C', ['x'])],
};

function setup() {
  const clock = { t: start };
  const deps = testDeps({ now: () => clock.t });
  const app = createApp(deps);
  const mk = (email: string) => {
    const u = createUser(deps.db, { email, verified: true, passwordHash: null, googleSub: null }, start);
    return { ...u, email, token: createSession(deps.db, u.id, start) };
  };
  const send = (method: string, path: string, body: unknown, token?: string, raw?: string, headers: Record<string, string> = {}) =>
    app.request(path, {
      method,
      headers: { Origin: 'https://tritonplan.cn', 'Content-Type': 'application/json', ...(token ? { Cookie: `tp_session=${token}` } : {}), ...headers },
      body: raw ?? JSON.stringify(body),
    });
  const get = (path: string, token?: string, headers: Record<string, string> = {}) =>
    app.request(path, { headers: { ...(token ? { Cookie: `tp_session=${token}` } : {}), ...headers } });
  const create = async (token: string, name = 'My plan', p: unknown = plan) => {
    const res = await send('POST', '/api/shared', { name, plan: p }, token);
    return (await res.json()) as { code: string; url: string; expiresAt: string };
  };
  const select = (code: string, body: unknown, headers?: Record<string, string>) =>
    send('POST', `/api/s/${code}/select`, body, undefined, undefined, headers);
  return { deps, clock, mk, send, get, create, select };
}

test('signed-in share routes answer 401 without a session', async () => {
  const { send, get } = setup();
  expect((await send('POST', '/api/shared', { name: 'x', plan })).status).toBe(401);
  expect((await get('/api/shared')).status).toBe(401);
});

test('create returns a code, url and expiry seven days out', async () => {
  const { mk, send } = setup();
  const u = mk('a@ucsd.edu');
  const res = await send('POST', '/api/shared', { name: 'My plan', plan }, u.token);
  expect(res.status).toBe(200);
  const b = (await res.json()) as { code: string; url: string; expiresAt: string };
  expect(b.code).toMatch(/^[0-9A-Za-z]{10}$/);
  expect(b.url).toBe(`https://tritonplan.cn/s/${b.code}`);
  expect(b.expiresAt).toBe(new Date(start.getTime() + SHARED_PLAN_TTL_MS).toISOString());
});

test('anyone can read a shared plan, and the response carries no owner data', async () => {
  const { mk, create, get } = setup();
  const u = mk('owner@ucsd.edu');
  const { code, expiresAt } = await create(u.token);
  const res = await get(`/api/s/${code}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['expiresAt', 'name', 'plan', 'version']);
  expect(body).toMatchObject({ name: 'My plan', version: 1, expiresAt });
  const text = JSON.stringify(body);
  expect(text).not.toContain('owner@ucsd.edu');
  expect(text).not.toContain(u.id);
  const v = await get(`/api/s/${code}/version`);
  expect(await v.json()).toEqual({ version: 1 });
  expect(v.headers.get('cache-control')).toBe('no-store');
});

test('select switches a section, bumps the version, and the next read shows it', async () => {
  const { mk, create, get, select } = setup();
  const u = mk('a@ucsd.edu');
  const { code } = await create(u.token);
  const res = await select(code, { courseId: 'CSE 100', optionId: 'b' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ version: 2 });
  const read = (await (await get(`/api/s/${code}`)).json()) as { plan: typeof plan; version: number };
  expect(read.version).toBe(2);
  expect(read.plan.entries[0]!.selectedOptionId).toBe('b');
  expect(read.plan.entries[1]!.selectedOptionId).toBe('x');
  expect(((await (await get(`/api/s/${code}/version`)).json()) as { version: number }).version).toBe(2);
});

test('select rejects anything but an existing option', async () => {
  const { mk, create, get, select, send } = setup();
  const u = mk('a@ucsd.edu');
  const { code } = await create(u.token);
  const bad: unknown[] = [
    { courseId: 'NOPE 1', optionId: 'a' },
    { courseId: 'CSE 100', optionId: 'zzz' },
    { courseId: 'CSE 100', optionId: 'b', extra: 1 },
    { courseId: 'CSE 100' },
    { optionId: 'b' },
    { courseId: '', optionId: 'b' },
    { courseId: 'c'.repeat(201), optionId: 'b' },
    { courseId: 5, optionId: 'b' },
    [],
  ];
  for (const b of bad) expect((await select(code, b)).status, JSON.stringify(b)).toBe(400);
  expect((await send('POST', `/api/s/${code}/select`, null, undefined, '{nope')).status).toBe(400);
  expect(((await (await get(`/api/s/${code}/version`)).json()) as { version: number }).version).toBe(1);
});

test('select needs the same origin and a JSON body', async () => {
  const { mk, create, select, send } = setup();
  const u = mk('a@ucsd.edu');
  const { code } = await create(u.token);
  expect((await select(code, { courseId: 'CSE 100', optionId: 'b' }, { Origin: 'https://evil.example' })).status).toBe(403);
  expect((await send('POST', `/api/s/${code}/select`, null, undefined, 'x', { 'Content-Type': 'text/plain' })).status).toBe(403);
});

test('unknown, malformed and expired codes are 404 everywhere', async () => {
  const { mk, create, get, select, clock } = setup();
  const u = mk('a@ucsd.edu');
  const { code } = await create(u.token);
  const body = { courseId: 'CSE 100', optionId: 'b' };
  for (const c of ['ZZZZZZZZZZ', 'short', 'AAAAAAAAAAA', 'AAAAAAAAA-']) {
    expect((await get(`/api/s/${c}`)).status, c).toBe(404);
    expect((await get(`/api/s/${c}/version`)).status, c).toBe(404);
    expect((await select(c, body)).status, c).toBe(404);
  }
  clock.t = new Date(start.getTime() + SHARED_PLAN_TTL_MS);
  for (const res of [await get(`/api/s/${code}`), await get(`/api/s/${code}/version`), await select(code, body)]) {
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  }
  expect(((await (await get('/api/shared', u.token)).json()) as { shared: unknown[] }).shared).toEqual([]);
});

test('the list shows only my live copies', async () => {
  const { mk, create, get } = setup();
  const a = mk('a@ucsd.edu');
  const b = mk('b@ucsd.edu');
  const first = await create(a.token, 'first');
  await create(b.token, 'theirs');
  const list = (await (await get('/api/shared', a.token)).json()) as { shared: Record<string, unknown>[] };
  expect(list.shared).toEqual([
    { code: first.code, name: 'first', termKey: '2026|010', createdAt: start.toISOString(), expiresAt: first.expiresAt, url: first.url },
  ]);
});

test('create validates the body and size', async () => {
  const { mk, send, get } = setup();
  const u = mk('a@ucsd.edu');
  const pad = (n: number) => [{ ...entry('CSE 100', ['a']), pad: 'x'.repeat(n) }];
  const big = await send('POST', '/api/shared', { name: 'big', plan: { ...plan, entries: pad(1_000_001) } }, u.token);
  expect(big.status).toBe(413);
  expect(await big.json()).toEqual({ error: 'doc_too_large' });
  const huge = await send('POST', '/api/shared', { name: 'huge', plan: { ...plan, entries: pad(1_300_000) } }, u.token);
  expect(huge.status).toBe(413);
  expect(await huge.json()).toEqual({ error: 'too_large' });

  const bad: unknown[] = [
    { name: 'x', plan: { ...plan, version: 2 } },
    { name: 'x', plan: { ...plan, entries: 'nope' } },
    { name: 'x', plan: { ...plan, entries: ['x'] } },
    { name: 'x', plan: { ...plan, entries: [{ course: { id: 'a' } }] } },
    { name: 'x', plan: { ...plan, term: { year: '2026' } } },
    { name: 'x' },
    { name: '', plan },
    { name: 'n'.repeat(101), plan },
    { plan },
    [],
  ];
  for (const b of bad) expect((await send('POST', '/api/shared', b, u.token)).status, JSON.stringify(b).slice(0, 60)).toBe(400);
  expect((await send('POST', '/api/shared', null, u.token, '{not json')).status).toBe(400);
  expect(((await (await get('/api/shared', u.token)).json()) as { shared: unknown[] }).shared).toEqual([]);
});

test('the 51st live copy is 409 too_many_shares', async () => {
  const { mk, send } = setup();
  const u = mk('a@ucsd.edu');
  for (let i = 0; i < 50; i++) expect((await send('POST', '/api/shared', { name: `s${i}`, plan }, u.token)).status).toBe(200);
  const res = await send('POST', '/api/shared', { name: 'x', plan }, u.token);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'too_many_shares' });
});

test('the 61st create in an hour is 429 with retryAfter, per user', async () => {
  const { deps, mk, send } = setup();
  const u = mk('a@ucsd.edu');
  const o = mk('o@ucsd.edu');
  // Free the live cap so the hourly limit is what trips.
  for (let i = 0; i < 60; i++) {
    expect((await send('POST', '/api/shared', { name: `s${i}`, plan }, u.token)).status === 200 || i >= 50).toBe(true);
    if (i === 49) deps.db.prepare('DELETE FROM shared_plans').run();
  }
  const res = await send('POST', '/api/shared', { name: 'one more', plan }, u.token);
  expect(res.status).toBe(429);
  expect(((await res.json()) as { error: string; retryAfter: number }).retryAfter).toBeGreaterThan(0);
  expect((await send('POST', '/api/shared', { name: 'other', plan }, o.token)).status).toBe(200);
});

test('public reads, polls and selects each have a per-IP budget', async () => {
  const { get, select } = setup();
  const ip = { 'x-real-ip': '203.0.113.7' };
  for (let i = 0; i < 300; i++) await get('/api/s/AAAAAAAAAA', undefined, ip);
  const read = await get('/api/s/AAAAAAAAAA', undefined, ip);
  expect(read.status).toBe(429);
  expect(((await read.json()) as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  expect((await get('/api/s/AAAAAAAAAA', undefined, { 'x-real-ip': '203.0.113.8' })).status).toBe(404);
  // Polling is budgeted separately, so the exhausted read budget leaves it open.
  expect((await get('/api/s/AAAAAAAAAA/version', undefined, ip)).status).toBe(404);

  const sip = { 'x-real-ip': '203.0.113.9' };
  for (let i = 0; i < 600; i++) await select('AAAAAAAAAA', { courseId: 'a', optionId: 'b' }, sip);
  const res = await select('AAAAAAAAAA', { courseId: 'a', optionId: 'b' }, sip);
  expect(res.status).toBe(429);
  expect(((await res.json()) as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
});

test('the version poll allows 6000 requests per 15 minutes per IP', async () => {
  const { get } = setup();
  const ip = { 'x-real-ip': '203.0.113.20' };
  for (let i = 0; i < 6000; i++) {
    const res = await get('/api/s/AAAAAAAAAA/version', undefined, ip);
    if (res.status !== 404) throw new Error(`request ${i + 1} got ${res.status}`);
  }
  expect((await get('/api/s/AAAAAAAAAA/version', undefined, ip)).status).toBe(429);
});

test('an oversized select body is turned away with 413 before it is read', async () => {
  const { mk, create, get, select } = setup();
  const { code } = await create(mk('a@ucsd.edu').token);
  const big = { courseId: 'CSE 100', optionId: 'b', pad: 'x'.repeat(5000) };
  const res = await select(code, big);
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: 'too_large' });
  expect(((await (await get(`/api/s/${code}/version`)).json()) as { version: number }).version).toBe(1);
});

test('a throwing sweep does not throw out of the timer callback', async () => {
  const { deps } = setup();
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const stop = startSharedSweep({ ...deps, db: { prepare: () => { throw new Error('boom'); } } as unknown as typeof deps.db });
    expect(() => vi.advanceTimersByTime(3_600_000)).not.toThrow();
    expect(err).toHaveBeenCalled();
    stop();
  } finally {
    err.mockRestore();
    vi.useRealTimers();
  }
});

test('the old snapshot routes are gone', async () => {
  const { mk, get } = setup();
  const u = mk('a@ucsd.edu');
  expect((await get('/api/shares', u.token)).status).toBe(404);
});

test('the sweep timer removes expired rows and stops when asked', async () => {
  const { deps, mk, create, clock } = setup();
  const u = mk('a@ucsd.edu');
  await create(u.token);
  const count = () => (deps.db.prepare('SELECT COUNT(*) AS n FROM shared_plans').get() as { n: number }).n;
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  try {
    const stop = startSharedSweep(deps);
    clock.t = new Date(start.getTime() + SHARED_PLAN_TTL_MS);
    vi.advanceTimersByTime(3_600_000);
    expect(count()).toBe(0);
    stop();
  } finally {
    vi.useRealTimers();
  }
});
