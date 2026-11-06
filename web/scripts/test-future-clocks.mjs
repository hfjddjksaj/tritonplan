#!/usr/bin/env node
// Runs the web test suite again with "today" pinned to the day after each of the
// next two archive boundaries (see archive-boundaries.mjs), because
// `usePlan.initialState` reads the real clock: the archive sweep, the default
// term and the auto-created next term all flip on those days, and a suite that
// is green today can go red then. `npm test` at the repo root runs this after
// the normal suites; `npm run test:clock -w @triton/web -- <filter>` runs it
// alone. `TP_TEST_DAYS=2026-12-21,2027-03-23` overrides the days.
// The pinning itself lives in src/test-clock.ts (a vitest setup file).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextArchiveDays, todayPT } from './archive-boundaries.mjs';

const require = createRequire(import.meta.url);
const vitestPkg = require.resolve('vitest/package.json');
const vitest = path.join(path.dirname(vitestPkg), require(vitestPkg).bin.vitest);
const webRoot = fileURLToPath(new URL('..', import.meta.url));

const days = process.env.TP_TEST_DAYS
  ? process.env.TP_TEST_DAYS.split(',').map((d) => d.trim()).filter(Boolean)
  : nextArchiveDays(todayPT(new Date()), 2);
const args = process.argv.slice(2);

for (const day of days) {
  console.log(`\n== web tests with the clock at ${day}, Pacific noon ==`);
  const r = spawnSync(process.execPath, [vitest, 'run', ...args], {
    cwd: webRoot,
    stdio: 'inherit',
    env: { ...process.env, TP_TEST_DAY: day },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
