import { Hono } from 'hono';
import type { Config } from './config';
import type { Db } from './db/db';
import { sameOriginJson, type AppEnv } from './http/guard';
import type { Mailer } from './mail/mailer';

export interface Deps {
  db: Db;
  config: Config;
  mailer: Mailer;
  now: () => Date;
  fetch: typeof fetch;
}

export function createApp(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Registered before any route so it also covers writes to routes that don't exist.
  app.use('/api/*', sameOriginJson(deps.config));

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Never leak internals to the client; the log has the detail.
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'server' }, 500);
  });

  return app;
}
