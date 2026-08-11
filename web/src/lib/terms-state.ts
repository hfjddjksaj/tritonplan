/**
 * The term-switcher container: one TermWorkspace per academic term, each
 * holding its own complete PlansState (spec 2026-08-10 §3). plans.ts pure
 * functions are reused unchanged inside a workspace. Invariants mirror
 * plans.ts: `terms` is never empty and `activeTermKey` always points at a
 * member; every mutator preserves them and returns the same reference on no-op.
 */
import type { CourseOffering, PlanState, Term } from '@triton/shared';
import { emptyPlan } from './plan';
import {
  addBrowsed, migratePlans, newPlanId, updateActivePlan,
  type NamedPlan, type PlansState,
} from './plans';
import { chronoIndex, isArchived, termKey, type TermKey } from './terms';

export interface TermWorkspace {
  term: Term;
  plans: PlansState;
}

export interface TermsState {
  version: 1;
  activeTermKey: TermKey;
  terms: Record<TermKey, TermWorkspace>;
}

export function newWorkspace(term: Term, now: string): TermWorkspace {
  const id = newPlanId();
  const plan: NamedPlan = {
    id, name: 'My plan', plan: emptyPlan(term), createdAt: now, updatedAt: now, browsed: [],
  };
  return { term, plans: { activeId: id, plans: [plan] } };
}

export function ensureWorkspace(state: TermsState, term: Term, now: string): TermsState {
  const key = termKey(term);
  if (state.terms[key]) return state;
  return { ...state, terms: { ...state.terms, [key]: newWorkspace(term, now) } };
}

export function activeWorkspace(state: TermsState): TermWorkspace {
  return state.terms[state.activeTermKey] ?? Object.values(state.terms)[0]!;
}

/** Update ONE workspace's PlansState; same state back when the updater no-ops. */
export function updateWorkspace(
  state: TermsState,
  key: TermKey,
  fn: (plans: PlansState) => PlansState,
): TermsState {
  const ws = state.terms[key];
  if (!ws) return state;
  const next = fn(ws.plans);
  if (next === ws.plans) return state;
  return { ...state, terms: { ...state.terms, [key]: { ...ws, plans: next } } };
}

/** Map EVERY workspace (e.g. seat refreshes); same state back when nothing changed. */
export function mapWorkspaces(state: TermsState, fn: (ws: TermWorkspace) => PlansState): TermsState {
  let changed = false;
  const terms: Record<TermKey, TermWorkspace> = {};
  for (const [key, ws] of Object.entries(state.terms)) {
    const next = fn(ws);
    if (next === ws.plans) { terms[key] = ws; continue; }
    changed = true;
    terms[key] = { ...ws, plans: next };
  }
  return changed ? { ...state, terms } : state;
}

export function switchTermIn(state: TermsState, key: TermKey): TermsState {
  if (state.activeTermKey === key || !state.terms[key]) return state;
  return { ...state, activeTermKey: key };
}

/** Latest plan-updatedAt inside a workspace — tie-breaker for unknown-season terms. */
function latestUpdate(ws: TermWorkspace): string {
  return ws.plans.plans.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), '');
}

/** The chronologically newest workspace; unknown-season terms only win when nothing joins the timeline. */
export function newestTermKey(state: TermsState): TermKey {
  const entries = Object.entries(state.terms);
  let best: { key: TermKey; idx: number } | null = null;
  for (const [key, ws] of entries) {
    const idx = chronoIndex(ws.term);
    if (idx !== null && (best === null || idx > best.idx)) best = { key, idx };
  }
  if (best) return best.key;
  return entries.reduce((a, b) => (latestUpdate(b[1]) > latestUpdate(a[1]) ? b : a))[0];
}

export function allPlansEmpty(state: TermsState): boolean {
  return Object.values(state.terms).every((ws) => ws.plans.plans.every((p) => p.plan.entries.length === 0));
}

/** Adopt an address-bar mirror seed (bookmark/sync open on a fresh device) into its own term. */
export function adoptSeedPlan(state: TermsState, seed: PlanState, now: string): TermsState {
  const key = termKey(seed.term);
  let next = ensureWorkspace(state, seed.term, now);
  next = updateWorkspace(next, key, (ps) => {
    const replaced = updateActivePlan(ps, () => seed, now);
    return addBrowsed(replaced, replaced.activeId, seed.entries.map((e) => e.course.id), now);
  });
  return { ...next, activeTermKey: key };
}

/** A workspace nobody touched: single default plan, no entries, no browsed history. */
export function isPristine(ws: TermWorkspace): boolean {
  const only = ws.plans.plans.length === 1 ? ws.plans.plans[0]! : null;
  return only !== null && only.plan.entries.length === 0 && (only.browsed ?? []).length === 0;
}

/**
 * Build the working TermsState. Precedence: valid stored terms:v1 (repairing a
 * dangling activeTermKey) → flat plans:v1 / legacy plan:v1 grouped by term →
 * fresh DEFAULT_TERM bootstrap. Old keys are read-only rollback backstops.
 */
export function migrateToTermsState(
  existing: TermsState | null,
  plansV1: PlansState | null,
  legacyPlan: PlanState | null,
  pool: CourseOffering[],
  now: string,
): TermsState {
  if (existing && Object.keys(existing.terms).length > 0) {
    if (existing.terms[existing.activeTermKey]) return existing;
    return { ...existing, activeTermKey: newestTermKey(existing) };
  }

  const flat = migratePlans(plansV1, legacyPlan, now);
  const poolIdsByTerm = new Map<TermKey, string[]>();
  for (const c of pool) {
    const key = termKey(c.term);
    poolIdsByTerm.set(key, [...(poolIdsByTerm.get(key) ?? []), c.id]);
  }

  const terms: Record<TermKey, TermWorkspace> = {};
  for (const p of flat.plans) {
    const key = termKey(p.plan.term);
    const hidden = new Set(p.hidden ?? []);
    const entryIds = p.plan.entries.map((e) => e.course.id);
    const browsed = [
      ...new Set([...(poolIdsByTerm.get(key) ?? []).filter((id) => !hidden.has(id)), ...entryIds]),
    ];
    const { hidden: _dropped, ...rest } = p;
    const migrated: NamedPlan = { ...rest, browsed };
    const ws = terms[key];
    if (!ws) {
      terms[key] = { term: p.plan.term, plans: { activeId: p.id, plans: [migrated] } };
    } else {
      const activeId = p.id === flat.activeId ? p.id : ws.plans.activeId;
      terms[key] = { ...ws, plans: { activeId, plans: [...ws.plans.plans, migrated] } };
    }
  }

  const state: TermsState = { version: 1, activeTermKey: Object.keys(terms)[0]!, terms };
  return { ...state, activeTermKey: newestTermKey(state) };
}

export interface SweepResult {
  state: TermsState;
  pool: CourseOffering[];
  forgetModuleIds: string[];
}

/** Empty every plan's browsed list; same PlansState back when already clear. */
function clearAllBrowsed(ps: PlansState, now: string): PlansState {
  if (ps.plans.every((p) => (p.browsed ?? []).length === 0)) return ps;
  return {
    ...ps,
    plans: ps.plans.map((p) => ((p.browsed ?? []).length === 0 ? p : { ...p, browsed: [], updatedAt: now })),
  };
}

/**
 * Runs on every app load (spec §6). Archived-ness is DERIVED from the date —
 * no stored flag — and the cleanup converges: after one sweep the pool holds
 * nothing from archived terms, so the next run finds nothing to do.
 */
export function archiveSweep(state: TermsState, pool: CourseOffering[], now: Date): SweepResult {
  const nowIso = now.toISOString();
  const archivedKeys = new Set(
    Object.entries(state.terms).filter(([, ws]) => isArchived(ws.term, now)).map(([key]) => key),
  );

  const droppedCourses = pool.filter((c) => archivedKeys.has(termKey(c.term)));
  const nextPool = droppedCourses.length === 0 ? pool : pool.filter((c) => !archivedKeys.has(termKey(c.term)));

  let termsChanged = false;
  const terms: Record<TermKey, TermWorkspace> = {};
  for (const [key, ws] of Object.entries(state.terms)) {
    if (!archivedKeys.has(key)) { terms[key] = ws; continue; }
    const hasCourses = ws.plans.plans.some((p) => p.plan.entries.length > 0);
    if (!hasCourses) { termsChanged = true; continue; } // delete empty archived term
    const cleared = clearAllBrowsed(ws.plans, nowIso);
    if (cleared === ws.plans) { terms[key] = ws; continue; }
    termsChanged = true;
    terms[key] = { ...ws, plans: cleared };
  }
  // Never end up with zero workspaces: resurrect the newest one, browsed cleared.
  if (Object.keys(terms).length === 0) {
    const key = newestTermKey(state);
    const ws = state.terms[key]!;
    terms[key] = { ...ws, plans: clearAllBrowsed(ws.plans, nowIso) };
    termsChanged = true;
  }

  if (!termsChanged && droppedCourses.length === 0) {
    return { state, pool, forgetModuleIds: [] };
  }
  let nextState: TermsState = termsChanged ? { ...state, terms } : state;
  if (!nextState.terms[nextState.activeTermKey]) {
    nextState = { ...nextState, activeTermKey: newestTermKey(nextState) };
  }
  return {
    state: nextState,
    pool: nextPool,
    forgetModuleIds: [...new Set(droppedCourses.map((c) => c.moduleId))],
  };
}
