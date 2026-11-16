import { Hono } from 'hono';
import type { Deps } from '../app';
import { requireUser, type AppEnv } from '../http/guard';
import type { RateLimiter } from '../http/rate-limit';
import { lookupTeachers } from './store';

export function rmpRoutes(deps: Deps, limiter: RateLimiter): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/rmp', requireUser(deps, limiter), (c) => {
    const names = (c.req.queries('name') ?? []).map((n) => n.trim());
    if (names.length < 1 || names.length > 20 || names.some((n) => n.length < 1 || n.length > 100)) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    return c.json({ results: lookupTeachers(deps.db, names) });
  });
  return r;
}
