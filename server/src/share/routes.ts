import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { SYNC_LIMITS } from '@triton/shared';
import type { Deps } from '../app';
import { clientIp, requireUser, type AppEnv } from '../http/guard';
import type { RateLimiter } from '../http/rate-limit';
import { createShare, deleteShare, getShare, listShares } from './store';

const HOUR = 3_600_000;
const QUARTER = 900_000;
// Room for a maxDocBytes plan plus the name and JSON escaping; the exact plan size is checked after parsing.
const BODY_LIMIT = 1_200_000;

// Minimal shape only: the server stores the snapshot without interpreting it, the web app validates what it opens.
const planShape = z
  .object({
    version: z.literal(1),
    term: z.object({ year: z.string(), period: z.string(), label: z.string() }).passthrough(),
    entries: z.array(z.unknown()),
  })
  .passthrough();
const createBody = z.object({ name: z.string().min(1).max(100), plan: planShape });

export function shareRoutes(deps: Deps, limiter: RateLimiter): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db, config } = deps;
  // Per route, not r.use('*'): this router mounts at /api and GET /api/s/:code must stay public.
  const auth = requireUser(deps);
  const urlOf = (code: string) => `${config.origin}/s/${code}`;

  r.post(
    '/shares',
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
      const code = createShare(db, userId, parsed.data.name, planJson, deps.now().toISOString());
      if (!code) return c.json({ error: 'too_many_shares' }, 409);
      return c.json({ code, url: urlOf(code) });
    },
  );

  r.get('/shares', auth, (c) =>
    c.json({ shares: listShares(db, c.get('userId')).map((s) => ({ ...s, url: urlOf(s.code) })) }));

  r.delete('/shares/:code', auth, (c) =>
    deleteShare(db, c.get('userId'), c.req.param('code')) ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404));

  // Public: anyone holding the code may read the snapshot, and nothing else about its owner.
  r.get('/s/:code', (c) => {
    const hit = limiter.hit(`share:ip:${clientIp(c)}`, 300, QUARTER);
    if (!hit.ok) return c.json({ error: 'rate_limited', retryAfter: hit.retryAfterSec }, 429);
    const code = c.req.param('code');
    const share = /^[0-9A-Za-z]{10}$/.test(code) ? getShare(db, code) : null;
    if (!share) return c.json({ error: 'not_found' }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json(share);
  });

  return r;
}
