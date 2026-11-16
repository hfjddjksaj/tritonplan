import { serve, type ServerType } from '@hono/node-server';
import { createApp, type Deps, type Mount } from './app';
import { assertArgon2Available } from './auth/passwords';
import { loadConfig } from './config';
import { openDb } from './db/db';
import { createConsoleMailer, createMemoryMailer, type Mailer } from './mail/mailer';
import { createResendMailer } from './mail/resend';
import { startRmpRefresh } from './rmp/refresh';
import { startSharedSweep } from './share/routes';

export interface Running {
  server: ServerType;
  /** Drains the listener, then closes the database; `done` is called once both are shut. */
  stop(done?: () => void): void;
}

/**
 * Starts the server from the environment: the database, the timers, the listener. `extra` is for an entry that
 * has routes of its own: what it returns is mounted ahead of the same-origin guard (see createApp).
 */
export function start(extra?: (deps: Deps) => Mount | undefined): Running {
  assertArgon2Available();
  const config = loadConfig(process.env);
  const db = openDb(config.dbPath);

  function buildMailer(): Mailer {
    switch (config.mail.transport) {
      case 'console':
        return createConsoleMailer();
      case 'memory':
        return createMemoryMailer();
      case 'resend':
        return createResendMailer(config.mail.resendApiKey!, config.mail.from, fetch); // loadConfig guarantees the key
    }
  }

  const deps: Deps = { db, config, mailer: buildMailer(), now: () => new Date(), fetch };
  const app = createApp(deps, extra?.(deps));
  const stopRmp = config.rmpRefresh ? startRmpRefresh(deps) : () => {};
  const stopSweep = startSharedSweep(deps);
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`TritonPlan API listening on ${info.address}:${info.port}`);
  });

  // systemd sends SIGTERM on stop/restart: drain the listener, then close SQLite so WAL checkpoints cleanly.
  // The handler stays on until that is done, so a second signal mid-drain joins the shutdown under way instead
  // of ending the process before the database is closed.
  const onTerm = () => stop(() => process.exit(0));
  let shutdown: Promise<void> | undefined;
  function stop(done?: () => void) {
    shutdown ??= new Promise<void>((finished) => {
      stopRmp();
      stopSweep();
      server.close(() => {
        db.close();
        process.off('SIGTERM', onTerm);
        finished();
      });
    });
    if (done) void shutdown.then(done);
  }
  process.on('SIGTERM', onTerm);

  return { server, stop };
}
