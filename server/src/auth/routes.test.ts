import { expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { testDeps } from '../test-helpers';
import { verifyPassword } from './passwords';
import { newId } from './tokens';

// Pass-through spy: lets a test prove a request never reached argon2.
vi.mock('./passwords', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./passwords')>();
  return { ...mod, verifyPassword: vi.fn(mod.verifyPassword) };
});

function setup() {
  const deps = testDeps();
  const app = createApp(deps);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: 'POST',
      headers: { Origin: 'https://tritonplan.cn', 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const tokenFrom = (i: number) => /token=([\w-]+)/.exec(deps.mailer.sent[i]!.text)![1]!;
  const cookieOf = (res: Response) => /tp_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  const me = (cookie: string) => app.request('/api/me', { headers: { Cookie: `tp_session=${cookie}` } });
  const verifyWith = (token: string, password: string) => post('/api/auth/verify', { token, password });
  const verified = async (email: string, pw: string) => {
    await post('/api/auth/signup', { email, password: pw });
    const v = await verifyWith(tokenFrom(deps.mailer.sent.length - 1), pw);
    expect(v.status).toBe(200);
    return cookieOf(v)!;
  };
  const googleOnly = (email: string) =>
    deps.db.prepare("INSERT INTO users (id,email,email_verified,google_sub,created_at) VALUES (?,?,1,?,'x')").run(newId(), email, newId());
  return { deps, app, post, tokenFrom, cookieOf, me, verified, googleOnly, verifyWith };
}

test('signup → verify with the password signs in → /api/me', async () => {
  const { post, tokenFrom, cookieOf, me, deps, verifyWith } = setup();
  const res = await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(deps.mailer.sent[0]!.text).toContain('https://tritonplan.cn/verify#token=');
  const v = await verifyWith(tokenFrom(0), 'hunter2hunter2');
  expect(v.status).toBe(200);
  expect(await v.json()).toEqual({ ok: true });
  const cookie = cookieOf(v)!;
  expect(cookie).toBeTruthy();
  expect(await (await me(cookie)).json()).toEqual({ email: 'a@ucsd.edu', hasPassword: true, hasGoogle: false });
});

test('login before verifying is 403 unverified', async () => {
  const { post } = setup();
  await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' });
  const res = await post('/api/auth/login', { email: 'a@ucsd.edu', password: 'hunter2hunter2' });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: 'unverified' });
});

test('invalid email and weak password are 400', async () => {
  const { post } = setup();
  const bad = await post('/api/auth/signup', { email: 'nope', password: 'hunter2hunter2' });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: 'invalid_email' });
  const w = await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'short' });
  expect(w.status).toBe(400);
  expect(await w.json()).toEqual({ error: 'weak_password' });
});

test('wrong password, unknown email and google-only account all answer 401 invalid_credentials', async () => {
  const { post, verified, googleOnly } = setup();
  await verified('a@ucsd.edu', 'hunter2hunter2');
  googleOnly('g@ucsd.edu');
  for (const body of [
    { email: 'a@ucsd.edu', password: 'wrongpassword' },
    { email: 'nobody@ucsd.edu', password: 'hunter2hunter2' },
    { email: 'g@ucsd.edu', password: 'hunter2hunter2' },
  ]) {
    const res = await post('/api/auth/login', body);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_credentials' });
  }
});

test('email case and whitespace do not matter', async () => {
  const { post, tokenFrom, deps, verifyWith } = setup();
  await post('/api/auth/signup', { email: 'Foo@UCSD.edu ', password: 'hunter2hunter2' });
  expect((await verifyWith(tokenFrom(0), 'hunter2hunter2')).status).toBe(200);
  const login = await post('/api/auth/login', { email: 'foo@ucsd.edu', password: 'hunter2hunter2' });
  expect(login.status).toBe(200);
  expect((await post('/api/auth/login', { email: ' FOO@ucsd.EDU ', password: 'hunter2hunter2' })).status).toBe(200);
  const f = await post('/api/auth/forgot', { email: 'foo@ucsd.edu' });
  expect(f.status).toBe(200);
  expect(deps.mailer.sent[1]!.to).toBe('foo@ucsd.edu');
  await post('/api/auth/forgot', { email: ' FOO@ucsd.EDU ' });
  expect(deps.mailer.sent[2]!.to).toBe('foo@ucsd.edu');
  expect(deps.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
});

test('signup on a verified password account is 409 email_taken', async () => {
  const { post, verified } = setup();
  await verified('a@ucsd.edu', 'hunter2hunter2');
  const res = await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'another-password' });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'email_taken' });
});

test('signup on an unverified account keeps the first password and link, and mails a choose-password link', async () => {
  const { post, tokenFrom, deps, verifyWith } = setup();
  await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'first-password' });
  const second = await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'second-password' });
  expect(second.status).toBe(200);
  expect(await second.json()).toEqual({ ok: true });
  expect(deps.mailer.sent[1]!.subject).toBe('Choose your TritonPlan password');
  expect(deps.mailer.sent[1]!.text).toContain('https://tritonplan.cn/reset#token=');
  // The first verify link still works, with the first password.
  expect((await verifyWith(tokenFrom(0), 'first-password')).status).toBe(200);
  expect((await post('/api/auth/login', { email: 'a@ucsd.edu', password: 'first-password' })).status).toBe(200);
  expect((await post('/api/auth/login', { email: 'a@ucsd.edu', password: 'second-password' })).status).toBe(401);
  const r = await post('/api/auth/reset', { token: tokenFrom(1), password: 'owners-new-password' });
  expect(r.status).toBe(200);
  expect((await post('/api/auth/login', { email: 'a@ucsd.edu', password: 'owners-new-password' })).status).toBe(200);
});

test('unsolicited signup cannot hand the attacker the victim account', async () => {
  const { post, tokenFrom, verifyWith, deps } = setup();
  await post('/api/auth/signup', { email: 'victim@ucsd.edu', password: 'attacker-password' });
  const verifyTok = tokenFrom(0);
  // The victim clicks the routine confirm mail and types their own password: not the attacker's, so it fails.
  expect((await verifyWith(verifyTok, 'victim-own-password')).status).toBe(401);
  const atk = await post('/api/auth/login', { email: 'victim@ucsd.edu', password: 'attacker-password' });
  expect(atk.status).toBe(403);
  expect(await atk.json()).toEqual({ error: 'unverified' });
  // The victim signs up again, gets a choose-password link and takes the account over.
  await post('/api/auth/signup', { email: 'victim@ucsd.edu', password: 'victim-own-password' });
  expect(deps.mailer.sent[1]!.subject).toBe('Choose your TritonPlan password');
  const r = await post('/api/auth/reset', { token: tokenFrom(1), password: 'victim-own-password' });
  expect(r.status).toBe(200);
  expect((await post('/api/auth/login', { email: 'victim@ucsd.edu', password: 'victim-own-password' })).status).toBe(200);
  expect((await post('/api/auth/login', { email: 'victim@ucsd.edu', password: 'attacker-password' })).status).toBe(401);
  expect((await verifyWith(verifyTok, 'attacker-password')).status).toBe(401);
});

test('wrong password at verify is 401 and leaves the token usable', async () => {
  const { post, tokenFrom, verifyWith } = setup();
  await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' });
  const t = tokenFrom(0);
  const bad = await verifyWith(t, 'wrong-password');
  expect(bad.status).toBe(401);
  expect(await bad.json()).toEqual({ error: 'invalid_credentials' });
  expect((await verifyWith(t, 'hunter2hunter2')).status).toBe(200);
});

test('verify rate limit answers 429 on the 31st attempt from one IP', async () => {
  const { post } = setup();
  for (let i = 0; i < 30; i++) expect((await post('/api/auth/verify', { token: 'nope', password: 'x' })).status).toBe(400);
  const res = await post('/api/auth/verify', { token: 'nope', password: 'x' });
  expect(res.status).toBe(429);
  expect(((await res.json()) as { error: string }).error).toBe('rate_limited');
});

test('wrong-kind tokens are rejected without burning the other kind', async () => {
  const { post, tokenFrom, deps, verifyWith } = setup();
  await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' });
  await post('/api/auth/forgot', { email: 'a@ucsd.edu' }); // verify mail 0, reset mail 1
  const verifyTok = tokenFrom(0);
  const resetTok = tokenFrom(1);
  const r = await post('/api/auth/reset', { token: verifyTok, password: 'brand-new-password' });
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: 'link_expired' });
  const v = await verifyWith(resetTok, 'hunter2hunter2');
  expect(v.status).toBe(400);
  expect(await v.json()).toEqual({ error: 'link_expired' });
  expect(deps.db.prepare('SELECT COUNT(*) AS n FROM email_tokens').get()).toEqual({ n: 2 });
  expect((await verifyWith(verifyTok, 'hunter2hunter2')).status).toBe(200);
  expect((await post('/api/auth/reset', { token: resetTok, password: 'brand-new-password' })).status).toBe(200);
});

test('signup on a google-only account never applies the submitted password and mails a set-password link', async () => {
  const { post, deps, tokenFrom, googleOnly } = setup();
  googleOnly('g@ucsd.edu');
  const res = await post('/api/auth/signup', { email: 'g@ucsd.edu', password: 'attacker-chosen' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect((await post('/api/auth/login', { email: 'g@ucsd.edu', password: 'attacker-chosen' })).status).toBe(401);
  expect(deps.mailer.sent[0]!.subject).toBe('Set a password for TritonPlan');
  expect(deps.mailer.sent[0]!.text).toContain('https://tritonplan.cn/reset#token=');
  const r = await post('/api/auth/reset', { token: tokenFrom(0), password: 'owners-new-password' });
  expect(r.status).toBe(200);
  expect((await post('/api/auth/login', { email: 'g@ucsd.edu', password: 'owners-new-password' })).status).toBe(200);
  expect((await post('/api/auth/login', { email: 'g@ucsd.edu', password: 'attacker-chosen' })).status).toBe(401);
});

test('expired, reused or missing verify token is 400 link_expired', async () => {
  const { post, tokenFrom, deps, verifyWith } = setup();
  await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' });
  const t = tokenFrom(0);
  expect((await verifyWith(t, 'hunter2hunter2')).status).toBe(200);
  const reused = await verifyWith(t, 'hunter2hunter2');
  expect(reused.status).toBe(400);
  expect(await reused.json()).toEqual({ error: 'link_expired' });
  expect((await post('/api/auth/verify', { password: 'hunter2hunter2' })).status).toBe(400);

  await post('/api/auth/signup', { email: 'b@ucsd.edu', password: 'hunter2hunter2' });
  deps.db.prepare("UPDATE email_tokens SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  const exp = await verifyWith(tokenFrom(deps.mailer.sent.length - 1), 'hunter2hunter2');
  expect(exp.status).toBe(400);
  expect(await exp.json()).toEqual({ error: 'link_expired' });
});

test('resend mails only existing unverified users but always answers 200', async () => {
  const { post, deps, verified } = setup();
  await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' });
  expect(deps.mailer.sent).toHaveLength(1);
  expect((await post('/api/auth/resend', { email: 'a@ucsd.edu' })).status).toBe(200);
  expect(deps.mailer.sent).toHaveLength(2);
  expect((await post('/api/auth/resend', { email: 'nobody@ucsd.edu' })).status).toBe(200);
  await verified('v@ucsd.edu', 'hunter2hunter2');
  const n = deps.mailer.sent.length;
  expect((await post('/api/auth/resend', { email: 'v@ucsd.edu' })).status).toBe(200);
  expect(deps.mailer.sent).toHaveLength(n);
});

test('forgot always answers 200 and only mails existing users', async () => {
  const { post, deps, verified } = setup();
  await verified('a@ucsd.edu', 'hunter2hunter2');
  const n = deps.mailer.sent.length;
  const known = await post('/api/auth/forgot', { email: 'a@ucsd.edu' });
  const unknown = await post('/api/auth/forgot', { email: 'nobody@ucsd.edu' });
  expect(known.status).toBe(200);
  expect(unknown.status).toBe(200);
  expect(await unknown.json()).toEqual(await known.json());
  expect(deps.mailer.sent).toHaveLength(n + 1);
  expect(deps.mailer.sent[n]!.text).toContain('https://tritonplan.cn/reset#token=');
});

test('reset sets the password, verifies the email and kills other sessions', async () => {
  const { post, deps, tokenFrom, cookieOf, me, verified } = setup();
  const old = await verified('a@ucsd.edu', 'old-password1');
  expect((await me(old)).status).toBe(200);
  await post('/api/auth/forgot', { email: 'a@ucsd.edu' });
  const t = tokenFrom(deps.mailer.sent.length - 1);
  // A second live reset row (e.g. a leftover) must die with the reset; without the DELETE it would survive.
  const uid = (deps.db.prepare('SELECT id FROM users').get() as { id: string }).id;
  deps.db
    .prepare("INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES ('leftover', ?, 'reset', '2999-01-01T00:00:00.000Z')")
    .run(uid);
  expect((await post('/api/auth/reset', { token: t, password: 'short' })).status).toBe(400);
  const res = await post('/api/auth/reset', { token: t, password: 'brand-new-password' });
  expect(res.status).toBe(200);
  const fresh = cookieOf(res)!;
  expect(deps.db.prepare("SELECT COUNT(*) AS n FROM email_tokens WHERE kind = 'reset'").get()).toEqual({ n: 0 });
  expect((await me(old)).status).toBe(401);
  expect((await me(fresh)).status).toBe(200);
  expect((await post('/api/auth/login', { email: 'a@ucsd.edu', password: 'brand-new-password' })).status).toBe(200);
  const again = await post('/api/auth/reset', { token: t, password: 'yet-another-pass' });
  expect(again.status).toBe(400);
  expect(await again.json()).toEqual({ error: 'link_expired' });
});

test('reset marks an unverified account verified', async () => {
  const { post, deps, tokenFrom } = setup();
  await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'old-password1' });
  await post('/api/auth/forgot', { email: 'a@ucsd.edu' });
  await post('/api/auth/reset', { token: tokenFrom(1), password: 'brand-new-password' });
  expect(deps.db.prepare('SELECT email_verified AS v FROM users').get()).toEqual({ v: 1 });
});

test('login rate limit answers 429 with retryAfter', async () => {
  const { post } = setup();
  for (let i = 0; i < 10; i++) {
    expect((await post('/api/auth/login', { email: 'a@ucsd.edu', password: 'wrongpassword' })).status).toBe(401);
  }
  const res = await post('/api/auth/login', { email: 'a@ucsd.edu', password: 'wrongpassword' });
  expect(res.status).toBe(429);
  const body = (await res.json()) as { error: string; retryAfter: number };
  expect(body.error).toBe('rate_limited');
  expect(body.retryAfter).toBeGreaterThan(0);
});

test('signup rate limit is 5 per email per hour', async () => {
  const { post } = setup();
  for (let i = 0; i < 5; i++) expect((await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' })).status).toBe(200);
  expect((await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' })).status).toBe(429);
});

test('logout clears the session', async () => {
  const { post, me, verified } = setup();
  const cookie = await verified('a@ucsd.edu', 'hunter2hunter2');
  const res = await post('/api/auth/logout', {}, { Cookie: `tp_session=${cookie}` });
  expect(res.status).toBe(200);
  expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  expect((await me(cookie)).status).toBe(401);
});

test('GET /api/me without a session is 401', async () => {
  const { app } = setup();
  expect((await app.request('/api/me')).status).toBe(401);
});

test('a signup whose confirmation mail fails answers 503 mail_failed, in both branches, without logging the address', async () => {
  const { post, deps } = setup();
  deps.mailer.send = () => Promise.reject(new Error('resend down'));
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const fresh = await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' });
    expect(fresh.status).toBe(503);
    expect(await fresh.json()).toEqual({ error: 'mail_failed' });
    // The row stays; a retry takes the existing-unverified branch, whose mail can fail the same way.
    const again = await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' });
    expect(again.status).toBe(503);
    expect(await again.json()).toEqual({ error: 'mail_failed' });
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain('a@ucsd.edu');
  } finally {
    spy.mockRestore();
  }
});

test('a password over 200 characters is 401 at login and verify without running argon2', async () => {
  const { post, tokenFrom, verifyWith } = setup();
  await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' });
  const spy = vi.mocked(verifyPassword);
  spy.mockClear();
  const long = 'x'.repeat(1000);
  const v = await verifyWith(tokenFrom(0), long);
  expect(v.status).toBe(401);
  expect(await v.json()).toEqual({ error: 'invalid_credentials' });
  const l = await post('/api/auth/login', { email: 'a@ucsd.edu', password: long });
  expect(l.status).toBe(401);
  expect(await l.json()).toEqual({ error: 'invalid_credentials' });
  expect(spy).not.toHaveBeenCalled();
  // The rejected verify did not burn the link.
  expect((await verifyWith(tokenFrom(0), 'hunter2hunter2')).status).toBe(200);
});

test('forgot and resend answer 200 even when the mail send rejects, and never log the address', async () => {
  const { post, deps } = setup();
  await post('/api/auth/signup', { email: 'a@ucsd.edu', password: 'hunter2hunter2' });
  deps.mailer.send = () => Promise.reject(new Error('resend down'));
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await post('/api/auth/forgot', { email: 'a@ucsd.edu' })).status).toBe(200);
    expect((await post('/api/auth/resend', { email: 'a@ucsd.edu' })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('a@ucsd.edu');
  } finally {
    spy.mockRestore();
  }
});

test('resend has a per-IP limit of 20 per hour', async () => {
  const { post } = setup();
  for (let i = 0; i < 20; i++) expect((await post('/api/auth/resend', { email: `u${i}@ucsd.edu` })).status).toBe(200);
  expect((await post('/api/auth/resend', { email: 'u99@ucsd.edu' })).status).toBe(429);
});
