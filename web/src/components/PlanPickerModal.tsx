/** "+ TritonPlan" landed in a term that has several plans — ask which one.
 *  Shown by App when ctl.pendingAdd is non-null; queued adds surface one at a time.
 *
 *  Portaled to <body> like QrPopover: the topbar is a positioned ancestor, and
 *  a fixed overlay inside it would be constrained by it. */
import { createPortal } from 'react-dom';
import type { CourseOffering } from '@triton/shared';
import { displayTermLabel } from '../lib/terms';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface Props {
  course: CourseOffering;
  plans: { id: string; name: string; count: number }[];
  onPick: (planId: string) => void;
  onCancel: () => void;
}

export function PlanPickerModal({ course, plans, onPick, onCancel }: Props) {
  useEscapeKey(onCancel);

  return createPortal(
    <div className="mappop__backdrop" onClick={onCancel}>
      <div
        className="mappop planpick"
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${course.courseCode} to a plan`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="planpick__title">
          Add <span className="mono">{course.courseCode}</span> to…
        </h2>
        <p className="planpick__sub">
          {displayTermLabel(course.term)} has several plans. Pick one:
        </p>
        <div className="planpick__list">
          {plans.map((p) => (
            <button key={p.id} type="button" className="planpick__item" onClick={() => onPick(p.id)}>
              <span className="planpick__name">{p.name}</span>
              <span className="planpick__count">{p.count} courses</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--sm planpick__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}
