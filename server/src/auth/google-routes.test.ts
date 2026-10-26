import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { testDeps } from '../test-helpers';
import { createSession } from './sessions';
import { newId } from './tokens';

const now = new Date('2026-01-15T12:00:00.000Z');
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeIdToken = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
const claims = (over: Record<string, unknown> = {}) => ({
  aud: 'test-google-id',
  iss: 'https://accounts.google.com',
  exp: now.getTime() / 1000 + 600,
  sub: 'sub-1',
  email: 'g@ucsd.edu',
  email_verified: true,
  ...over,
});

function setup(idClaims: Record<string, unknown> = claims()) {
  const calls: { url: string; body: URLSearchParams; signal?: AbortSignal | null }[] = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: new URLSearchParams(String(init.body)), signal: init.signal });
    return new Response(JSON.stringify({ id_token: fakeIdToken(idClaims) }), { status: 200 });
  }) as unknown as typeof fetch;
  const deps = testDeps({ fetch: fetchStub });
  const app = createApp(deps);
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { Origin: 'https://tritonplan.cn', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const jar = (res: Response) => {
    const out: Record<string, string> = {};
    for (const line of res.headers.getSetCookie()) {
      const kv = line.split(';')[0]!;
      const i = kv.indexOf('=');
      out[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return out;
  };
  const cookieHeader = (c: Record<string, string>) => `tp_g_state=${c.tp_g_state}; tp_g_verifier=${c.tp_g_verifier}; tp_g_return=${c.tp_g_return}`;
  /** Runs the start redirect, then the callback with the cookies the browser would send. */
  const flow = async (returnTo = '/migrate', stateOverride?: string) => {
    const start = await app.request(`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`);
    const c = jar(start);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const cb = await app.request(`/api/auth/google/callback?code=thecode&state=${stateOverride ?? state}`, { headers: { Cookie: cookieHeader(c) } });
    return { start, cb, cookies: jar(cb) };
  };
  const me = (session: string) => app.request('/api/me', { headers: { Cookie: `tp_session=${session}` } });
  return { deps, app, post, jar, flow, me, calls, cookieHeader };
}

test('start redirects to Google with PKCE and sets the three short-lived cookies', async () => {
  const { app, jar } = setup();
  const res = await app.request('/api/auth/google?returnTo=/migrate');
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get('location')!);
  expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(loc.searchParams.get('redirect_uri')).toBe('https://tritonplan.cn/api/auth/google/callback');
  expect(loc.searchParams.get('client_id')).toBe('test-google-id');
  const c = jar(res);
  expect(loc.searchParams.get('state')).toBe(c.tp_g_state);
  expect(loc.searchParams.get('code_challenge')).toBe(createHash('sha256').update(c.tp_g_verifier!).digest('base64url'));
  expect(decodeURIComponent(c.tp_g_return!)).toBe('/migrate');
  const lines = res.headers.getSetCookie();
  expect(lines).toHaveLength(3);
  for (const line of lines) {
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/SameSite=Lax/);
    expect(line).toMatch(/Path=\/api\/auth\/google/);
    expect(line).toMatch(/Max-Age=600/);
    expect(line).toMatch(/Secure/);
  }
});

test('callback with a mismatched state redirects to /?auth=google-failed and clears the cookies', async () => {
  const { flow, calls, deps } = setup();
  const { cb, cookies } = await flow('/migrate', 'wrong');
  expect(cb.status).toBe(302);
  expect(cb.headers.get('location')).toBe('/?auth=google-failed');
  expect(calls).toHaveLength(0);
  expect(cookies.tp_g_state).toBe('');
  expect(cookies.tp_g_verifier).toBe('');
  expect(cookies.tp_g_return).toBe('');
  expect(deps.db.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 0 });
});

test('callback without any cookies is google-failed', async () => {
  const { app } = setup();
  const res = await app.request('/api/auth/google/callback?code=c&state=s');
  expect(res.headers.get('location')).toBe('/?auth=google-failed');
});

test('callback survives a failed token exchange', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { deps, app, jar, cookieHeader } = setup();
  deps.fetch = (async () => new Response('{}', { status: 400 })) as unknown as typeof fetch;
  const start = await app.request('/api/auth/google');
  const c = jar(start);
  const res = await app.request(`/api/auth/google/callback?code=c&state=${c.tp_g_state}`, { headers: { Cookie: cookieHeader(c) } });
  expect(res.headers.get('location')).toBe('/?auth=google-failed');
  expect(log).toHaveBeenCalledOnce();
  log.mockRestore();
});

test('unverified google email redirects to /?auth=google-unverified and creates nobody', async () => {
  const { flow, deps } = setup(claims({ email_verified: false }));
  const { cb, cookies } = await flow();
  expect(cb.headers.get('location')).toBe('/?auth=google-unverified');
  expect(cookies.tp_session).toBeUndefined();
  expect(deps.db.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 0 });
});

test('new google user is created verified and signed in, back to returnTo', async () => {
  const { flow, me, calls } = setup(claims({ email: 'New@UCSD.edu ' }));
  const { cb, cookies } = await flow('/migrate');
  expect(cb.status).toBe(302);
  expect(cb.headers.get('location')).toBe('/migrate');
  expect(cookies.tp_g_state).toBe('');
  expect(await (await me(cookies.tp_session!)).json()).toEqual({ email: 'new@ucsd.edu', hasPassword: false, hasGoogle: true });
  const b = calls[0]!.body;
  expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
  expect(b.get('code')).toBe('thecode');
  expect(b.get('grant_type')).toBe('authorization_code');
  expect(b.get('client_id')).toBe('test-google-id');
  expect(b.get('client_secret')).toBe('test-google-secret');
  expect(b.get('redirect_uri')).toBe('https://tritonplan.cn/api/auth/google/callback');
  expect(b.get('code_verifier')).toBeTruthy();
  expect(calls[0]!.signal).toBeTruthy();
});

test('an off-site returnTo falls back to /', async () => {
  const { flow } = setup();
  const { cb } = await flow('//evil.com');
  expect(cb.headers.get('location')).toBe('/');
});

test('google sign-in links to an existing verified password account by email', async () => {
  const { flow, me, post, deps } = setup();
  await post('/api/auth/signup', { email: 'g@ucsd.edu', password: 'hunter2hunter2' });
  const token = /token=([\w-]+)/.exec(deps.mailer.sent[0]!.text)![1]!;
  const v = await post('/api/auth/verify', { token, password: 'hunter2hunter2' });
  const first = /tp_session=([^;]+)/.exec(v.headers.get('set-cookie')!)![1]!;
  const a = (await (await me(first)).json()) as Record<string, unknown>;
  const { cookies } = await flow();
  expect(await (await me(cookies.tp_session!)).json()).toEqual({ ...a, hasGoogle: true });
  expect(deps.db.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 1 });
  // A verified row keeps its password and its existing sessions.
  expect((await me(first)).status).toBe(200);
});

test('google sign-in on an email someone pre-registered unverified clears their password', async () => {
  const { flow, me, post, deps } = setup(claims({ email: 'victim@ucsd.edu' }));
  await post('/api/auth/signup', { email: 'victim@ucsd.edu', password: 'attacker-pass1' });
  const user = deps.db.prepare("SELECT id FROM users WHERE email='victim@ucsd.edu'").get() as { id: string };
  // A session the attacker might hold on the pre-registered row.
  const attackerSession = createSession(deps.db, user.id, now);
  expect((await me(attackerSession)).status).toBe(200);

  const { cookies } = await flow();
  const login = await post('/api/auth/login', { email: 'victim@ucsd.edu', password: 'attacker-pass1' });
  expect(login.status).toBe(401);
  expect(await login.json()).toEqual({ error: 'invalid_credentials' });
  expect(await (await me(cookies.tp_session!)).json()).toEqual({ email: 'victim@ucsd.edu', hasPassword: false, hasGoogle: true });
  expect((await me(attackerSession)).status).toBe(401);
  expect(deps.db.prepare('SELECT COUNT(*) n FROM email_tokens WHERE user_id = ?').get(user.id)).toEqual({ n: 0 });
  expect(deps.db.prepare('SELECT email_verified v FROM users WHERE id = ?').get(user.id)).toEqual({ v: 1 });
  expect(deps.db.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 1 });
});

test('R19: an email-matched row with a different google_sub is re-bound and its old sessions die', async () => {
  const { flow, me, deps } = setup(claims({ sub: 'new-sub' }));
  const id = newId();
  deps.db.prepare("INSERT INTO users (id,email,email_verified,google_sub,created_at) VALUES (?,?,1,'old-sub','x')").run(id, 'g@ucsd.edu');
  const old = createSession(deps.db, id, now);
  const { cookies } = await flow();
  expect(deps.db.prepare('SELECT google_sub s FROM users WHERE id = ?').get(id)).toEqual({ s: 'new-sub' });
  expect((await me(old)).status).toBe(401);
  expect((await me(cookies.tp_session!)).status).toBe(200);
});

test('a returning google user is matched by sub even if the email changed', async () => {
  const { flow, me, deps } = setup(claims({ email: 'renamed@ucsd.edu', sub: 'sub-9' }));
  const id = newId();
  deps.db.prepare("INSERT INTO users (id,email,email_verified,google_sub,created_at) VALUES (?,?,1,'sub-9','x')").run(id, 'old@ucsd.edu');
  const { cookies } = await flow();
  expect(((await (await me(cookies.tp_session!)).json()) as { email: string }).email).toBe('old@ucsd.edu');
  expect(deps.db.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 1 });
});
