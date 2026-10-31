/**
 * Which plan the old site would have opened on, so the migration page can draw
 * it, blurred, behind its card. Pure: reads only the payload already collected.
 * Mirrors the old site's own load: the active plan of the active term, and a
 * `#m=` bookmark selects its matching plan, or seeds a browser that has none.
 */
import type { ApptTimes, CourseOffering, PlanState, Term } from '@triton/shared';
import { bookedSet, waitlistedSet } from '../src/lib/booked';
import type { MigrationPayload } from '../src/lib/migration';
import type { NamedPlan } from '../src/lib/plans';
import { encodePlan } from '../src/lib/share';
import { allPlansEmpty, migrateToTermsState, type TermWorkspace } from '../src/lib/terms-state';

export interface BackdropView {
  plan: PlanState;
  /** The term's plans, for the switcher's label. */
  plans: NamedPlan[];
  activeId: string;
  /** Every term the browser holds, for the term chip. */
  terms: Term[];
  /** This plan's browsed courses not in it, in browsing order. */
  browsed: CourseOffering[];
  booked: ReadonlySet<string>;
  waitlisted: ReadonlySet<string>;
  appt: ApptTimes[];
}

function sameContent(a: PlanState, b: PlanState): boolean {
  try {
    return encodePlan(a, 'full') === encodePlan(b, 'full');
  } catch {
    return false;
  }
}

export function backdropView(payload: MigrationPayload, nowIso: string): BackdropView {
  const state = migrateToTermsState(payload.terms, payload.plans, payload.plan, payload.pool, nowIso);
  let ws: TermWorkspace = state.terms[state.activeTermKey]!;
  let activeId = ws.plans.activeId;

  const seed = payload.hashPlan && payload.hashPlan.entries.length > 0 ? payload.hashPlan : null;
  if (seed) {
    const match = Object.values(state.terms)
      .flatMap((w) => w.plans.plans.map((p) => [w, p] as const))
      .find(([, p]) => sameContent(p.plan, seed));
    if (match) {
      [ws] = match;
      activeId = match[1].id;
    } else if (allPlansEmpty(state)) {
      const id = 'bookmark';
      const np: NamedPlan = { id, name: 'My plan', plan: seed, createdAt: nowIso, updatedAt: nowIso };
      ws = { term: seed.term, plans: { activeId: id, plans: [np] } };
      activeId = id;
    }
  }

  const active = ws.plans.plans.find((p) => p.id === activeId) ?? ws.plans.plans[0]!;
  const added = new Set(active.plan.entries.map((e) => e.course.id));
  const byId = new Map(payload.pool.map((c) => [c.id, c]));
  const workspaces = Object.values(state.terms);
  const terms = workspaces.map((w) => w.term);
  if (!workspaces.includes(ws)) terms.push(ws.term); // the bookmark's own, seeded workspace

  return {
    plan: active.plan,
    plans: ws.plans.plans,
    activeId: active.id,
    terms,
    browsed: (active.browsed ?? [])
      .filter((id) => !added.has(id))
      .map((id) => byId.get(id))
      .filter((c): c is CourseOffering => c !== undefined),
    booked: bookedSet(ws),
    waitlisted: waitlistedSet(ws),
    appt: payload.appt ?? [],
  };
}
