/** Persist the working plan + browsed pool to localStorage. Best-effort; never throws to the UI. */
import type { CourseOffering, PlanState } from '@triton/shared';

const KEY = 'triton-planner:plan:v1';
const POOL_KEY = 'triton-planner:pool:v1';

/** Minimal shape check so a corrupt/foreign value can't crash the app. */
export function isPlanState(value: unknown): value is PlanState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && Array.isArray(v.entries) && typeof v.term === 'object' && v.term !== null;
}

export function savePlan(plan: PlanState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(plan));
  } catch {
    /* storage full / disabled — ignore */
  }
}

export function loadPlan(): PlanState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPlanState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPlan(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
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
  try {
    localStorage.setItem(POOL_KEY, JSON.stringify(pool));
  } catch {
    /* ignore */
  }
}

export function loadPool(): CourseOffering[] | null {
  try {
    const raw = localStorage.getItem(POOL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCoursePool(parsed) ? parsed : null;
  } catch {
    return null;
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
