import { expect, test, vi } from 'vitest';
import { createApp } from './app';
import { testDeps } from './test-helpers';

test('GET /api/health', async () => {
  const res = await createApp(testDeps()).request('/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test('unhandled errors become 500 {error:"server"} without leaking detail', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = createApp(testDeps());
  app.get('/boom', () => { throw new Error('secret detail'); });
  const res = await app.request('/boom');
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'server' });
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});

function send(app: ReturnType<typeof createApp>, path: string, body: string, method = 'POST') {
  return app.request(path, {
    method,
    headers: { Origin: 'https://tritonplan.cn', 'Content-Type': 'application/json' },
    body,
  });
}

test('auth and account bodies over 64 KB are 413 too_large before the rate limiter sees them', async () => {
  const app = createApp(testDeps());
  const big = JSON.stringify({ email: 'a@ucsd.edu', password: 'x'.repeat(100 * 1024) });
  // 31 > the login per-IP limit of 30: had any of these reached the limiter, the last login below would be 429.
  for (let i = 0; i < 31; i++) {
    const res = await send(app, '/api/auth/login', big);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too_large' });
  }
  const ok = await send(app, '/api/auth/login', JSON.stringify({ email: 'a@ucsd.edu', password: 'hunter2hunter2' }));
  expect(ok.status).toBe(401);
  for (const [method, path] of [['POST', '/api/auth/signup'], ['POST', '/api/account/password'], ['DELETE', '/api/account']] as const) {
    const res = await send(app, path, big, method);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too_large' });
  }
});

test('/api/sync keeps its own larger limit', async () => {
  const app = createApp(testDeps());
  const res = await send(app, '/api/sync', JSON.stringify({ ops: [], pad: 'x'.repeat(100 * 1024) }));
  expect(res.status).toBe(401); // reached the route's session check, not the 64 KB cap
});
