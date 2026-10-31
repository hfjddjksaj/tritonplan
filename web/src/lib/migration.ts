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
  isApptTimesList, isCoursePool, isPlanState, isPlansState, isReceivedPlan, isTermShape, isTermsState,
  loadApptTimes, loadPlan, loadPlans, loadPool, loadReceived, loadTerms,
  type ReceivedPlan,
} from './storage';
import {
  isPristine, migrateToTermsState, newestTermKey, type TermsState, type TermWorkspace,
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
    (p.appt === null || isApptTimesList(p.appt)) &&
    (p.received === null || isReceivedPlan(p.received)) &&
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
 * Rules (R29 amends the original 2-4):
 *  1. legacy = migrateToTermsState(payload.terms, plans, plan, pool, now).
 *     Plans it minted itself (id not in payload.terms/plans: the pre-terms
 *     plan:v1 / pool-only paths) get a content id 'm-' + fnv1a('v1|' + encoded
 *     plan), because a random UUID would be re-imported as new every time.
 *  2. A legacy workspace that is pristine (the single default empty "My plan")
 *     is not imported: migrateToTermsState invents one when there is no data.
 *     Only the plans of a pristine workspace are dropped, and its single plan
 *     may carry a custom name (isPristine ignores names).
 *     Other empty plans (e.g. a renamed "Plan B") are real and are imported.
 *  3. Extras: `received` -> "Shared plan (old site)", `hashPlan` -> "Plan from
 *     bookmark", both with id 'm-' + fnv1a(encodePlan(plan, 'full')). Each is
 *     dropped when its full encoding equals any account plan or legacy plan
 *     (or an extra already added); an extra whose term is malformed is skipped.
 *  4. Per term: absent from the account -> the whole workspace comes in; a
 *     pristine account workspace (bootstrapped by the app) is replaced by the
 *     legacy one when that has plans to import (counted in added.terms, and it
 *     keeps its own booked lists under the rule below); otherwise plans whose id is not
 *     in the account are appended and the account's activeId is unchanged.
 *     Booked lists: bookedAuto/waitlistedAuto are TSS snapshots and bookedOff
 *     is an override the next feed clears, so when the account already has a
 *     feed for the term (bookedAuto defined) it keeps its own auto/waitlisted/
 *     off and only bookedOn is unioned; otherwise all four lists are unioned.
 *  5. A plan id already in the account (any term) is skipped and counted in
 *     `skipped`: that makes the import idempotent. Ids/term keys the server
 *     would reject, and malformed or duplicate extras, are skipped and counted
 *     the same way. Pristine drops (rule 2) are not counted.
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

  const payloadIds = new Set<string>();
  for (const w of Object.values(payload.terms?.terms ?? {})) for (const p of w.plans.plans) payloadIds.add(p.id);
  for (const p of payload.plans?.plans ?? []) payloadIds.add(p.id);

  const out = new Map<string, TermWorkspace>(Object.entries(accountTerms?.terms ?? {}));
  const seen = new Set<string>();
  const encodings = new Set<string>(); // full encodings of every plan already in the account or the legacy data
  for (const w of out.values()) {
    for (const p of w.plans.plans) {
      seen.add(p.id);
      const enc = safeEncode(p.plan);
      if (enc) encodings.add(enc);
    }
  }

  const added = { terms: 0, plans: 0 };
  let skipped = 0;

  // Account workspaces the app bootstrapped and nobody touched. Judged on the ACCOUNT side only and
  // consumed by the first write, so a plan we just imported can never be mistaken for a placeholder.
  const replaceable = new Set<string>();
  for (const [k, w] of out) if (isPristine(w)) replaceable.add(k);

  const appendTo = (key: string, w: TermWorkspace, fresh: NamedPlan[], bookedFrom?: TermWorkspace) => {
    const existing = out.get(key);
    const activeId = fresh.some((p) => p.id === w.plans.activeId) ? w.plans.activeId : fresh[0]?.id;
    if (existing) {
      const replace = replaceable.delete(key) && fresh.length > 0;
      const plans = replace
        ? { activeId: activeId!, plans: fresh }
        : { ...existing.plans, plans: [...existing.plans.plans, ...fresh] };
      const next: TermWorkspace = { ...existing, plans };
      if (bookedFrom) {
        // A feed the account already has is newer than the old site's snapshot (bookedOff is cleared by the next feed too).
        const fields = existing.bookedAuto !== undefined ? (['bookedOn'] as const) : BOOKED_FIELDS;
        for (const f of fields) {
          const u = union(existing[f], bookedFrom[f]);
          if (u) next[f] = u;
        }
      }
      out.set(key, next);
      if (replace) added.terms++;
    } else {
      const next: TermWorkspace = { ...w, plans: { activeId: activeId!, plans: fresh } };
      if (bookedFrom) for (const f of BOOKED_FIELDS) if (bookedFrom[f]) next[f] = [...bookedFrom[f]!];
      out.set(key, next);
      added.terms++;
    }
    added.plans += fresh.length;
  };

  for (const [key, w] of Object.entries(legacy.terms)) {
    if (isPristine(w)) continue;
    const plans = w.plans.plans.map((p) => {
      const enc = safeEncode(p.plan);
      if (enc) encodings.add(enc);
      return payloadIds.has(p.id) || !enc ? p : { ...p, id: 'm-' + fnv1a('v1|' + enc) };
    });
    const active = plans[w.plans.plans.findIndex((p) => p.id === w.plans.activeId)] ?? plans[0]!;
    const fresh: NamedPlan[] = [];
    for (const p of plans) {
      if (!validKey(key) || !validKey(p.id) || seen.has(p.id)) { skipped++; continue; }
      seen.add(p.id);
      fresh.push(p);
    }
    if (!validKey(key)) continue;
    if (fresh.length > 0 || out.has(key)) {
      appendTo(key, { ...w, plans: { activeId: active.id, plans } }, fresh, w);
    }
  }

  const extras: Array<[PlanState | null, string]> = [
    [payload.received?.plan ?? null, 'Shared plan (old site)'],
    [payload.hashPlan, 'Plan from bookmark'],
  ];
  for (const [plan, name] of extras) {
    if (!plan || plan.entries.length === 0) continue;
    const enc = isTermShape(plan.term) ? safeEncode(plan) : null;
    if (enc === null) { skipped++; continue; }
    const id = 'm-' + fnv1a(enc);
    const key = termKey(plan.term);
    if (!validKey(key) || !validKey(id) || seen.has(id) || encodings.has(enc)) { skipped++; continue; }
    seen.add(id);
    encodings.add(enc);
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

/** False when it could not be stored, so the caller knows the import is not resumable. */
export function savePendingMigration(p: MigrationPayload): boolean {
  try {
    localStorage.setItem(MIGRATION_PENDING_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
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
