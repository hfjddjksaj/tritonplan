import { useMemo, useState } from 'react';
import type { CourseOffering } from '@triton/shared';
import { lookupRmp } from '../lib/cloud/api';
import { courseInstructors, rmpSearchUrl } from '../lib/rmp';
import { External } from './icons';
import { tip } from './Tooltip';
import { RmpModal } from './RmpModal';

const NO_INSTRUCTOR = "TSS doesn't list an instructor for this course yet.";
const BLOCKED = 'Your browser blocked the new tab. Allow pop-ups for TritonPlan to open Rate My Professors.';

interface Props {
  course: CourseOffering;
  /** The section on the plan: its teachers are marked in the several-teachers dialog. */
  selectedOptionId?: string | null;
  onFlash?: ((msg: string) => void) | undefined;
}

export function RmpButton({ course, selectedOptionId = null, onFlash }: Props) {
  const instructors = useMemo(() => courseInstructors(course), [course]);
  const selectedCode = course.options.find((o) => o.id === selectedOptionId)?.code ?? null;
  const [modal, setModal] = useState(false);

  // aria-disabled rather than disabled: a disabled button swallows pointer and focus
  // events, so its tooltip — the only place the reason is written — would never show.
  if (instructors.length === 0) {
    return (
      <button
        type="button"
        className="course-card__tss course-card__tss--off"
        aria-disabled="true"
        onClick={(e) => e.preventDefault()}
        {...tip(NO_INSTRUCTOR)}
      >
        rate my professor <External size={11} strokeWidth={2.2} />
      </button>
    );
  }

  const onClick = () => {
    if (instructors.length > 1) {
      setModal(true);
      return;
    }
    const name = instructors[0]!.name;
    // The tab has to open inside the click: after an await the browser no longer counts
    // this as a user gesture and blocks it. It waits on about:blank while the lookup runs.
    const w = window.open('about:blank', '_blank');
    if (!w) {
      onFlash?.(BLOCKED);
      return;
    }
    w.opener = null; // the page we send it to must not be able to reach back into the planner
    void lookupRmp([name]).then((r) => {
      const hit = r?.[0];
      w.location.href = hit?.match?.url ?? hit?.searchUrl ?? rmpSearchUrl(name);
    });
  };

  return (
    <>
      <button
        type="button"
        className="course-card__tss"
        onClick={onClick}
        {...tip(`Ratings for ${course.courseCode} instructors on RateMyProfessors`)}
      >
        rate my professor <External size={11} strokeWidth={2.2} />
      </button>
      {modal && (
        <RmpModal
          courseCode={course.courseCode}
          instructors={instructors}
          selectedCode={selectedCode}
          onClose={() => setModal(false)}
        />
      )}
    </>
  );
}
