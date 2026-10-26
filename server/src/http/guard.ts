import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Deps } from '../app';
import { readSession, SESSION_COOKIE, sessionCookie } from '../auth/sessions';
import type { Config } from '../config';

export type AppEnv = { Variables: { userId: string; sessionToken: string } };

/**
 * CSRF defence without tokens: SameSite=Lax cookies plus an exact Origin match and a JSON content type
 * (a cross-site form cannot send application/json without a CORS preflight, and we serve no CORS).
 */
export function sameOriginJson(cfg: Config): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD') return next();
    const type = (c.req.header('content-type') ?? '').toLowerCase();
    if (c.req.header('origin') !== cfg.origin || !type.startsWith('application/json')) {
      return c.json({ error: 'forbidden' }, 403);
    }
    return next();
  };
}

export function requireUser(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? readSession(deps.db, token, deps.now()) : null;
    if (!token || !session) return c.json({ error: 'unauthorized' }, 401);
    c.set('userId', session.userId);
    c.set('sessionToken', token);
    if (session.refreshed) c.header('Set-Cookie', sessionCookie(token, deps.config), { append: true });
    return next();
  };
}

/** Caddy sets X-Real-IP; direct local hits have none. Used only as an in-memory rate-limit key. */
export function clientIp(c: Context): string {
  return c.req.header('x-real-ip') || 'local';
}
