import { describe, it, expect, vi } from 'vitest';

const day = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TP_TEST_DAY;

/** Only meaningful under `npm run test:clock` (TP_TEST_DAY set); skipped at the real clock. */
describe.skipIf(!day)('test-clock.ts under TP_TEST_DAY', () => {
  it('pins today to the given day at Pacific noon, Date only — timers stay real', async () => {
    expect(new Date().toISOString()).toBe(`${day}T20:00:00.000Z`);
    await new Promise((resolve) => setTimeout(resolve, 1)); // would hang if setTimeout were faked
  });

  it('a test that fakes all timers gets them for real, and the day comes back after useRealTimers', () => {
    vi.useFakeTimers();
    let fired = false;
    setTimeout(() => { fired = true; }, 1000);
    vi.advanceTimersByTime(1000);
    expect(fired).toBe(true); // the timers were really faked, not a no-op
    expect(new Date().toISOString()).toBe(`${day}T20:00:01.000Z`);
    vi.useRealTimers();
    expect(new Date().toISOString()).toBe(`${day}T20:00:00.000Z`); // pinned again, timers real again
  });

  it("a test's own setSystemTime wins", () => {
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    expect(new Date().getUTCFullYear()).toBe(2030);
    vi.useRealTimers(); // back to the pinned day for the next test
  });
});
