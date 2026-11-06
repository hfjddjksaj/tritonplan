/**
 * Future-clock test runs. With `TP_TEST_DAY=YYYY-MM-DD` set, "today" is pinned
 * (Date only — timers stay real) to that day at Pacific noon for every test that
 * does not set its own clock; without it this file does nothing.
 *
 * Why: `usePlan.initialState` reads the real clock — the archive sweep, the
 * default term and the auto-created next term all flip on fixed month-days
 * (`BOUNDARY` in `lib/terms.ts`) — so a suite that is green today can go red on
 * the next boundary. `npm run test:clock` (scripts/test-future-clocks.mjs) runs
 * the suite again at the next boundaries; any change that touches that boot
 * path runs it before it ships.
 *
 * `vi.useFakeTimers()` is a no-op while a Date-only clock is installed, so a
 * test that fakes all timers would silently keep the real setTimeout: both
 * switches are wrapped to uninstall first and to put the pinned day back after
 * `vi.useRealTimers()`. A test's own `vi.setSystemTime` still wins.
 */
import { vi } from 'vitest';

const day = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TP_TEST_DAY;

if (day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`TP_TEST_DAY must be YYYY-MM-DD, got "${day}"`);
  const pinned = new Date(`${day}T20:00:00Z`); // noon PST / 1 PM PDT — the same Pacific calendar day either way
  const fake = vi.useFakeTimers.bind(vi);
  const real = vi.useRealTimers.bind(vi);
  const pin = () => {
    real();
    fake({ toFake: ['Date'] });
    vi.setSystemTime(pinned);
  };
  vi.useFakeTimers = (config?: Parameters<typeof fake>[0]) => {
    real();
    fake(config);
    vi.setSystemTime(pinned);
    return vi;
  };
  vi.useRealTimers = () => {
    pin();
    return vi;
  };
  pin();
}
