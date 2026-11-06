import { Hono } from 'hono';
import type { Deps } from '../app';
import type { RateLimiter } from '../http/rate-limit';
import type { AppEnv } from '../http/guard';

// Placeholder until the shared-plan routes land; the old snapshot routes depended on the dropped table.
export function shareRoutes(_deps: Deps, _limiter: RateLimiter): Hono<AppEnv> {
  return new Hono<AppEnv>();
}
