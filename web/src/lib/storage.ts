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
    isPlanState(v.plan) &&
    (v.hidden === undefined || Array.isArray(v.hidden)) &&
    (v.browsed === undefined || Array.isArray(v.browsed))
  );
}

export function isPlansState(value: unknown): value is import('./plans').PlansState {
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

/* ---- per-term workspaces (the term switcher container) --------------------- */

const TERMS_KEY = 'triton-planner:terms:v1';

export function isTermShape(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.year === 'string' && typeof v.period === 'string' && typeof v.label === 'string';
}

function isOptionalIdList(v: unknown): boolean {
  return v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
}

function isTermWorkspace(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    isTermShape(v.term) &&
    isPlansState(v.plans) &&
    isOptionalIdList(v.bookedAuto) &&
    isOptionalIdList(v.bookedOn) &&
    isOptionalIdList(v.bookedOff) &&
    isOptionalIdList(v.waitlistedAuto)
  );
}

export function isTermsState(value: unknown): value is import('./terms-state').TermsState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.activeTermKey !== 'string') return false;
  if (!v.terms || typeof v.terms !== 'object') return false;
  const workspaces = Object.values(v.terms as Record<string, unknown>);
  return workspaces.length > 0 && workspaces.every(isTermWorkspace);
}

export function saveTerms(state: import('./terms-state').TermsState): void {
  writeJson(TERMS_KEY, state);
}

export function loadTerms(): import('./terms-state').TermsState | null {
  return readJson(TERMS_KEY, isTermsState);
}

/* ---- the received-plan slot an older version kept --------------------------
   Someone else's plan, opened from a #p= link, stored apart from the user's own.
   Nothing writes it any more, and dropRetiredState clears it on this site; the
   old site's hand-off still reads it on its own origin, to carry that plan into
   the account. */

const RECEIVED_KEY = 'triton-planner:received:v1';

export interface ReceivedPlan {
  plan: PlanState;
  /** 'json' was an imported file, a path an older build already removed. */
  source: 'link' | 'json';
  receivedAt: string; // ISO timestamp
}

export function isReceivedPlan(value: unknown): value is ReceivedPlan {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.source === 'link' || v.source === 'json') &&
    typeof v.receivedAt === 'string' &&
    isPlanState(v.plan)
  );
}

export function loadReceived(): ReceivedPlan | null {
  return readJson(RECEIVED_KEY, isReceivedPlan);
}

/* ---- keys an older version wrote that nothing reads any more ----------------
   The received slot and which tab was viewing it, the share-link echo marker,
   and the Saves a signed-out visitor clicked on a shared plan (a shared plan is
   saved from its own page now). Removing them on every load costs nothing, and
   they would otherwise sit in this browser for good. */
const RETIRED_LOCAL_KEYS = [RECEIVED_KEY, 'triton-planner:saved-shares:v1'];
const RETIRED_SESSION_KEYS = [
  'triton-planner:viewing:v1',
  'triton-planner:synced-hash:v1',
  'triton-planner:pending-save:v1',
];

export function dropRetiredState(): void {
  for (const key of RETIRED_LOCAL_KEYS) removeKey(key);
  for (const key of RETIRED_SESSION_KEYS) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* storage blocked: nothing was kept either */
    }
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

/* --- campus map "booked only" preference ------------------------------------- */
const MAP_BOOKED_ONLY_KEY = 'triton-planner:map-booked-only:v1';

/**
 * "Booked only" toggle for the campus map. null = never chosen, so the map can
 * pick its own default (on when booked data exists, off when it doesn't).
 *
 * A LOCAL view preference, exactly like cal-view: it never enters a plan, a
 * share link, or a QR code.
 */
export function loadMapBookedOnly(): boolean | null {
  return readJson(MAP_BOOKED_ONLY_KEY, (v): v is boolean => typeof v === 'boolean');
}

export function saveMapBookedOnly(value: boolean): void {
  writeJson(MAP_BOOKED_ONLY_KEY, value);
}

/* --- one-time "the extension may be switched off" note (UI preference) ------ */
const EXT_UPDATE_NOTE_KEY = 'triton-planner:ext-update-note:v1';

export function loadExtUpdateNoteDismissed(): boolean {
  return readJson(EXT_UPDATE_NOTE_KEY, (v): v is true => v === true) === true;
}

export function saveExtUpdateNoteDismissed(): void {
  writeJson(EXT_UPDATE_NOTE_KEY, true);
}
