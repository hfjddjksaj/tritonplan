import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { SYNC_LIMITS, type SyncOp } from '@triton/shared';
import type { Deps } from '../app';
import { requireUser, type AppEnv } from '../http/guard';
import { applyOps, getSnapshot } from './store';

const key = z.string().min(1).max(100);
const version = z.number().int().min(0);
// The server stores plan contents without interpreting them, but a missing `data` would store the string "undefined".
const data = z.any().refine((v) => v !== undefined);

const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('putTerm'), termKey: key, baseVersion: version, data }),
  z.object({ op: z.literal('deleteTerm'), termKey: key, baseVersion: version }),
  z.object({ op: z.literal('putPlan'), planId: key, termKey: key, baseVersion: version, data }),
  z.object({ op: z.literal('deletePlan'), planId: key, baseVersion: version }),
  z.object({ op: z.literal('putCourses'), courses: z.array(z.object({ id: z.string().min(1).max(200) }).passthrough()) }),
  z.object({ op: z.literal('deleteCourses'), ids: z.array(z.string()) }),
  z.object({ op: z.literal('putAppt'), data: z.array(z.unknown()) }),
]);
const envelope = z.object({ ops: z.array(opSchema).min(1).max(SYNC_LIMITS.maxOps) });

const tooBig = (v: unknown): boolean => JSON.stringify(v).length > SYNC_LIMITS.maxDocBytes;

export function dataRoutes(deps: Deps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  // Per route, not r.use('*'): this router mounts at /api and a wildcard would put a login wall on every other /api path.
  const auth = requireUser(deps);

  r.get('/state', auth, (c) => c.json(getSnapshot(deps.db, c.get('userId'))));

  r.post(
    '/sync',
    auth,
    bodyLimit({ maxSize: SYNC_LIMITS.maxBodyBytes, onError: (c) => c.json({ error: 'too_large' }, 413) }),
    async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: 'invalid_request' }, 400);
      }
      const parsed = envelope.safeParse(raw);
      if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
      const ops = parsed.data.ops as SyncOp[];
      // Before the transaction, so an oversized doc never holds the write lock.
      for (const op of ops) {
        const oversize =
          op.op === 'putTerm' || op.op === 'putPlan' || op.op === 'putAppt' ? tooBig(op.data)
          : op.op === 'putCourses' ? op.courses.some(tooBig)
          : false;
        if (oversize) return c.json({ error: 'doc_too_large' }, 413);
      }
      const res = applyOps(deps.db, c.get('userId'), ops, deps.now().toISOString());
      return c.json(res, res.ok ? 200 : 409);
    },
  );

  return r;
}
