/**
 * The terms the campus map can switch between, so a student planning next term
 * can look up where this term's finals are without leaving the map. Switching
 * there changes only the map: the planner stays on its own term.
 */
import type { PlanState, Term } from '@triton/shared';
import { activePlan } from './plans';
import { bookedSet } from './booked';
import { chronoIndex, isArchived, termKey, type TermKey } from './terms';
import type { TermsState } from './terms-state';

export interface MapTerm {
  key: TermKey;
  term: Term;
  /** The plan the map draws: that term's active plan (for the term on view, the planner's own). */
  plan: PlanState;
  booked: ReadonlySet<string>;
  /** Past its archive boundary: frozen, so its enrolment is not painted (as on any read-only plan). */
  archived: boolean;
}

/**
 * Every term whose active plan has a course, plus the term on view whatever it holds,
 * oldest first (unknown seasons last). The term on view is the planner's own view —
 * the plan and enrolment the map opens on — not a second reading of the workspace.
 */
export function mapTerms(
  state: TermsState,
  onView: { plan: PlanState; booked: ReadonlySet<string>; readOnly: boolean },
  now: Date,
): MapTerm[] {
  const viewKey = termKey(onView.plan.term);
  const out: MapTerm[] = [
    { key: viewKey, term: onView.plan.term, plan: onView.plan, booked: onView.booked, archived: onView.readOnly },
  ];
  for (const [key, ws] of Object.entries(state.terms)) {
    if (key === viewKey) continue;
    const plan = activePlan(ws.plans).plan;
    if (plan.entries.length === 0) continue;
    out.push({ key, term: ws.term, plan, booked: bookedSet(ws), archived: isArchived(ws.term, now) });
  }
  const order = (t: MapTerm) => chronoIndex(t.term) ?? Number.MAX_SAFE_INTEGER;
  return out.sort((a, b) => order(a) - order(b));
}
