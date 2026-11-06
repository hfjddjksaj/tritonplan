import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { SYNC_LIMITS, termKey, type PlanState } from '@triton/shared';
import type { Deps } from '../app';
import { clientIp, requireUser, type AppEnv } from '../http/guard';
import type { RateLimiter } from '../http/rate-limit';
import { createShared, listShared, readShared, selectInShared, sharedVersion, sweepExpiredShared } from './store';

const HOUR = 3_600_000;
const QUARTER = 900_000;
// Room for a maxDocBytes plan plus the name and JSON escaping; the exact plan size is checked after parsing.
const BODY_LIMIT = 1_200_000;
const CODE_RE = /^[0-9A-Za-z]{10}$/;

// Entries need the fields applySelection reads, otherwise a malformed stored plan would make every select throw.
const planShape = z
  .object({
    version: z.literal(1),
    term: z.object({ year: z.string(), period: z.string(), label: z.string() }).passthrough(),
    entries: z.array(
      z
        .object({
          course: z.object({ id: z.string(), options: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough(),
          selectedOptionId: z.string().nullable().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const createBody = z.object({ name: z.string().min(1).max(100), plan: planShape });
const selectBody = z.object({ courseId: z.string().min(1).max(200), optionId: z.string().min(1).max(200) }).strict();

export function shareRoutes(deps: Deps, limiter: RateLimiter): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db, config } = deps;
  // Per route, not r.use('*'): this router mounts at /api and the /s/:code routes must stay public.
  const auth = requireUser(deps);
  const urlOf = (code: string) => `${config.origin}/s/${code}`;
  const notFound = (c: { json: (b: unknown, s: 404) => Response }) => c.json({ error: 'not_found' }, 404);
  const limited = (key: string, max: number) => {
    const hit = limiter.hit(key, max, QUARTER);
    return hit.ok ? null : { error: 'rate_limited', retryAfter: hit.retryAfterSec };
  };

  r.post(
    '/shared',
    auth,
    bodyLimit({ maxSize: BODY_LIMIT, onError: (c) => c.json({ error: 'too_large' }, 413) }),
    async (c) => {
      const userId = c.get('userId');
      const hit = limiter.hit(`share:user:${userId}`, 60, HOUR);
      if (!hit.ok) return c.json({ error: 'rate_limited', retryAfter: hit.retryAfterSec }, 429);
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: 'invalid_request' }, 400);
      }
      const parsed = createBody.safeParse(raw);
      if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
      const planJson = JSON.stringify(parsed.data.plan);
      if (Buffer.byteLength(planJson, 'utf8') > SYNC_LIMITS.maxDocBytes) return c.json({ error: 'doc_too_large' }, 413);
      const created = createShared(db, userId, parsed.data.name, termKey(parsed.data.plan.term), planJson, deps.now());
      if (!created) return c.json({ error: 'too_many_shares' }, 409);
      return c.json({ code: created.code, url: urlOf(created.code), expiresAt: created.expiresAt });
    },
  );

  r.get('/shared', auth, (c) =>
    c.json({ shared: listShared(db, c.get('userId'), deps.now()).map((s) => ({ ...s, url: urlOf(s.code) })) }));

  // Public: anyone holding the code may read the plan, and nothing else about its owner.
  r.get('/s/:code', (c) => {
    const over = limited(`share:ip:${clientIp(c)}`, 300);
    if (over) return c.json(over, 429);
    const code = c.req.param('code');
    const shared = CODE_RE.test(code) ? readShared(db, code, deps.now()) : null;
    if (!shared) return notFound(c);
    c.header('Cache-Control', 'no-store');
    return c.json(shared);
  });

  // Polled by open viewers, so it has its own, larger budget.
  r.get('/s/:code/version', (c) => {
    const over = limited(`share:poll:${clientIp(c)}`, 1200);
    if (over) return c.json(over, 429);
    const code = c.req.param('code');
    const version = CODE_RE.test(code) ? sharedVersion(db, code, deps.now()) : null;
    if (version === null) return notFound(c);
    c.header('Cache-Control', 'no-store');
    return c.json({ version });
  });

  r.post('/s/:code/select', async (c) => {
    const over = limited(`share:select:${clientIp(c)}`, 600);
    if (over) return c.json(over, 429);
    const code = c.req.param('code');
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const parsed = selectBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    if (!CODE_RE.test(code)) return notFound(c);
    const res = selectInShared(db, code, parsed.data.courseId, parsed.data.optionId, deps.now());
    if (res === 'not-found') return notFound(c);
    if (res === 'invalid') return c.json({ error: 'invalid_request' }, 400);
    c.header('Cache-Control', 'no-store');
    return c.json(res);
  });

  return r;
}

/** Hourly delete of expired rows; reads already ignore them, this only reclaims space. */
export function startSharedSweep(deps: Deps): () => void {
  const timer = setInterval(() => sweepExpiredShared(deps.db, deps.now()), HOUR);
  timer.unref();
  return () => clearInterval(timer);
}
