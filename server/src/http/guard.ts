import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Deps } from '../app';
import { readSession, SESSION_COOKIE, sessionCookie } from '../auth/sessions';
import type { Config } from '../config';
import type { RateLimiter } from './rate-limit';

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

/**
 * On every answer under /api. They hold account data and plans, so no browser or proxy may keep one (a route that
 * sets its own Cache-Control, the calendar feed, keeps it); and none is a page, so if one is ever opened as a
 * page it may load and run nothing.
 */
export function apiHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  };
}

const QUARTER = 900_000;
// The planner saves at most about once a second and reads far less, so only a script gets near this.
const USER_REQUESTS_PER_QUARTER = 3000;

export function requireUser(deps: Deps, limiter: RateLimiter): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? readSession(deps.db, token, deps.now()) : null;
    if (!token || !session) return c.json({ error: 'unauthorized' }, 401);
    c.set('userId', session.userId);
    c.set('sessionToken', token);
    if (session.refreshed) c.header('Set-Cookie', sessionCookie(token, deps.config), { append: true });
    // Per account, not per IP: a signed-in route reads or writes that account's whole state, and one account
    // must not be able to keep the server busy with it from however many addresses.
    const hit = limiter.hit(`req:user:${session.userId}`, USER_REQUESTS_PER_QUARTER, QUARTER);
    if (!hit.ok) return c.json({ error: 'rate_limited', retryAfter: hit.retryAfterSec }, 429);
    return next();
  };
}

/** Caddy sets X-Real-IP; direct local hits have none. Used only as an in-memory rate-limit key. */
export function clientIp(c: Context): string {
  const raw = c.req.header('x-real-ip');
  return raw ? bucketIp(raw.trim()) : 'local';
}

/** IPv4 as-is; IPv4-mapped IPv6 unwrapped; other IPv6 reduced to its /64 so one subscriber can't dodge limits by rotating suffixes. */
function bucketIp(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const [head, tail = null] = ip.toLowerCase().split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const groups = tail === null ? front : [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return ip; // unparseable: keep whole string
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') + '::/64';
}
