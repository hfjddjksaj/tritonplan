import { Hono } from 'hono';
import type { Config } from './config';
import type { Db } from './db/db';
import type { Mailer } from './mail/mailer';

export interface Deps {
  db: Db;
  config: Config;
  mailer: Mailer;
  now: () => Date;
  fetch: typeof fetch;
}

export function createApp(deps: Deps): Hono {
  void deps; // routes mounted by later tasks close over deps
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Never leak internals to the client; the log has the detail.
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'server' }, 500);
  });

  return app;
}
