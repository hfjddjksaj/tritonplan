import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Deps } from '../app';
import { tx } from '../db/db';
import type { AppEnv } from '../http/guard';
import { exchangeGoogleCode, googleAuthUrl, safeReturnTo } from './google';
import { createSession, deleteUserSessions, sessionCookie } from './sessions';
import { createUser, findUserByEmail, normalizeEmail, type UserRow } from './users';
import { randomToken } from './tokens';

const STATE = 'tp_g_state';
const VERIFIER = 'tp_g_verifier';
const RETURN = 'tp_g_return';

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function googleRoutes(deps: Deps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db, config } = deps;
  const redirectUri = `${config.origin}/api/auth/google/callback`;

  const flowCookie = (name: string, value: string, maxAge: number): string =>
    `${name}=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=${maxAge}${config.cookieSecure ? '; Secure' : ''}`;

  // Both routes are GETs reached by top-level navigation, so the same-origin JSON guard does not apply;
  // state + PKCE bind the callback to the browser that started it.
  r.get('/', (c) => {
    const state = randomToken();
    const verifier = randomToken();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const returnTo = safeReturnTo(c.req.query('returnTo'));
    c.header('Set-Cookie', flowCookie(STATE, state, 600), { append: true });
    c.header('Set-Cookie', flowCookie(VERIFIER, verifier, 600), { append: true });
    c.header('Set-Cookie', flowCookie(RETURN, encodeURIComponent(returnTo), 600), { append: true });
    return c.redirect(googleAuthUrl({ clientId: config.googleClientId, redirectUri, state, codeChallenge: challenge }), 302);
  });

  const done = (c: Context, to: string, session?: string): Response => {
    // Every outcome burns the flow cookies, so a state can't be replayed.
    for (const n of [STATE, VERIFIER, RETURN]) c.header('Set-Cookie', flowCookie(n, '', 0), { append: true });
    if (session) c.header('Set-Cookie', sessionCookie(session, config), { append: true });
    return c.redirect(to, 302);
  };

  r.get('/callback', async (c) => {
    const state = getCookie(c, STATE);
    const verifier = getCookie(c, VERIFIER);
    const given = c.req.query('state');
    const code = c.req.query('code');
    let returnTo = '/';
    try {
      returnTo = safeReturnTo(decodeURIComponent(getCookie(c, RETURN) ?? ''));
    } catch {
      /* malformed cookie: stay on '/' */
    }
    if (!state || !verifier || !given || !code || !same(state, given)) return done(c, '/?auth=google-failed');

    let g: { sub: string; email: string; emailVerified: boolean };
    try {
      g = await exchangeGoogleCode({
        code,
        codeVerifier: verifier,
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        redirectUri,
        fetchFn: deps.fetch,
        now: deps.now(),
      });
    } catch (err) {
      // Message only: it is built without the code, tokens or secret.
      console.error('[google] sign-in failed:', err instanceof Error ? err.message : 'unknown');
      return done(c, '/?auth=google-failed');
    }
    if (!g.emailVerified) return done(c, '/?auth=google-unverified');
    const email = normalizeEmail(g.email);
    if (!email) return done(c, '/?auth=google-failed');

    const userId = tx(db, () => {
      // 1. Known Google account.
      const bySub = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(g.sub) as { id: string } | undefined;
      if (bySub) return bySub.id;
      // 2. Same verified email: link.
      const byEmail: UserRow | undefined = findUserByEmail(db, email);
      if (byEmail) {
        if (!byEmail.email_verified) {
          // Someone typed this address into the signup form without proving they own it, so any password, token or
          // session on the row may belong to them. Google has just proven the mailbox: wipe all of it.
          db.prepare('UPDATE users SET google_sub = ?, email_verified = 1, password_hash = NULL WHERE id = ?').run(g.sub, byEmail.id);
          db.prepare('DELETE FROM email_tokens WHERE user_id = ?').run(byEmail.id);
          deleteUserSessions(db, byEmail.id);
        } else {
          db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(g.sub, byEmail.id);
          // Re-binding from a different Google account (the address changed hands): end whatever the old one had open.
          if (byEmail.google_sub !== null && byEmail.google_sub !== g.sub) deleteUserSessions(db, byEmail.id);
        }
        return byEmail.id;
      }
      // 3. First visit.
      return createUser(db, { email, verified: true, googleSub: g.sub }, deps.now()).id;
    });
    return done(c, returnTo, createSession(db, userId, deps.now()));
  });

  return r;
}
