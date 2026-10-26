export type RateResult = { ok: true } | { ok: false; retryAfterSec: number };

export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): RateResult;
  /** Live key count; exists so tests can prove expired windows do not linger. */
  size(): number;
  /** Stop the sweep timer (tests / shutdown). */
  dispose(): void;
}

const SWEEP_EVERY_MS = 60_000;

/**
 * Fixed-window limiter, in memory only: keys (which may be IPs) are never persisted or logged.
 * Expired windows are swept on every hit and by an unref'd 60s timer, so an idle server also drops them:
 * a key lives at most its window plus one sweep interval (privacy policy promises "up to an hour", R9).
 * unref() keeps the timer from holding the process (or a test run) open.
 */
export function createRateLimiter(now: () => Date): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now().getTime();

  const sweep = (t: number): void => {
    for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
    lastSweep = t;
  };
  const timer = setInterval(() => sweep(now().getTime()), SWEEP_EVERY_MS);
  timer.unref();

  return {
    hit(key, limit, windowMs) {
      const t = now().getTime();
      if (t - lastSweep >= SWEEP_EVERY_MS) sweep(t);
      let w = windows.get(key);
      if (!w || w.resetAt <= t) {
        w = { count: 0, resetAt: t + windowMs };
        windows.set(key, w);
      }
      if (w.count >= limit) return { ok: false, retryAfterSec: Math.ceil((w.resetAt - t) / 1000) };
      w.count++;
      return { ok: true };
    },
    size: () => windows.size,
    dispose: () => clearInterval(timer),
  };
}
