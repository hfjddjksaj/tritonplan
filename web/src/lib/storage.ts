/** Persist the working plan + browsed pool to localStorage. Best-effort; never throws to the UI. */
import type { ApptTimes, CourseOffering, PlanState } from '@triton/shared';

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

/* ---- named plans list ------------------------------------------------------
   Multiple plans the user can switch between. The legacy single-plan slot
   (`plan:v1`) is migrated into this on first load and then left untouched
   (a stale rollback backstop — never written again). */

const PLANS_KEY = 'triton-planner:plans:v1';

function isNamedPlan(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    isPlanState(v.plan)
  );
}

function isPlansState(value: unknown): value is import('./plans').PlansState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.activeId === 'string' &&
    Array.isArray(v.plans) &&
    v.plans.length > 0 &&
    v.plans.every(isNamedPlan)
  );
}

export function savePlans(state: import('./plans').PlansState): void {
  writeJson(PLANS_KEY, state);
}

export function loadPlans(): import('./plans').PlansState | null {
  return readJson(PLANS_KEY, isPlansState);
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

/* --- share-link echo marker (sessionStorage, per-tab) -----------------------
 * A #p=… link this tab parked in its own address bar (the ShareMenu clipboard
 * fallback). On load, a hash equal to this marker is our own echo, NOT an
 * incoming shared plan. The address-bar mirror does NOT use this: it writes
 * #m=…, whose key alone says "mine" — per-tab state cannot help a bookmark,
 * which always opens in a fresh tab. See readHash() in share.ts. */
const SYNCED_KEY = 'triton-planner:synced-hash:v1';

export function saveSyncedToken(token: string): void {
  try {
    sessionStorage.setItem(SYNCED_KEY, token);
  } catch {
    /* storage disabled — ignore */
  }
}

export function loadSyncedToken(): string | null {
  try {
    return sessionStorage.getItem(SYNCED_KEY);
  } catch {
    return null;
  }
}

/* --- mobile calendar view preference ---------------------------------------- */
const CAL_VIEW_KEY = 'triton-planner:cal-view:v1';

export type CalView = 'fit' | 'scroll';

export function loadCalView(): CalView {
  try {
    return localStorage.getItem(CAL_VIEW_KEY) === 'scroll' ? 'scroll' : 'fit';
  } catch {
    return 'fit';
  }
}

export function saveCalView(v: CalView): void {
  try {
    localStorage.setItem(CAL_VIEW_KEY, v);
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

/* ---- appointment times (the student's own enrollment windows) --------------
   Personal data, global to this browser: NOT part of any plan, never included
   in share links, QR codes or exports. Latest extension push wins. */

const APPT_KEY = 'triton-planner:appt:v1';

function isApptWindow(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.label === 'string' && typeof v.beginsAt === 'string' && typeof v.endsAt === 'string'
  );
}

export function isApptTimesList(value: unknown): value is ApptTimes[] {
  return (
    Array.isArray(value) &&
    value.every((a) => {
      if (!a || typeof a !== 'object') return false;
      const v = a as Record<string, unknown>;
      return (
        typeof v.academicYear === 'string' &&
        typeof v.academicSession === 'string' &&
        typeof v.yearText === 'string' &&
        typeof v.sessionText === 'string' &&
        typeof v.capturedAt === 'string' &&
        Array.isArray(v.windows) &&
        v.windows.every(isApptWindow)
      );
    })
  );
}

export function saveApptTimes(appt: ApptTimes[]): void {
  writeJson(APPT_KEY, appt);
}

export function loadApptTimes(): ApptTimes[] | null {
  return readJson(APPT_KEY, isApptTimesList);
}
