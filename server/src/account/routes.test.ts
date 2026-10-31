import { expect, test } from 'vitest';
import { createApp } from '../app';
import { hashPassword, verifyPassword } from '../auth/passwords';
import { createSession } from '../auth/sessions';
import { sha256Hex } from '../auth/tokens';
import { createUser, findUserById, issueEmailToken } from '../auth/users';
import { testDeps } from '../test-helpers';

const now = new Date('2026-01-15T12:00:00.000Z');
const T = now.toISOString();

async function setup() {
  const deps = testDeps();
  const app = createApp(deps);
  const mk = async (email: string, o: { password?: string; google?: string } = {}) =>
    createUser(deps.db, { email, verified: true, passwordHash: o.password ? await hashPassword(o.password) : null, googleSub: o.google ?? null }, now);
  const send = (method: string, path: string, body: unknown, token?: string) =>
    app.request(path, {
      method,
      headers: { Origin: 'https://tritonplan.cn', 'Content-Type': 'application/json', ...(token ? { Cookie: `tp_session=${token}` } : {}) },
      body: JSON.stringify(body),
    });
  const count = (table: string, userId: string) =>
    (deps.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number }).n;
  return { deps, app, mk, send, count };
}

test('every route answers 401 without a session', async () => {
  const { send } = await setup();
  for (const [m, p, b] of [
    ['POST', '/api/account/password', { next: 'newpassword1' }],
    ['POST', '/api/account/password-link', {}],
    ['POST', '/api/account/google/unlink', {}],
    ['DELETE', '/api/account', { confirmEmail: 'a@b.co' }],
  ] as const) {
    const res = await send(m, p, b);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  }
});

test('change password needs the current one, keeps only this session and kills pending reset links', async () => {
  const { deps, mk, send } = await setup();
  const u = await mk('a@ucsd.edu', { password: 'oldpassword1' });
  const mine = createSession(deps.db, u.id, now);
  createSession(deps.db, u.id, now);
  issueEmailToken(deps.db, u.id, 'reset', now);

  const bad = await send('POST', '/api/account/password', { current: 'wrong-one-123', next: 'newpassword1' }, mine);
  expect(bad.status).toBe(401);
  expect(await bad.json()).toEqual({ error: 'invalid_credentials' });
  const missing = await send('POST', '/api/account/password', { next: 'newpassword1' }, mine);
  expect(missing.status).toBe(401);
  const weak = await send('POST', '/api/account/password', { current: 'oldpassword1', next: 'short' }, mine);
  expect(weak.status).toBe(400);
  expect(await weak.json()).toEqual({ error: 'weak_password' });

  const ok = await send('POST', '/api/account/password', { current: 'oldpassword1', next: 'newpassword1' }, mine);
  expect(ok.status).toBe(200);
  expect(await verifyPassword('newpassword1', findUserById(deps.db, u.id)!.password_hash!)).toBe(true);
  const hashes = (deps.db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').all(u.id) as { token_hash: string }[]).map((r) => r.token_hash);
  expect(hashes).toEqual([sha256Hex(mine)]);
  expect((deps.db.prepare('SELECT COUNT(*) AS n FROM email_tokens WHERE user_id = ?').get(u.id) as { n: number }).n).toBe(0);
});

test('a Google-only account cannot set its first password here: 400 use_link, nothing stored', async () => {
  const { deps, mk, send } = await setup();
  const u = await mk('g@ucsd.edu', { google: 'sub-1' });
  const s = createSession(deps.db, u.id, now);
  for (const body of [{ next: 'newpassword1' }, { current: 'anything-123', next: 'newpassword1' }, { next: 'short' }]) {
    const res = await send('POST', '/api/account/password', body, s);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'use_link' });
  }
  expect(findUserById(deps.db, u.id)!.password_hash).toBeNull();
});

test('a current password over 200 characters is 401 and changes nothing', async () => {
  const { deps, mk, send } = await setup();
  const u = await mk('a@ucsd.edu', { password: 'oldpassword1' });
  const s = createSession(deps.db, u.id, now);
  const res = await send('POST', '/api/account/password', { current: 'x'.repeat(1000), next: 'newpassword1' }, s);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'invalid_credentials' });
  expect(await verifyPassword('oldpassword1', findUserById(deps.db, u.id)!.password_hash!)).toBe(true);
});

test('password-link is limited to 3 mails per user per 15 minutes', async () => {
  const { deps, mk, send } = await setup();
  const a = await mk('a@ucsd.edu', { password: 'oldpassword1' });
  const b = await mk('b@ucsd.edu', { google: 'sub-1' });
  const as = createSession(deps.db, a.id, now);
  const bs = createSession(deps.db, b.id, now);
  for (let i = 0; i < 3; i++) expect((await send('POST', '/api/account/password-link', {}, as)).status).toBe(200);
  const res = await send('POST', '/api/account/password-link', {}, as);
  expect(res.status).toBe(429);
  const body = (await res.json()) as { error: string; retryAfter: number };
  expect(body.error).toBe('rate_limited');
  expect(body.retryAfter).toBeGreaterThan(0);
  expect(deps.mailer.sent).toHaveLength(3);
  expect((await send('POST', '/api/account/password-link', {}, bs)).status).toBe(200); // per user, not global
});

test('password changes are rate limited per user', async () => {
  const { deps, mk, send } = await setup();
  const u = await mk('a@ucsd.edu', { password: 'oldpassword1' });
  const s = createSession(deps.db, u.id, now);
  for (let i = 0; i < 10; i++) {
    expect((await send('POST', '/api/account/password', { current: 'nope-nope-1', next: 'newpassword1' }, s)).status).toBe(401);
  }
  const res = await send('POST', '/api/account/password', { current: 'oldpassword1', next: 'newpassword1' }, s);
  expect(res.status).toBe(429);
  const b = (await res.json()) as { error: string; retryAfter: number };
  expect(b.error).toBe('rate_limited');
  expect(b.retryAfter).toBeGreaterThan(0);
});

test('password-link mails a set-password link to Google-only accounts and a reset link otherwise', async () => {
  const { deps, mk, send } = await setup();
  const g = await mk('g@ucsd.edu', { google: 'sub-1' });
  const p = await mk('p@ucsd.edu', { password: 'oldpassword1' });
  const gs = createSession(deps.db, g.id, now);
  const ps = createSession(deps.db, p.id, now);
  const r1 = await send('POST', '/api/account/password-link', {}, gs);
  expect(r1.status).toBe(200);
  expect(await r1.json()).toEqual({ ok: true });
  expect(deps.mailer.sent[0]!.to).toBe('g@ucsd.edu');
  expect(deps.mailer.sent[0]!.subject).toBe('Set a password for TritonPlan');
  expect(deps.mailer.sent[0]!.text).toContain('https://tritonplan.cn/reset#token=');
  await send('POST', '/api/account/password-link', {}, ps);
  expect(deps.mailer.sent[1]!.to).toBe('p@ucsd.edu');
  expect(deps.mailer.sent[1]!.subject).toBe('Reset your TritonPlan password');
  const token = /token=([\w-]+)/.exec(deps.mailer.sent[1]!.text)![1]!;
  const row = deps.db.prepare('SELECT kind FROM email_tokens WHERE token_hash = ?').get(sha256Hex(token)) as { kind: string };
  expect(row.kind).toBe('reset');
});

test('unlink Google needs a password first', async () => {
  const { deps, mk, send } = await setup();
  const g = await mk('g@ucsd.edu', { google: 'sub-1' });
  const gs = createSession(deps.db, g.id, now);
  const no = await send('POST', '/api/account/google/unlink', {}, gs);
  expect(no.status).toBe(400);
  expect(await no.json()).toEqual({ error: 'needs_password' });
  expect(findUserById(deps.db, g.id)!.google_sub).toBe('sub-1');

  const b = await mk('b@ucsd.edu', { password: 'oldpassword1', google: 'sub-2' });
  const bs = createSession(deps.db, b.id, now);
  const ok = await send('POST', '/api/account/google/unlink', {}, bs);
  expect(ok.status).toBe(200);
  expect(findUserById(deps.db, b.id)!.google_sub).toBeNull();
});

test('delete account requires the email, then removes everything of that user and nothing of others', async () => {
  const { deps, mk, send, count } = await setup();
  const u = await mk('a@ucsd.edu', { password: 'oldpassword1' });
  const o = await mk('o@ucsd.edu', { password: 'oldpassword1' });
  const seed = (id: string) => {
    deps.db.prepare('INSERT INTO term_docs VALUES (?, ?, 1, ?, ?)').run(id, 'FA26', '{}', T);
    deps.db.prepare('INSERT INTO plan_docs VALUES (?, ?, ?, 1, ?, ?)').run(id, 'p1', 'FA26', '{}', T);
    deps.db.prepare('INSERT INTO pool_courses VALUES (?, ?, ?, ?)').run(id, 'c1', '{}', T);
    deps.db.prepare('INSERT INTO user_docs VALUES (?, ?, ?, ?)').run(id, 'prefs', '{}', T);
    issueEmailToken(deps.db, id, 'reset', now);
  };
  seed(u.id);
  seed(o.id);
  const s = createSession(deps.db, u.id, now);
  createSession(deps.db, o.id, now);

  for (const confirmEmail of ['wrong@ucsd.edu', '', 'not an email']) {
    const res = await send('DELETE', '/api/account', { confirmEmail }, s);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'confirm_mismatch' });
  }
  expect(findUserById(deps.db, u.id)).toBeDefined();

  const res = await send('DELETE', '/api/account', { confirmEmail: '  A@UCSD.edu ' }, s);
  expect(res.status).toBe(200);
  expect(res.headers.getSetCookie().join(';')).toMatch(/tp_session=;.*Max-Age=0/);
  expect(findUserById(deps.db, u.id)).toBeUndefined();
  for (const t of ['sessions', 'email_tokens', 'term_docs', 'plan_docs', 'pool_courses', 'user_docs']) {
    expect(count(t, u.id)).toBe(0);
    expect(count(t, o.id)).toBe(1);
  }
  expect(findUserById(deps.db, o.id)).toBeDefined();
});
