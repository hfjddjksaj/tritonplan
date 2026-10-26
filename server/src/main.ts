import { serve } from '@hono/node-server';
import { createApp } from './app';
import { assertArgon2Available } from './auth/passwords';
import { loadConfig } from './config';
import { openDb } from './db/db';
import { createConsoleMailer, createMemoryMailer, type Mailer } from './mail/mailer';
import { createResendMailer } from './mail/resend';

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

const app = createApp({ db, config, mailer: buildMailer(), now: () => new Date(), fetch });
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`TritonPlan API listening on ${info.address}:${info.port}`);
});

// systemd sends SIGTERM on stop/restart: drain the listener, then close SQLite so WAL checkpoints cleanly.
process.on('SIGTERM', () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
