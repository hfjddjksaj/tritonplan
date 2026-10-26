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
