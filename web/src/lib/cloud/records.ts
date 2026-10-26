/**
 * Pure split/assemble between the in-memory TermsState and the server's
 * records: one term doc (TermMeta, no plan bodies) per term and one plan doc
 * per NamedPlan. No React, no fetch, no storage.
 */
import type { StateSnapshot, Term } from '@triton/shared';
import type { TermKey } from '../terms';
import type { NamedPlan } from '../plans';
import { newestTermKey, type TermsState, type TermWorkspace } from '../terms-state';

/** TermWorkspace minus the plan bodies; `planOrder` carries their order. */
export interface TermMeta {
  term: Term;
  activeId: string;
  planOrder: string[];
  bookedAuto?: string[];
  bookedOn?: string[];
  bookedOff?: string[];
  waitlistedAuto?: string[];
}
export type WebSnapshot = StateSnapshot<TermMeta, NamedPlan>;
export type PlanRecords = Record<string, { termKey: TermKey; plan: NamedPlan }>;

const BOOKED_KEYS = ['bookedAuto', 'bookedOn', 'bookedOff', 'waitlistedAuto'] as const;

export function splitTerms(state: TermsState): { terms: Record<TermKey, TermMeta>; plans: PlanRecords } {
  const terms: Record<TermKey, TermMeta> = {};
  const plans: PlanRecords = {};
  for (const [key, ws] of Object.entries(state.terms)) {
    const meta: TermMeta = { term: ws.term, activeId: ws.plans.activeId, planOrder: ws.plans.plans.map((p) => p.id) };
    for (const k of BOOKED_KEYS) if (ws[k] !== undefined) meta[k] = ws[k];
    terms[key] = meta;
    for (const plan of ws.plans.plans) plans[plan.id] = { termKey: key, plan };
  }
  return { terms, plans };
}

/**
 * Rebuild a TermsState from server records, tolerating drift between docs:
 *  - plans are ordered by `planOrder`; plans of the term that `planOrder` does
 *    not list are appended after (ids in `planOrder` with no record are skipped);
 *  - a plan whose term has no meta gets one built from `plan.plan.term`;
 *  - a term left with no plans at all is dropped (plans.ts requires >= 1 plan);
 *  - a dangling `activeId` is repaired to the first plan.
 * activeTermKey = newestTermKey; no surviving term → null.
 */
export function assembleTerms(terms: Record<TermKey, TermMeta>, plans: PlanRecords): TermsState | null {
  const byTerm = new Map<TermKey, NamedPlan[]>();
  for (const { termKey, plan } of Object.values(plans)) {
    const list = byTerm.get(termKey);
    if (list) list.push(plan); else byTerm.set(termKey, [plan]);
  }
  const metas: Record<TermKey, TermMeta> = { ...terms };
  for (const [key, list] of byTerm) {
    if (!metas[key]) metas[key] = { term: list[0]!.plan.term, activeId: list[0]!.id, planOrder: [] };
  }

  const out: Record<TermKey, TermWorkspace> = {};
  for (const [key, meta] of Object.entries(metas)) {
    const mine = byTerm.get(key) ?? [];
    const byId = new Map(mine.map((p) => [p.id, p]));
    const ordered: NamedPlan[] = [];
    for (const id of meta.planOrder) {
      const p = byId.get(id);
      if (p) { ordered.push(p); byId.delete(id); }
    }
    ordered.push(...byId.values());
    if (ordered.length === 0) continue;
    const activeId = ordered.some((p) => p.id === meta.activeId) ? meta.activeId : ordered[0]!.id;
    const ws: TermWorkspace = { term: meta.term, plans: { activeId, plans: ordered } };
    for (const k of BOOKED_KEYS) if (meta[k] !== undefined) ws[k] = meta[k];
    out[key] = ws;
  }
  if (Object.keys(out).length === 0) return null;
  const state: TermsState = { version: 1, activeTermKey: Object.keys(out)[0]!, terms: out };
  return { ...state, activeTermKey: newestTermKey(state) };
}

