import { expect, test } from 'vitest';
import { createApp } from '../app';
import { createSession } from '../auth/sessions';
import { createUser } from '../auth/users';
import { testDeps } from '../test-helpers';

const now = new Date('2026-01-15T12:00:00.000Z');
const T = now.toISOString();
const plan = { version: 1, term: { year: '2026', period: '2', label: 'Fall 2026' }, entries: [{ courseId: 'CSE 100' }] };

function setup() {
  const deps = testDeps();
  const app = createApp(deps);
  const mk = (email: string) => {
    const u = createUser(deps.db, { email, verified: true, passwordHash: null, googleSub: null }, now);
    return { ...u, email, token: createSession(deps.db, u.id, now) };
  };
  const send = (method: string, path: string, body: unknown, token?: string, raw?: string) =>
    app.request(path, {
      method,
      headers: { Origin: 'https://tritonplan.cn', 'Content-Type': 'application/json', ...(token ? { Cookie: `tp_session=${token}` } : {}) },
      body: raw ?? JSON.stringify(body),
    });
  const get = (path: string, token?: string, headers: Record<string, string> = {}) =>
    app.request(path, { headers: { ...(token ? { Cookie: `tp_session=${token}` } : {}), ...headers } });
  const create = async (token: string, name = 'My plan', p: unknown = plan) => {
    const res = await send('POST', '/api/shares', { name, plan: p }, token);
    return (await res.json()) as { code: string; url: string };
  };
  return { deps, mk, send, get, create };
}

test('every share route that needs an account answers 401 without a session', async () => {
  const { send, get } = setup();
  expect((await send('POST', '/api/shares', { name: 'x', plan })).status).toBe(401);
  expect((await get('/api/shares')).status).toBe(401);
  expect((await send('DELETE', '/api/shares/AAAAAAAAAA', {})).status).toBe(401);
});

test('a share is a snapshot: later edits to my plan do not change it', async () => {
  const { deps, mk, send, get } = setup();
  const u = mk('a@ucsd.edu');
  deps.db.prepare('INSERT INTO plan_docs VALUES (?, ?, ?, 1, ?, ?)').run(u.id, 'p1', 'FA26', JSON.stringify(plan), T);
  const created = await send('POST', '/api/shares', { name: 'My plan', plan }, u.token);
  expect(created.status).toBe(200);
  const { code, url } = (await created.json()) as { code: string; url: string };
  expect(code).toMatch(/^[0-9A-Za-z]{10}$/);
  expect(url).toBe(`https://tritonplan.cn/s/${code}`);

  deps.db.prepare('UPDATE plan_docs SET data = ?, version = 2 WHERE user_id = ?').run(JSON.stringify({ ...plan, entries: [] }), u.id);
  const res = await get(`/api/s/${code}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ name: 'My plan', plan, createdAt: T });
});

test('anyone can open a share without signing in, and sees no owner data', async () => {
  const { mk, create, get } = setup();
  const u = mk('owner@ucsd.edu');
  const { code } = await create(u.token);
  const res = await get(`/api/s/${code}`); // no cookie, no Origin
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = await res.json();
  expect(Object.keys(body as object).sort()).toEqual(['createdAt', 'name', 'plan']);
  const text = JSON.stringify(body);
  expect(text).not.toContain('owner@ucsd.edu');
  expect(text).not.toContain(u.id);
});

test('revoked, unknown and malformed codes are 404', async () => {
  const { mk, send, create, get } = setup();
  const u = mk('a@ucsd.edu');
  const { code } = await create(u.token);
  expect((await send('DELETE', `/api/shares/${code}`, {}, u.token)).status).toBe(200);
  for (const c of [code, 'ZZZZZZZZZZ', 'short', 'AAAAAAAAAAA', 'AAAAAAAAA-', '%20AAAAAAAAA']) {
    const res = await get(`/api/s/${c}`);
    expect(res.status, c).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  }
});

test('only the owner can list and revoke their shares', async () => {
  const { mk, send, create, get } = setup();
  const a = mk('a@ucsd.edu');
  const b = mk('b@ucsd.edu');
  const first = await create(a.token, 'first');
  const second = await create(a.token, 'second');

  const list = (await (await get('/api/shares', a.token)).json()) as { shares: { code: string; name: string; url: string; createdAt: string }[] };
  expect(list.shares.map((s) => s.code).sort()).toEqual([first.code, second.code].sort());
  expect(list.shares[0]).toEqual({ code: expect.any(String), name: expect.any(String), url: expect.stringContaining('https://tritonplan.cn/s/'), createdAt: T });
  expect(((await (await get('/api/shares', b.token)).json()) as { shares: unknown[] }).shares).toEqual([]);

  const other = await send('DELETE', `/api/shares/${first.code}`, {}, b.token);
  expect(other.status).toBe(404);
  expect(await other.json()).toEqual({ error: 'not_found' });
  expect((await get(`/api/s/${first.code}`)).status).toBe(200);

  expect((await send('DELETE', `/api/shares/${first.code}`, {}, a.token)).status).toBe(200);
  expect((await send('DELETE', `/api/shares/${first.code}`, {}, a.token)).status).toBe(404);
  expect((await get(`/api/s/${first.code}`)).status).toBe(404);
  expect((await get(`/api/s/${second.code}`)).status).toBe(200);
});

test('write guards apply to create and revoke', async () => {
  const { deps, mk, create } = setup();
  const u = mk('a@ucsd.edu');
  const app = createApp(deps);
  const { code } = await create(u.token);
  const cookie = { Cookie: `tp_session=${u.token}` };
  const wrongOrigin = await app.request('/api/shares', { method: 'POST', headers: { ...cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', plan }) });
  expect(wrongOrigin.status).toBe(403);
  const noJson = await app.request(`/api/shares/${code}`, { method: 'DELETE', headers: { ...cookie, Origin: 'https://tritonplan.cn' } });
  expect(noJson.status).toBe(403);
  expect(((await (await app.request('/api/shares', { headers: cookie })).json()) as { shares: unknown[] }).shares).toHaveLength(1);
});

test('deleting the account deletes its shares', async () => {
  const { mk, send, create, get } = setup();
  const u = mk('a@ucsd.edu');
  const o = mk('o@ucsd.edu');
  const mine = await create(u.token);
  const theirs = await create(o.token);
  const res = await send('DELETE', '/api/account', { confirmEmail: 'a@ucsd.edu' }, u.token);
  expect(res.status).toBe(200);
  expect((await get(`/api/s/${mine.code}`)).status).toBe(404);
  expect((await get(`/api/s/${theirs.code}`)).status).toBe(200);
});

test('oversized plan -> 413, malformed plan -> 400', async () => {
  const { mk, send, get } = setup();
  const u = mk('a@ucsd.edu');
  const big = await send('POST', '/api/shares', { name: 'big', plan: { ...plan, entries: ['x'.repeat(1_000_001)] } }, u.token);
  expect(big.status).toBe(413);
  expect(await big.json()).toEqual({ error: 'doc_too_large' });
  const huge = await send('POST', '/api/shares', { name: 'huge', plan: { ...plan, entries: ['x'.repeat(1_300_000)] } }, u.token);
  expect(huge.status).toBe(413);
  expect(await huge.json()).toEqual({ error: 'too_large' });

  const bad: unknown[] = [
    { name: 'x', plan: { ...plan, version: 2 } },
    { name: 'x', plan: { ...plan, entries: 'nope' } },
    { name: 'x', plan: { ...plan, term: { year: '2026' } } },
    { name: 'x' },
    { name: '', plan },
    { name: 'n'.repeat(101), plan },
    { plan },
    [],
  ];
  for (const b of bad) expect((await send('POST', '/api/shares', b, u.token)).status, JSON.stringify(b).slice(0, 60)).toBe(400);
  expect((await send('POST', '/api/shares', null, u.token, '{not json')).status).toBe(400);
  expect(((await (await get('/api/shares', u.token)).json()) as { shares: unknown[] }).shares).toEqual([]);
});

test('the 61st share in an hour is 429 with retryAfter, per user', async () => {
  const { mk, send } = setup();
  const u = mk('a@ucsd.edu');
  const o = mk('o@ucsd.edu');
  for (let i = 0; i < 60; i++) expect((await send('POST', '/api/shares', { name: `s${i}`, plan }, u.token)).status).toBe(200);
  const res = await send('POST', '/api/shares', { name: 'one more', plan }, u.token);
  expect(res.status).toBe(429);
  const b = (await res.json()) as { error: string; retryAfter: number };
  expect(b.error).toBe('rate_limited');
  expect(b.retryAfter).toBeGreaterThan(0);
  expect((await send('POST', '/api/shares', { name: 'other user', plan }, o.token)).status).toBe(200);
});

test('a user with 500 live shares gets 409 too_many_shares', async () => {
  const { deps, mk, send } = setup();
  const u = mk('a@ucsd.edu');
  const ins = deps.db.prepare('INSERT INTO shares VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < 500; i++) ins.run(`code${String(i).padStart(6, '0')}`, u.id, 'n', '{}', T);
  const res = await send('POST', '/api/shares', { name: 'x', plan }, u.token);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'too_many_shares' });
});

test('opening shares is limited to 300 per 15 minutes per IP', async () => {
  const { get } = setup();
  const ip = { 'x-real-ip': '203.0.113.7' };
  for (let i = 0; i < 300; i++) expect((await get('/api/s/AAAAAAAAAA', undefined, ip)).status).toBe(404);
  const res = await get('/api/s/AAAAAAAAAA', undefined, ip);
  expect(res.status).toBe(429);
  expect(((await res.json()) as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  expect((await get('/api/s/AAAAAAAAAA', undefined, { 'x-real-ip': '203.0.113.8' })).status).toBe(404);
});
