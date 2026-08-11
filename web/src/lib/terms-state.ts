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
  addBrowsed, newPlanId, updateActivePlan,
  type NamedPlan, type PlansState,
} from './plans';
import { chronoIndex, termKey, type TermKey } from './terms';

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
