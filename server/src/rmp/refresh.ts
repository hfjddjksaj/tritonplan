import type { Deps } from '../app';
import { fetchAllTeachers } from './fetch';
import { replaceTeachers, rmpFetchedAt } from './store';

const DAY = 24 * 3600_000;
const MAX_AGE = 30 * DAY;

/** Boot-time fetch if the snapshot is missing or over 30 days old, then a daily staleness check. Returns stop. */
export function startRmpRefresh(deps: Pick<Deps, 'db' | 'now' | 'fetch'>): () => void {
  let running = false;

  const check = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      // Inside the try: a throw here would be an unhandled rejection from the timer, which exits Node.
      const at = rmpFetchedAt(deps.db);
      const ts = at ? Date.parse(at) : NaN;
      if (Number.isFinite(ts) && deps.now().getTime() - ts < MAX_AGE) return;
      const rows = await fetchAllTeachers(deps.fetch);
      const stored = (deps.db.prepare('SELECT COUNT(*) AS n FROM rmp_teachers').get() as { n: number }).n;
      // A roster that lost over half its people is more likely a broken answer than a real change.
      if (rows.length < stored / 2) throw new Error(`RMP roster shrunk from ${stored} to ${rows.length}`);
      replaceTeachers(deps.db, rows, deps.now().toISOString());
      // One count, no names and nothing from the response: lets the operator see in the journal that a refresh ran.
      console.log(`RMP refreshed: ${rows.length} teachers`);
    } catch (e) {
      // One line, message only: no body, no stack. The old snapshot stays and the next daily check retries.
      console.error(`RMP refresh failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      running = false;
    }
  };

  void check();
  const timer = setInterval(() => void check(), DAY);
  timer.unref(); // never keeps the process alive
  return () => clearInterval(timer);
}
