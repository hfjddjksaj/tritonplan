import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Deps } from '../app';
import { tx } from '../db/db';
import { clientIp, requireUser, type AppEnv } from '../http/guard';
import type { RateLimiter } from '../http/rate-limit';
import { addPasswordMail, finishSignupMail, resetPasswordMail, verifyEmailMail } from '../mail/templates';
import { hashPassword, passwordProblem, verifyPassword } from './passwords';
import { clearSessionCookie, createSession, deleteSession, deleteUserSessions, SESSION_COOKIE, sessionCookie } from './sessions';
import { consumeEmailToken, createUser, findUserByEmail, findUserById, issueEmailToken, normalizeEmail } from './users';

const HOUR = 3_600_000;
const QUARTER = 900_000;

type Bucket = [key: string, limit: number, windowMs: number];

// Verified against when the account does not exist or has no password, so "no such user" costs the same argon2 run
// as "wrong password". Created at load; the promise is awaited at use so startup never blocks on it.
// An import-time rejection (no argon2 on this Node) is intentional fail-fast.
const DUMMY_HASH = hashPassword('tritonplan-dummy-password');

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function authRoutes(deps: Deps, limiter: RateLimiter): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db, config } = deps;

  /** Buckets are checked in order; the first exhausted one answers 429. */
  const limited = (c: Context, buckets: Bucket[]): Response | null => {
    for (const [key, limit, windowMs] of buckets) {
      const res = limiter.hit(key, limit, windowMs);
      if (!res.ok) return c.json({ error: 'rate_limited', retryAfter: res.retryAfterSec }, 429);
    }
    return null;
  };

  const startSession = (c: Context, userId: string): void => {
    c.header('Set-Cookie', sessionCookie(createSession(db, userId, deps.now()), config), { append: true });
  };

  // The token is issued synchronously; the caller decides whether to await the send.
  const sendVerify = (email: string, userId: string): Promise<void> => {
    const t = issueEmailToken(db, userId, 'verify', deps.now());
    return deps.mailer.send({ to: email, ...verifyEmailMail(`${config.origin}/api/auth/verify?token=${t}`) });
  };

  /** Fire-and-forget: response time and status must not reveal whether a mail was sent. Never log the address. */
  const sendDetached = (what: string, send: () => Promise<void>): void => {
    const fail = (err: unknown): void => console.error(`[mail] ${what} send failed:`, err instanceof Error ? err.message : 'unknown');
    try {
      void send().catch(fail);
    } catch (err) {
      fail(err);
    }
  };

  r.post('/signup', async (c) => {
    const b = await body(c);
    const email = normalizeEmail(str(b.email));
    const password = str(b.password);
    const buckets: Bucket[] = [[`signup:ip:${clientIp(c)}`, 20, HOUR]];
    if (email) buckets.push([`signup:email:${email}`, 5, HOUR]);
    const blocked = limited(c, buckets);
    if (blocked) return blocked;
    if (!email) return c.json({ error: 'invalid_email' }, 400);
    if (passwordProblem(password)) return c.json({ error: 'weak_password' }, 400);

    // Hashed in every branch so response time does not tell the caller which kind of account exists.
    const hash = await hashPassword(password);
    const existing = findUserByEmail(db, email);
    if (existing?.email_verified && existing.password_hash) return c.json({ error: 'email_taken' }, 409);

    if (existing) {
      // Google-only or still unverified: the submitted password is discarded. Whoever fills this form does not
      // necessarily own the mailbox, so the owner picks the password through a reset-style link instead. The
      // outstanding verify link is left alone so a repeat signup cannot invalidate the owner's first mail.
      const t = issueEmailToken(db, existing.id, 'reset', deps.now());
      const link = `${config.origin}/reset#token=${t}`;
      await deps.mailer.send({ to: email, ...(existing.email_verified ? addPasswordMail(link) : finishSignupMail(link)) });
      return c.json({ ok: true });
    }
    const user = createUser(db, { email, verified: false, passwordHash: hash }, deps.now());
    await sendVerify(email, user.id);
    return c.json({ ok: true });
  });

  r.get('/verify', (c) => {
    const token = c.req.query('token') ?? '';
    const t = token ? consumeEmailToken(db, token, 'verify', deps.now()) : null;
    if (!t) return c.redirect('/?auth=link-expired', 302);
    tx(db, () => {
      db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(t.userId);
      db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND kind = 'verify'").run(t.userId);
    });
    // No session: a GET link anyone can be lured into clicking must not sign a browser in (login CSRF), and the
    // password on a self-signup may have been chosen by someone other than the mailbox owner.
    return c.redirect('/?auth=verified', 302);
  });

  r.post('/login', async (c) => {
    const b = await body(c);
    const email = normalizeEmail(str(b.email));
    const buckets: Bucket[] = [[`login:ip:${clientIp(c)}`, 30, QUARTER]];
    if (email) buckets.push([`login:email:${email}`, 10, QUARTER]);
    const blocked = limited(c, buckets);
    if (blocked) return blocked;
    const user = email ? findUserByEmail(db, email) : undefined;
    const ok = await verifyPassword(str(b.password), user?.password_hash ?? (await DUMMY_HASH));
    if (!user || !user.password_hash || !ok) return c.json({ error: 'invalid_credentials' }, 401);
    if (!user.email_verified) return c.json({ error: 'unverified' }, 403);
    startSession(c, user.id);
    return c.json({ ok: true });
  });

  r.post('/resend', async (c) => {
    const email = normalizeEmail(str((await body(c)).email));
    if (!email) return c.json({ ok: true });
    const blocked = limited(c, [
      [`resend:ip:${clientIp(c)}`, 20, HOUR],
      [`resend:email:${email}`, 3, HOUR],
    ]);
    if (blocked) return blocked;
    const user = findUserByEmail(db, email);
    if (user && !user.email_verified) sendDetached('resend', () => sendVerify(email, user.id));
    return c.json({ ok: true });
  });

  r.post('/forgot', async (c) => {
    const email = normalizeEmail(str((await body(c)).email));
    if (!email) return c.json({ ok: true });
    const blocked = limited(c, [
      [`forgot:ip:${clientIp(c)}`, 20, HOUR],
      [`forgot:email:${email}`, 3, HOUR],
    ]);
    if (blocked) return blocked;
    const user = findUserByEmail(db, email);
    if (user) {
      // Token in the URL fragment: browsers never send it to the server, so it stays out of access logs and Referer.
      const t = issueEmailToken(db, user.id, 'reset', deps.now());
      sendDetached('forgot', () => deps.mailer.send({ to: email, ...resetPasswordMail(`${config.origin}/reset#token=${t}`) }));
    }
    return c.json({ ok: true });
  });

  r.post('/reset', async (c) => {
    const b = await body(c);
    // Checked before consuming the token, so a too-short password does not burn the link.
    if (passwordProblem(str(b.password))) return c.json({ error: 'weak_password' }, 400);
    const token = str(b.token);
    const t = token ? consumeEmailToken(db, token, 'reset', deps.now()) : null;
    if (!t) return c.json({ error: 'link_expired' }, 400);
    const hash = await hashPassword(str(b.password));
    tx(db, () => {
      db.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?').run(hash, t.userId);
      db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND kind = 'reset'").run(t.userId);
      deleteUserSessions(db, t.userId);
    });
    startSession(c, t.userId);
    return c.json({ ok: true });
  });

  r.post('/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deleteSession(db, token);
    c.header('Set-Cookie', clearSessionCookie(config), { append: true });
    return c.json({ ok: true });
  });

  return r;
}

export function meRoute(deps: Deps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/', requireUser(deps), (c) => {
    const user = findUserById(deps.db, c.get('userId'));
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return c.json({ email: user.email, hasPassword: user.password_hash !== null, hasGoogle: user.google_sub !== null });
  });
  return r;
}
