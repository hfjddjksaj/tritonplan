/**
 * Moving a student's old-site plans into their account. Pure functions shared
 * by the old-site migration page (which only COLLECTS) and the new site (which
 * MERGES), so both halves agree on the payload shape and on idempotence: the
 * same payload imported twice, or from two devices, adds nothing the second
 * time. Only collectLegacyPayload and the pending-* helpers touch storage.
 */
import type { ApptTimes, CourseOffering, PlanState } from '@triton/shared';
import { mergeCourses } from './bridge';
import { decodePlan, encodePlan, mirrorTokenFromHash } from './share';
import {
  isCoursePool, isPlanState, isPlansState, isTermsState,
  loadApptTimes, loadPlan, loadPlans, loadPool, loadReceived, loadTerms,
  type ReceivedPlan,
} from './storage';
import {
  migrateToTermsState, newestTermKey, type TermsState, type TermWorkspace,
} from './terms-state';
import type { NamedPlan, PlansState } from './plans';
import { termKey } from './terms';

export interface MigrationPayload {
  kind: 'tritonplan-migration';
  version: 1;
  exportedAt: string;
  /** Raw old-site values: the old site never migrates, the new site does. */
  terms: TermsState | null;
  plans: PlansState | null;
  plan: PlanState | null;
  pool: CourseOffering[];
  appt: ApptTimes[] | null;
  received: ReceivedPlan | null;
  /** The plan carried by `#m=` when the old site was opened from a bookmark/synced tab. */
  hashPlan: PlanState | null;
}

/** localStorage (not session) so it survives the Google redirect and a verify-mail click in a new tab. */
export const MIGRATION_PENDING_KEY = 'triton-planner:migration-pending:v1';

/** postMessage names between the new site and the old-site migration page. */
export const MIGRATE_MSG = {
  ready: 'tp-migrate-ready',
  payload: 'tp-migrate-payload',
  ack: 'tp-migrate-ack',
} as const;

export function collectLegacyPayload(hash: string, nowIso: string): MigrationPayload {
  const token = mirrorTokenFromHash(hash);
  return {
    kind: 'tritonplan-migration',
    version: 1,
    exportedAt: nowIso,
    terms: loadTerms(),
    plans: loadPlans(),
    plan: loadPlan(),
    pool: loadPool() ?? [],
    appt: loadApptTimes(),
    received: loadReceived(),
    hashPlan: token ? decodePlan(token) : null,
  };
}

function isReceived(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (r.source === 'link' || r.source === 'json') && typeof r.receivedAt === 'string' && isPlanState(r.plan);
}

/** Validates with the same guards storage.ts uses, but tolerates unknown extra fields. */
export function isMigrationPayload(v: unknown): v is MigrationPayload {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    p.kind === 'tritonplan-migration' &&
    p.version === 1 &&
    typeof p.exportedAt === 'string' &&
    (p.terms === null || isTermsState(p.terms)) &&
    (p.plans === null || isPlansState(p.plans)) &&
    (p.plan === null || isPlanState(p.plan)) &&
    isCoursePool(p.pool) &&
    (p.appt === null || Array.isArray(p.appt)) &&
    (p.received === null || isReceived(p.received)) &&
    (p.hashPlan === null || isPlanState(p.hashPlan))
  );
}

/** 32-bit FNV-1a over UTF-16 code units, 8 lowercase hex chars. Exported for its test vector only. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface MergeResult {
  terms: TermsState;
  pool: CourseOffering[];
  appt: ApptTimes[] | null;
  added: { terms: number; plans: number };
  skipped: number;
}

/** The server rejects ids/keys outside 1-100 chars and prototype-polluting names; never emit them. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function validKey(k: unknown): k is string {
  return typeof k === 'string' && k.length >= 1 && k.length <= 100 && !FORBIDDEN_KEYS.has(k);
}

/** Nothing the student did: single default plan state with no courses and no browsed history. */
function isPristinePlan(p: NamedPlan): boolean {
  return p.plan.entries.length === 0 && (p.browsed ?? []).length === 0;
}

function safeEncode(plan: PlanState): string | null {
  try {
    return encodePlan(plan, 'full');
  } catch {
    return null;
  }
}

function union(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a && !b) return undefined;
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

const BOOKED_FIELDS = ['bookedAuto', 'bookedOn', 'bookedOff', 'waitlistedAuto'] as const;

/**
 * Merge old-site data into the account; the result is uploaded right after.
 *
 * Rules:
 *  1. legacy = migrateToTermsState(payload.terms, plans, plan, pool, now).
 *  2. A plan with neither courses nor browsed history is NOT imported:
 *     migrateToTermsState invents an empty "My plan" when there is no data,
 *     and that must not become noise in the account.
 *  3. Extra plans: `received` -> "Shared plan (old site)"; `hashPlan` ->
 *     "Plan from bookmark", only when its full encoding differs from every
 *     legacy plan. Both get a content-derived id 'm-' + fnv1a(encodePlan(plan,
 *     'full')) so a repeat import does not duplicate them.
 *  4. Per term: absent from the account -> the whole workspace comes in (a
 *     term left with no plans after filtering is dropped); present -> plans
 *     whose id is not in the account are appended, bookedAuto/On/Off and
 *     waitlistedAuto are unioned, the account's activeId is unchanged.
 *  5. A plan id already in the account (any term) is skipped and counted in
 *     `skipped` - this is what makes the import idempotent. Ids/term keys the
 *     server would reject are skipped and counted the same way.
 *  6. pool = mergeCourses(payload.pool, account.pool): the account's copy is
 *     the newer one and overrides the old site's.
 *  7. appt = account.appt?.length ? account.appt : payload.appt.
 *  8. An account with no terms gets the legacy data as-is (plus the extras)
 *     and activeTermKey = newestTermKey; otherwise its activeTermKey stays.
 *
 * Inputs are never mutated.
 */
export function mergeMigration(
  account: { terms: TermsState | null; pool: CourseOffering[]; appt: ApptTimes[] | null },
  payload: MigrationPayload,
  nowIso: string,
): MergeResult {
  const legacy = migrateToTermsState(payload.terms, payload.plans, payload.plan, payload.pool, nowIso);
  const accountTerms = account.terms && Object.keys(account.terms.terms).length > 0 ? account.terms : null;

  const out = new Map<string, TermWorkspace>(Object.entries(accountTerms?.terms ?? {}));
  const seen = new Set<string>();
  for (const w of out.values()) for (const p of w.plans.plans) seen.add(p.id);

  const added = { terms: 0, plans: 0 };
  let skipped = 0;

  const appendTo = (key: string, w: TermWorkspace, fresh: NamedPlan[], bookedFrom?: TermWorkspace) => {
    const existing = out.get(key);
    if (existing) {
      const next: TermWorkspace = { ...existing, plans: { ...existing.plans, plans: [...existing.plans.plans, ...fresh] } };
      if (bookedFrom) {
        for (const f of BOOKED_FIELDS) {
          const u = union(existing[f], bookedFrom[f]);
          if (u) next[f] = u;
        }
      }
      out.set(key, next);
    } else {
      const activeId = fresh.some((p) => p.id === w.plans.activeId) ? w.plans.activeId : fresh[0]!.id;
      const next: TermWorkspace = { ...w, plans: { activeId, plans: fresh } };
      if (bookedFrom) for (const f of BOOKED_FIELDS) if (bookedFrom[f]) next[f] = [...bookedFrom[f]!];
      out.set(key, next);
      added.terms++;
    }
    added.plans += fresh.length;
  };

  const legacyEncodings = new Set<string>();
  for (const [key, w] of Object.entries(legacy.terms)) {
    const fresh: NamedPlan[] = [];
    for (const p of w.plans.plans) {
      const enc = safeEncode(p.plan);
      if (enc) legacyEncodings.add(enc);
      if (isPristinePlan(p)) continue;
      if (!validKey(key) || !validKey(p.id) || seen.has(p.id)) { skipped++; continue; }
      seen.add(p.id);
      fresh.push(p);
    }
    if (!validKey(key)) continue;
    if (fresh.length > 0 || out.has(key)) appendTo(key, w, fresh, w);
  }

  const extras: Array<[PlanState | null, string, boolean]> = [
    [payload.received?.plan ?? null, 'Shared plan (old site)', false],
    [payload.hashPlan, 'Plan from bookmark', true],
  ];
  for (const [plan, name, dedupeAgainstLegacy] of extras) {
    if (!plan || plan.entries.length === 0) continue;
    const enc = safeEncode(plan);
    if (enc === null) { skipped++; continue; }
    if (dedupeAgainstLegacy && legacyEncodings.has(enc)) continue;
    const id = 'm-' + fnv1a(enc);
    const key = termKey(plan.term);
    if (!validKey(key) || !validKey(id) || seen.has(id)) { skipped++; continue; }
    seen.add(id);
    const np: NamedPlan = {
      id, name, plan, createdAt: nowIso, updatedAt: nowIso, browsed: plan.entries.map((e) => e.course.id),
    };
    appendTo(key, { term: plan.term, plans: { activeId: id, plans: [np] } }, [np]);
  }

  const pool = mergeCourses(payload.pool, account.pool);
  const appt = account.appt?.length ? account.appt : payload.appt;

  // Nothing at all to hold: TermsState may not be empty, so fall back to the bootstrap the app itself would make.
  if (out.size === 0) {
    return { terms: migrateToTermsState(null, null, null, [], nowIso), pool, appt, added, skipped };
  }
  const merged: TermsState = { version: 1, activeTermKey: '', terms: Object.fromEntries(out) };
  merged.activeTermKey =
    accountTerms && out.has(accountTerms.activeTermKey) ? accountTerms.activeTermKey : newestTermKey(merged);
  return { terms: merged, pool, appt, added, skipped };
}

/* ---- pending migration (survives sign-in redirects) ---- */

export function savePendingMigration(p: MigrationPayload): void {
  try {
    localStorage.setItem(MIGRATION_PENDING_KEY, JSON.stringify(p));
  } catch {
    /* storage full / disabled - the import then simply isn't resumable */
  }
}

export function loadPendingMigration(): MigrationPayload | null {
  try {
    const raw = localStorage.getItem(MIGRATION_PENDING_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isMigrationPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingMigration(): void {
  try {
    localStorage.removeItem(MIGRATION_PENDING_KEY);
  } catch {
    /* ignore */
  }
}
