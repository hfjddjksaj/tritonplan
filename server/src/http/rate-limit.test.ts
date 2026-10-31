import { expect, test, vi } from 'vitest';
import { createRateLimiter } from './rate-limit';

test('R9: idle keys are swept by the timer even with no further hits', () => {
  vi.useFakeTimers();
  try {
    const rl = createRateLimiter(() => new Date());
    for (let i = 0; i < 10; i++) rl.hit(`ip-${i}`, 5, 60_000);
    expect(rl.size()).toBe(10);
    vi.advanceTimersByTime(180_000);
    expect(rl.size()).toBe(0);
    rl.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test('rate limiter blocks after the limit and resets after the window', () => {
  let t = 0;
  const rl = createRateLimiter(() => new Date(t));
  for (let i = 0; i < 3; i++) expect(rl.hit('k', 3, 60_000)).toEqual({ ok: true });
  expect(rl.hit('k', 3, 60_000)).toEqual({ ok: false, retryAfterSec: 60 });
  t += 20_500;
  expect(rl.hit('k', 3, 60_000)).toEqual({ ok: false, retryAfterSec: 40 });
  expect(rl.hit('other', 3, 60_000)).toEqual({ ok: true });
  t += 41_000;
  expect(rl.hit('k', 3, 60_000)).toEqual({ ok: true });
});

test('R9: expired windows are pruned, not kept forever', () => {
  let t = 0;
  const rl = createRateLimiter(() => new Date(t));
  for (let i = 0; i < 100; i++) rl.hit(`ip-${i}`, 5, 60_000);
  expect(rl.size()).toBe(100);
  t += 61_000;
  rl.hit('fresh', 5, 60_000);
  expect(rl.size()).toBe(1);
});
