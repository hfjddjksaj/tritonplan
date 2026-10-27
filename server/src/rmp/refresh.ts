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
    const at = rmpFetchedAt(deps.db);
    const ts = at ? Date.parse(at) : NaN;
    if (Number.isFinite(ts) && deps.now().getTime() - ts < MAX_AGE) return;
    running = true;
    try {
      const rows = await fetchAllTeachers(deps.fetch);
      replaceTeachers(deps.db, rows, deps.now().toISOString());
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
