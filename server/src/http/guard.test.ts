import { Hono } from 'hono';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { createSession } from '../auth/sessions';
import { testDeps } from '../test-helpers';
import { clientIp, requireUser, sameOriginJson, type AppEnv } from './guard';

const ORIGIN = 'https://tritonplan.cn';
const post = (app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, headers: Record<string, string>, path = '/api/x') =>
  app.request(path, { method: 'POST', headers, body: '{}' });

test('sameOriginJson blocks cross-site and non-JSON writes, lets GET through', async () => {
  const deps = testDeps();
  const app = new Hono();
  app.use('/api/*', sameOriginJson(deps.config));
  app.all('/api/x', (c) => c.json({ ok: true }));
  const json = { 'Content-Type': 'application/json' };

  expect((await post(app, json)).status).toBe(403);
  expect((await post(app, { ...json, Origin: 'https://evil.com' })).status).toBe(403);
  expect((await post(app, { ...json, Origin: 'null' })).status).toBe(403);
  expect((await post(app, { Origin: ORIGIN, 'Content-Type': 'text/plain' })).status).toBe(403);
  expect((await post(app, { Origin: ORIGIN })).status).toBe(403);
  const denied = await post(app, { ...json, Origin: 'https://evil.com' });
  expect(await denied.json()).toEqual({ error: 'forbidden' });

  expect((await post(app, { Origin: ORIGIN, 'Content-Type': 'application/json' })).status).toBe(200);
  expect((await post(app, { Origin: ORIGIN, 'content-type': 'application/JSON; charset=utf-8' })).status).toBe(200);
  expect((await app.request('/api/x')).status).toBe(200);
  expect((await app.request('/api/x', { method: 'HEAD' })).status).toBe(200);
  for (const m of ['PUT', 'PATCH', 'DELETE']) {
    expect((await app.request('/api/x', { method: m })).status).toBe(403);
  }
});

test('createApp guards every /api write, even to routes that do not exist', async () => {
  const app = createApp(testDeps());
  const res = await post(app, { 'Content-Type': 'application/json' }, '/api/nope');
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: 'forbidden' });
  expect((await app.request('/api/health')).status).toBe(200);
});

test('requireUser: 401 without a valid cookie, sets vars, re-sends cookie on refresh', async () => {
  const deps = testDeps();
  deps.db.prepare('insert into users (id, email, created_at) values (?, ?, ?)').run('u1', 'a@b.com', '2026-01-01T00:00:00Z');
  const app = new Hono<AppEnv>();
  app.use('/me', requireUser(deps));
  app.get('/me', (c) => c.json({ id: c.get('userId'), tok: c.get('sessionToken') }));

  const none = await app.request('/me');
  expect(none.status).toBe(401);
  expect(await none.json()).toEqual({ error: 'unauthorized' });
  expect((await app.request('/me', { headers: { Cookie: 'tp_session=bogus' } })).status).toBe(401);

  // Created Jan 14 00:00, "now" is Jan 15 12:00 -> 28.5 days left -> refresh.
  const tok = createSession(deps.db, 'u1', new Date('2026-01-14T00:00:00Z'));
  const ok = await app.request('/me', { headers: { Cookie: `other=1; tp_session=${tok}` } });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ id: 'u1', tok });
  expect(ok.headers.get('set-cookie')).toContain(`tp_session=${tok}; HttpOnly`);

  const fresh = createSession(deps.db, 'u1', deps.now());
  const noRefresh = await app.request('/me', { headers: { Cookie: `tp_session=${fresh}` } });
  expect(noRefresh.status).toBe(200);
  expect(noRefresh.headers.get('set-cookie')).toBeNull();
});

test('clientIp buckets IPv6 to /64 and unwraps IPv4-mapped addresses', async () => {
  const app = new Hono();
  app.get('/ip', (c) => c.text(clientIp(c)));
  const ip = async (v: string) => (await app.request('/ip', { headers: { 'X-Real-IP': v } })).text();
  expect(await ip('203.0.113.9')).toBe('203.0.113.9');
  const a = await ip('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
  expect(a).toBe(await ip('2001:0DB8:1:2::1'));
  expect(a).not.toBe(await ip('2001:db8:1:3::1'));
  expect(await ip('::ffff:1.2.3.4')).toBe('1.2.3.4');
});

test('clientIp reads X-Real-IP, else "local"', async () => {
  const app = new Hono();
  app.get('/ip', (c) => c.text(clientIp(c)));
  expect(await (await app.request('/ip', { headers: { 'X-Real-IP': '1.2.3.4' } })).text()).toBe('1.2.3.4');
  expect(await (await app.request('/ip')).text()).toBe('local');
});
