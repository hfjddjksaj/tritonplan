import { useMemo, useState } from 'react';
import type { CourseOffering } from '@triton/shared';
import { courseInstructors } from '../lib/rmp';
import { External } from './icons';
import { tip } from './Tooltip';
import { RmpModal } from './RmpModal';

const NO_INSTRUCTOR = "TSS doesn't list an instructor for this course yet.";

interface Props {
  course: CourseOffering;
  /** The section on the plan: its teachers are marked in the dialog. */
  selectedOptionId?: string | null;
}

/**
 * Opens the ratings dialog, even for a course with one teacher: the stars are
 * there to compare inside the planner, and RMP is a click on a row away.
 */
export function RmpButton({ course, selectedOptionId = null }: Props) {
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

  return (
    <>
      <button
        type="button"
        className="course-card__tss"
        onClick={() => setModal(true)}
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
