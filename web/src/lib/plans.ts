/**
 * Multiple named plans. The single working plan grew into a list the user can
 * switch between ("My plan", "备选方案", "朋友的plan", …) — all pure functions
 * over one PlansState so the hook stays thin and everything unit-tests.
 *
 * Invariants: `plans` is never empty, and `activeId` always points at a member.
 * Every mutator preserves them (deletePlan refuses the last plan; migratePlans
 * repairs a dangling activeId).
 */
import type { PlanState } from '@triton/shared';
import { emptyPlan } from './plan';

export interface NamedPlan {
  id: string;
  name: string;
  plan: PlanState;
  createdAt: string;
  updatedAt: string;
  /**
   * LEGACY (pre-terms migration input only): course ids the plan used to hide
   * from the shared browsed pool. Read once by `migrateToTermsState` to seed
   * `browsed` (pool − hidden + entries), then stripped. Never written again.
   */
  hidden?: string[];
  /**
   * THIS plan's own browsed-courses list (course ids referencing the pool
   * repository). Fully independent per plan AND per term: new captures land
   * only in the target term's active plan; a new plan starts empty; ×/Clear
   * touch only this plan. Replaces `hidden` (kept above for migration input).
   */
  browsed?: string[];
}

export interface PlansState {
  activeId: string;
  plans: NamedPlan[];
}

export function newPlanId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Build the working PlansState: an already-stored list wins (repairing a
 * dangling activeId), else the legacy single plan (`plan:v1`) becomes the
 * active "My plan", else a fresh empty one.
 */
export function migratePlans(
  existing: PlansState | null,
  legacy: PlanState | null,
  now: string,
): PlansState {
  if (existing && existing.plans.length > 0) {
    if (existing.plans.some((p) => p.id === existing.activeId)) return existing;
    return { ...existing, activeId: existing.plans[0]!.id };
  }
  const id = newPlanId();
  return {
    activeId: id,
    plans: [{ id, name: 'My plan', plan: legacy ?? emptyPlan(), createdAt: now, updatedAt: now }],
  };
}

export function activePlan(state: PlansState): NamedPlan {
  return state.plans.find((p) => p.id === state.activeId) ?? state.plans[0]!;
}

/** Map ONLY the active plan; returns the same state when the updater is a no-op. */
export function updateActivePlan(
  state: PlansState,
  update: (plan: PlanState) => PlanState,
  now: string,
): PlansState {
  const current = activePlan(state);
  const nextPlan = update(current.plan);
  if (nextPlan === current.plan) return state;
  return {
    ...state,
    plans: state.plans.map((p) =>
      p.id === current.id ? { ...p, plan: nextPlan, updatedAt: now } : p,
    ),
  };
}

/** Map EVERY plan (seat/prereq refreshes apply to all copies of a course). */
export function mapAllPlans(
  state: PlansState,
  update: (plan: PlanState) => PlanState,
  now: string,
): PlansState {
  let changed = false;
  const plans = state.plans.map((p) => {
    const nextPlan = update(p.plan);
    if (nextPlan === p.plan) return p;
    changed = true;
    return { ...p, plan: nextPlan, updatedAt: now };
  });
  return changed ? { ...state, plans } : state;
}

/** First "Plan N" not already taken. */
function nextDefaultName(state: PlansState): string {
  const taken = new Set(state.plans.map((p) => p.name));
  for (let n = state.plans.length + 1; ; n++) {
    const name = `Plan ${n}`;
    if (!taken.has(name)) return name;
  }
}

/** Append a fresh empty plan (term carried over from the active one) and activate it. */
export function createPlan(state: PlansState, now: string, name?: string): PlansState {
  const id = newPlanId();
  const trimmed = name?.trim();
  const entry: NamedPlan = {
    id,
    name: trimmed || nextDefaultName(state),
    plan: emptyPlan(activePlan(state).plan.term),
    createdAt: now,
    updatedAt: now,
    browsed: [],
  };
  return { activeId: id, plans: [...state.plans, entry] };
}

/** Store an incoming (received/imported) plan under the given name and activate it. */
export function addPlan(state: PlansState, plan: PlanState, name: string, now: string): PlansState {
  const id = newPlanId();
  const entry: NamedPlan = {
    id,
    name: name.trim() || nextDefaultName(state),
    plan,
    createdAt: now,
    updatedAt: now,
  };
  return { activeId: id, plans: [...state.plans, entry] };
}

export function renamePlan(state: PlansState, id: string, name: string): PlansState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  if (!state.plans.some((p) => p.id === id && p.name !== trimmed)) return state;
  return {
    ...state,
    plans: state.plans.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
  };
}

export function duplicatePlan(state: PlansState, id: string, now: string): PlansState {
  const source = state.plans.find((p) => p.id === id);
  if (!source) return state;
  const copyId = newPlanId();
  const copy: NamedPlan = {
    id: copyId,
    name: `${source.name} copy`,
    // Structured clone so edits to the copy never leak into the source.
    plan: JSON.parse(JSON.stringify(source.plan)) as PlanState,
    createdAt: now,
    updatedAt: now,
    ...(source.browsed ? { browsed: [...source.browsed] } : {}),
  };
  return { activeId: copyId, plans: [...state.plans, copy] };
}

/** Remove a plan — except the last one. Deleting the active plan falls back to the first remaining. */
export function deletePlan(state: PlansState, id: string): PlansState {
  if (state.plans.length <= 1) return state;
  const plans = state.plans.filter((p) => p.id !== id);
  if (plans.length === state.plans.length) return state;
  const activeId = state.activeId === id ? plans[0]!.id : state.activeId;
  return { activeId, plans };
}

export function switchActive(state: PlansState, id: string): PlansState {
  if (state.activeId === id || !state.plans.some((p) => p.id === id)) return state;
  return { ...state, activeId: id };
}

/** Course ids the ACTIVE plan lists as browsed. */
export function activeBrowsed(state: PlansState): ReadonlySet<string> {
  return new Set(activePlan(state).browsed ?? []);
}

/** Append ids to a SPECIFIC plan's browsed list (dedup); same state when nothing is new. */
export function addBrowsed(state: PlansState, planId: string, ids: string[], now: string): PlansState {
  if (ids.length === 0) return state;
  const target = state.plans.find((p) => p.id === planId);
  if (!target) return state;
  const before = target.browsed ?? [];
  const next = [...new Set([...before, ...ids])];
  if (next.length === before.length) return state;
  return {
    ...state,
    plans: state.plans.map((p) => (p.id === planId ? { ...p, browsed: next, updatedAt: now } : p)),
  };
}

/** Remove ids from the ACTIVE plan's browsed list; same state when nothing matched. */
export function removeBrowsed(state: PlansState, ids: string[], now: string): PlansState {
  if (ids.length === 0) return state;
  const current = activePlan(state);
  const before = current.browsed ?? [];
  const drop = new Set(ids);
  const next = before.filter((id) => !drop.has(id));
  if (next.length === before.length) return state;
  return {
    ...state,
    plans: state.plans.map((p) => (p.id === current.id ? { ...p, browsed: next, updatedAt: now } : p)),
  };
}
