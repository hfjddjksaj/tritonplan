import { Hono } from 'hono';
import type { Config } from './config';
import type { Db } from './db/db';
import { authRoutes, meRoute } from './auth/routes';
import { createRateLimiter } from './http/rate-limit';
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

  // The limiter's sweep timer is unref'd, so it never holds the process or a test run open.
  const limiter = createRateLimiter(deps.now);
  app.route('/api/auth', authRoutes(deps, limiter));
  app.route('/api/me', meRoute(deps));

  // Never leak internals to the client; the log has the detail.
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'server' }, 500);
  });

  return app;
}
