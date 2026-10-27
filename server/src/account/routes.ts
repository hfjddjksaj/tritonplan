import { Hono, type Context } from 'hono';
import type { Deps } from '../app';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/passwords';
import { clearSessionCookie, deleteUserSessions } from '../auth/sessions';
import { findUserById, issueEmailToken, normalizeEmail } from '../auth/users';
import { requireUser, type AppEnv } from '../http/guard';
import type { RateLimiter } from '../http/rate-limit';
import { addPasswordMail, resetPasswordMail } from '../mail/templates';

const QUARTER = 900_000;

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function accountRoutes(deps: Deps, limiter: RateLimiter): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db, config } = deps;
  r.use('*', requireUser(deps));

  r.post('/password', async (c) => {
    const userId = c.get('userId');
    // Per user, not per IP: a stolen session must not be able to grind guesses at `current`.
    const hit = limiter.hit(`pwchange:user:${userId}`, 10, QUARTER);
    if (!hit.ok) return c.json({ error: 'rate_limited', retryAfter: hit.retryAfterSec }, 429);
    const b = await body(c);
    const user = findUserById(db, userId);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    // A first password goes through the emailed link (/password-link), which proves the mailbox: a stolen
    // session alone must not be able to plant a lasting credential on a Google-only account.
    if (!user.password_hash) return c.json({ error: 'use_link' }, 400);
    const next = str(b.next);
    if (passwordProblem(next)) return c.json({ error: 'weak_password' }, 400);
    const current = str(b.current);
    // Longer than any stored password can be: refused without spending argon2 on it.
    if (passwordProblem(current) === 'too-long' || !(await verifyPassword(current, user.password_hash))) {
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), userId);
    deleteUserSessions(db, userId, c.get('sessionToken'));
    // A reset link mailed before the change must not be able to undo it.
    db.prepare('DELETE FROM email_tokens WHERE user_id = ?').run(userId);
    return c.json({ ok: true });
  });

  r.post('/password-link', async (c) => {
    const userId = c.get('userId');
    // Every call is a Resend mail out of a small daily quota; a signed-in loop must not be able to spend it.
    const hit = limiter.hit(`pwlink:user:${userId}`, 3, QUARTER);
    if (!hit.ok) return c.json({ error: 'rate_limited', retryAfter: hit.retryAfterSec }, 429);
    const user = findUserById(db, userId);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    const link = `${config.origin}/reset#token=${issueEmailToken(db, user.id, 'reset', deps.now())}`;
    const mail = user.google_sub && !user.password_hash ? addPasswordMail(link) : resetPasswordMail(link);
    // Awaited: the user is signed in and should learn if the mail could not be sent.
    await deps.mailer.send({ to: user.email, ...mail });
    return c.json({ ok: true });
  });

  r.post('/google/unlink', (c) => {
    const user = findUserById(db, c.get('userId'));
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    // Without a password, unlinking would leave no way to sign in.
    if (!user.password_hash) return c.json({ error: 'needs_password' }, 400);
    db.prepare('UPDATE users SET google_sub = NULL WHERE id = ?').run(user.id);
    return c.json({ ok: true });
  });

  r.delete('/', async (c) => {
    const user = findUserById(db, c.get('userId'));
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    const b = await body(c);
    if (normalizeEmail(str(b.confirmEmail)) !== user.email) return c.json({ error: 'confirm_mismatch' }, 400);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id); // FK cascades take sessions, tokens and all synced data
    c.header('Set-Cookie', clearSessionCookie(config), { append: true });
    return c.json({ ok: true });
  });

  return r;
}
