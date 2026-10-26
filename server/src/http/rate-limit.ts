export type RateResult = { ok: true } | { ok: false; retryAfterSec: number };

export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): RateResult;
  /** Live key count; exists so tests can prove expired windows do not linger. */
  size(): number;
}

const SWEEP_EVERY_MS = 60_000;

/**
 * Fixed-window limiter, in memory only: keys (which may be IPs) are never persisted or logged, and
 * expired windows are swept lazily on hit so memory holds no key past its window (privacy policy, R9).
 * No timer: nothing keeps the process alive.
 */
export function createRateLimiter(now: () => Date): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now().getTime();

  return {
    hit(key, limit, windowMs) {
      const t = now().getTime();
      if (t - lastSweep >= SWEEP_EVERY_MS) {
        for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
        lastSweep = t;
      }
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
  };
}
