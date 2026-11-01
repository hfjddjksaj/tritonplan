/**
 * "Pick a plan of this term" — Share's first step and the "+ TritonPlan" picker
 * are the same question, so they are the same list: the plan menu's rows in one
 * box, a hairline between plans, the course count in mono, a chevron because a
 * click moves on.
 */
import { pluralize } from '../lib/format';
import { Check, ChevronRight } from './icons';

export interface PlanListRow {
  id: string;
  name: string;
  count: number;
}

interface Props {
  plans: PlanListRow[];
  onPick: (plan: PlanListRow) => void;
  /** A plan to tick, with the word that says why (Share ticks the one on screen). */
  mark?: { id: string; label: string };
  disabled?: boolean;
}

export function PlanList({ plans, onPick, mark, disabled }: Props) {
  return (
    <div className="plist">
      {plans.map((p) => {
        const marked = mark?.id === p.id;
        return (
          <button key={p.id} type="button" className="menu__row plist__row" disabled={disabled} onClick={() => onPick(p)}>
            {mark && (
              <span className="menu__check" aria-hidden="true">
                {marked && <Check size={13} strokeWidth={2.6} />}
              </span>
            )}
            <span className="menu__label plist__name">{p.name}</span>
            {marked && <span className="pill pill--gold">{mark.label}</span>}
            <span className="menu__count mono">
              {p.count} {pluralize(p.count, 'course')}
            </span>
            <ChevronRight size={13} className="plist__chev" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
