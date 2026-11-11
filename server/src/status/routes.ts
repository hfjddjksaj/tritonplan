import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { StatusCommand } from './command';
import type { StatusRelay } from './relay';

/**
 * Mounted at /api/hooks, ahead of the same-origin guard: the callers are the UCSD status page and Discord, not
 * a browser on our origin. Neither route reads a cookie or touches an account.
 */
export function statusHookRoutes(parts: { relay: StatusRelay | null; command: StatusCommand | null }): Hono {
  const { relay, command } = parts;
  const r = new Hono();

  // Lets the operator see whether the two values in the env file were accepted, without reading the journal.
  r.get('/ucsd-status', (c) => c.json({ relay: relay ? 'on' : 'off' }));

  r.post(
    '/ucsd-status',
    bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) }),
    async (c) => {
      const payload: unknown = await c.req.json().catch(() => null);
      // Answered at once: the status page counts a slow or non-2xx reply as a failed delivery and drops the
      // subscription after about ten of them.
      if (relay && payload) void relay.handle(payload);
      return c.json({ ok: true });
    },
  );

  // Discord's interactions endpoint (the bot's /status command). The signature is over the exact bytes, so the
  // body is read as text and parsed only after it checks out.
  r.post(
    '/discord',
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) }),
    async (c) => {
      if (!command) return c.json({ error: 'not_found' }, 404);
      const out = await command.handle(c.req.header('x-signature-ed25519'), c.req.header('x-signature-timestamp'), await c.req.text());
      return c.json(out.body as object, out.status);
    },
  );

  return r;
}
