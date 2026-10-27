import { Hono } from 'hono';
import { z } from 'zod';
import type { PlanState } from '@triton/shared';
import type { Deps } from '../app';
import { randomToken } from '../auth/tokens';
import type { Db } from '../db/db';
import { clientIp, requireUser, type AppEnv } from '../http/guard';
import type { RateLimiter } from '../http/rate-limit';
import { buildCalendar } from './ics';
import { UCSD_HOLIDAYS } from './holidays';

const QUARTER = 900_000;
const MAX_TERMS = 40;
const FILE_RE = /^([A-Za-z0-9_-]{43})\.ics$/;

// Keys become object keys in responses; these names would poke at Object.prototype.
const key = z.string().min(1).max(100).refine((k) => !['__proto__', 'constructor', 'prototype'].includes(k));
const putBody = z.object({ terms: z.record(z.string(), key) });

/** Picked plan id per term key. Own-keys copy into a null-prototype object so nothing stored can reach Object.prototype. */
function readTerms(db: Db, userId: string): Record<string, string> {
  const row = db.prepare("SELECT data FROM user_docs WHERE user_id = ? AND kind = 'calendar'").get(userId) as { data: string } | undefined;
  const out: Record<string, string> = Object.create(null);
  if (!row) return out;
  try {
    const terms = (JSON.parse(row.data) as { terms?: unknown }).terms;
    if (terms && typeof terms === 'object') {
      for (const [k, v] of Object.entries(terms)) if (typeof v === 'string') out[k] = v;
    }
  } catch {
    // A damaged row reads as "no picks".
  }
  return out;
}

/** A pick counts only if the plan still exists for this user and still belongs to that term. */
function loadPick(db: Db, userId: string, termKey: string, planId: string): PlanState | null {
  const row = db.prepare('SELECT data FROM plan_docs WHERE user_id = ? AND plan_id = ? AND term_key = ?').get(userId, planId, termKey) as { data: string } | undefined;
  if (!row) return null;
  try {
    const plan = JSON.parse(row.data) as PlanState;
    return plan && Array.isArray(plan.entries) ? plan : null;
  } catch {
    return null;
  }
}

export function calendarRoutes(deps: Deps, limiter: RateLimiter): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db, config } = deps;
  // Per route, not r.use('*'): this router mounts at /api and GET /api/cal/:file must stay public.
  const auth = requireUser(deps);
  const links = (secret: string) => {
    const https = `${config.origin}/api/cal/${secret}.ics`;
    return { https, webcal: https.replace(/^https:\/\//, 'webcal://') };
  };
  const secretOf = (userId: string) =>
    (db.prepare('SELECT secret FROM calendar_feeds WHERE user_id = ?').get(userId) as { secret: string } | undefined)?.secret;

  r.get('/calendar', auth, (c) => {
    const userId = c.get('userId');
    const secret = secretOf(userId);
    const terms = readTerms(db, userId);
    const missing = Object.keys(terms).filter((k) => !loadPick(db, userId, k, terms[k]!));
    return c.json({ ...(secret ? links(secret) : { https: null, webcal: null }), terms, missing });
  });

  r.put('/calendar', auth, async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const parsed = putBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    // Checked on the raw keys: zod's record does not run a refine on names like __proto__.
    const keys = Object.keys((raw as { terms: object }).terms);
    if (keys.length > MAX_TERMS || keys.some((k) => !key.safeParse(k).success)) return c.json({ error: 'invalid_request' }, 400);
    db.prepare(
      "INSERT INTO user_docs (user_id, kind, data, updated_at) VALUES (?, 'calendar', ?, ?) ON CONFLICT (user_id, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
    ).run(c.get('userId'), JSON.stringify({ terms: parsed.data.terms }), deps.now().toISOString());
    return c.json({ ok: true });
  });

  // Idempotent: the same link comes back until it is reset.
  r.post('/calendar/link', auth, (c) => {
    const userId = c.get('userId');
    db.prepare('INSERT OR IGNORE INTO calendar_feeds (user_id, secret, created_at) VALUES (?, ?, ?)').run(userId, randomToken(), deps.now().toISOString());
    return c.json(links(secretOf(userId)!));
  });

  r.post('/calendar/reset', auth, (c) => {
    const userId = c.get('userId');
    const secret = randomToken();
    db.prepare(
      'INSERT INTO calendar_feeds (user_id, secret, created_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET secret = excluded.secret, created_at = excluded.created_at',
    ).run(userId, secret, deps.now().toISOString());
    return c.json(links(secret));
  });

  // Public: the secret in the path is the credential. The body is calendar text only, with nothing about the owner.
  r.get('/cal/:file', (c) => {
    const hit = limiter.hit(`cal:ip:${clientIp(c)}`, 600, QUARTER);
    if (!hit.ok) return c.json({ error: 'rate_limited', retryAfter: hit.retryAfterSec }, 429);
    const secret = FILE_RE.exec(c.req.param('file'))?.[1];
    const owner = secret
      ? (db.prepare('SELECT user_id FROM calendar_feeds WHERE secret = ?').get(secret) as { user_id: string } | undefined)
      : undefined;
    if (!owner) return c.text('Not found', 404);
    const terms = readTerms(db, owner.user_id);
    const plans: { plan: PlanState }[] = [];
    for (const k of Object.keys(terms).sort()) {
      const plan = loadPick(db, owner.user_id, k, terms[k]!);
      if (plan) plans.push({ plan });
    }
    c.header('Content-Type', 'text/calendar; charset=utf-8');
    c.header('Cache-Control', 'no-cache');
    return c.body(buildCalendar({ plans, now: deps.now(), holidays: UCSD_HOLIDAYS }));
  });

  return r;
}
