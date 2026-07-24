/** Persist the working plan + browsed pool to localStorage. Best-effort; never throws to the UI. */
import type { CourseOffering, PlanState } from '@triton/shared';

const KEY = 'triton-planner:plan:v1';
const POOL_KEY = 'triton-planner:pool:v1';

/* ---- best-effort localStorage helpers (never throw to the UI) ---- */

/** Read + JSON-parse a key, returning null unless it passes `guard`. */
function readJson<T>(key: string, guard: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** JSON-serialize + write a key; silently ignores storage full/disabled. */
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / disabled — ignore */
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Minimal shape check so a corrupt/foreign value can't crash the app. */
export function isPlanState(value: unknown): value is PlanState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && Array.isArray(v.entries) && typeof v.term === 'object' && v.term !== null;
}

export function savePlan(plan: PlanState): void {
  writeJson(KEY, plan);
}

export function loadPlan(): PlanState | null {
  return readJson(KEY, isPlanState);
}

export function clearPlan(): void {
  removeKey(KEY);
}

/** Loose check that a value is an array of course-shaped objects. */
export function isCoursePool(value: unknown): value is CourseOffering[] {
  return (
    Array.isArray(value) &&
    value.every(
      (c) =>
        c !== null &&
        typeof c === 'object' &&
        typeof (c as Record<string, unknown>).id === 'string' &&
        Array.isArray((c as Record<string, unknown>).options),
    )
  );
}

/** Persist the browsed course pool so the "Browsed — not yet added" list survives reloads. */
export function savePool(pool: CourseOffering[]): void {
  writeJson(POOL_KEY, pool);
}

export function loadPool(): CourseOffering[] | null {
  return readJson(POOL_KEY, isCoursePool);
}

/* ---- received plans (opened from a share link or an imported JSON file) ----
   Kept in their own slot so someone else's plan can NEVER overwrite yours: the
   app shows it read-only and only writes it to the main slot on an explicit
   "Save as my plan". */

const RECEIVED_KEY = 'triton-planner:received:v1';

export interface ReceivedPlan {
  plan: PlanState;
  source: 'link' | 'json';
  receivedAt: string; // ISO timestamp
}

function isReceivedPlan(value: unknown): value is ReceivedPlan {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.source === 'link' || v.source === 'json') &&
    typeof v.receivedAt === 'string' &&
    isPlanState(v.plan)
  );
}

export function saveReceived(received: ReceivedPlan): void {
  writeJson(RECEIVED_KEY, received);
}

export function loadReceived(): ReceivedPlan | null {
  return readJson(RECEIVED_KEY, isReceivedPlan);
}

export function clearReceived(): void {
  removeKey(RECEIVED_KEY);
}

/* ---- which plan a tab is viewing (session-scoped, so a tab that opened a
   share link keeps showing it across reloads while other tabs stay on the
   user's own plan). Lives here with the other persistence keys. ---- */

const VIEWING_KEY = 'triton-planner:viewing:v1';
export type Viewing = 'mine' | 'received';

export function loadViewing(): Viewing {
  try {
    return sessionStorage.getItem(VIEWING_KEY) === 'received' ? 'received' : 'mine';
  } catch {
    return 'mine';
  }
}

export function saveViewing(v: Viewing): void {
  try {
    sessionStorage.setItem(VIEWING_KEY, v);
  } catch {
    /* ignore */
  }
}

/** Course ids the demo sample data seeded — early builds shipped these to production. */
const SEEDED_SAMPLE_IDS = new Set(['CSE-008A|2026|2', 'CSE-030|2026|2', 'CSE-011|2026|2']);
const SAMPLE_PURGE_KEY = 'triton-planner:sample-purged:v1';

/**
 * One-time migration: drop the demo courses that early production builds seeded into
 * the persisted pool. Runs once per browser (flagged), so a course with the same id
 * the student later genuinely browses is never purged again — and the extension
 * re-pushes captured courses on every load anyway.
 */
export function purgeSeededSamples(pool: CourseOffering[]): CourseOffering[] {
  try {
    if (localStorage.getItem(SAMPLE_PURGE_KEY)) return pool;
    localStorage.setItem(SAMPLE_PURGE_KEY, '1');
  } catch {
    return pool;
  }
  return pool.filter((c) => !SEEDED_SAMPLE_IDS.has(c.id));
}
