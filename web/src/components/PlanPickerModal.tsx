/** "+ TritonPlan" landed in a term that has several plans — ask which one.
 *  Shown by PlannerBody when ctl.pendingAdd is non-null; queued adds surface one at a time.
 *  The same question as Share's first step, so the same list. */
import type { CourseOffering } from '@triton/shared';
import { displayTermLabel } from '../lib/terms';
import { Dialog } from './Dialog';
import { PlanList } from './PlanList';

interface Props {
  course: CourseOffering;
  plans: { id: string; name: string; count: number }[];
  onPick: (planId: string) => void;
  onCancel: () => void;
}

export function PlanPickerModal({ course, plans, onPick, onCancel }: Props) {
  return (
    <Dialog
      label={`Add ${course.courseCode} to a plan`}
      onClose={onCancel}
      eyebrow="Add to a plan"
      title={course.courseCode}
      meta={`${displayTermLabel(course.term)} has several plans. Pick one:`}
    >
      <PlanList plans={plans} onPick={(p) => onPick(p.id)} />
      <div className="mappop__actions">
        <button type="button" className="btn btn--sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
