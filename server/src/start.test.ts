import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { start } from './start';

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubEnv('TP_ORIGIN', 'http://localhost:5173');
  vi.stubEnv('TP_DB_PATH', ':memory:');
  vi.stubEnv('TP_MAIL_TRANSPORT', 'memory');
  vi.stubEnv('TP_RMP_REFRESH', 'off');
  vi.stubEnv('TP_PORT', '0'); // any free port
});
afterEach(() => {
  vi.unstubAllEnvs();
  log.mockRestore();
});

async function listening(running: ReturnType<typeof start>): Promise<string> {
  if (!running.server.listening) await once(running.server, 'listening');
  return `http://127.0.0.1:${(running.server.address() as AddressInfo).port}`;
}
const stopped = (running: ReturnType<typeof start>) => new Promise<void>((done) => running.stop(done));

test('start() listens with the configuration in the environment and serves the app', async () => {
  const running = start();
  try {
    const res = await fetch(`${await listening(running)}/api/health`);
    expect([res.status, await res.json()]).toEqual([200, { ok: true }]);
  } finally {
    await stopped(running);
  }
  expect(running.server.listening).toBe(false);
});

test('a second stop(), during the shutdown or after it, joins the same shutdown instead of closing twice', async () => {
  const running = start();
  await listening(running);
  await Promise.all([stopped(running), stopped(running)]);
  await stopped(running);
  expect(running.server.listening).toBe(false);
});

test('the SIGTERM handler stays on until the shutdown has finished, so a second signal mid-drain is absorbed', async () => {
  const before = process.listenerCount('SIGTERM');
  const running = start();
  await listening(running);
  expect(process.listenerCount('SIGTERM')).toBe(before + 1);

  const done = stopped(running);
  expect(process.listenerCount('SIGTERM')).toBe(before + 1); // still draining
  await done;
  expect(process.listenerCount('SIGTERM')).toBe(before);
});

test('start(extra) mounts the routes its extra returns, ahead of the guard', async () => {
  const seen: unknown[] = [];
  const running = start((deps) => {
    seen.push(deps.config.origin);
    return (app) => {
      app.post('/api/hooks/ping', (c) => c.json({ pong: true }));
    };
  });
  try {
    const base = await listening(running);
    // No Origin header: the guard would turn this away.
    const res = await fetch(`${base}/api/hooks/ping`, { method: 'POST' });
    expect([res.status, await res.json()]).toEqual([200, { pong: true }]);
    expect((await fetch(`${base}/api/hooks/other`, { method: 'POST' })).status).toBe(403);
  } finally {
    await stopped(running);
  }
  expect(seen).toEqual(['http://localhost:5173']);
});
