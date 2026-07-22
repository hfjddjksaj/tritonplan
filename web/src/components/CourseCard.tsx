import type { PlanEntry } from '@triton/shared';
import { colorsForHue, hueFromEntryColor } from '../lib/colors';
import { openInTss } from '../lib/tss';
import { OptionPicker } from './OptionPicker';
import { Trash, External } from './icons';

interface Props {
  entry: PlanEntry;
  index: number;
  conflicted: boolean;
  onSelect: (optionId: string) => void;
  onRemove: () => void;
}

export function CourseCard({ entry, index, conflicted, onSelect, onRemove }: Props) {
  const hue = hueFromEntryColor(entry.color, index);
  const c = colorsForHue(hue);
  const { course } = entry;

  return (
    <section
      className={`course-card${conflicted ? ' course-card--conflict' : ''}`}
      style={{
        ['--c-spine' as string]: c.spine,
        ['--c-border' as string]: c.border,
        ['--c-text' as string]: c.text,
      }}
    >
      <div className="course-card__head">
        <div className="course-card__head-main">
          <div className="course-card__code">{course.courseCode}</div>
          <div className="course-card__title">{course.title}</div>
          <div className="course-card__meta">
            {course.units !== undefined && (
              <span className="tag tag--units">{course.units} units</span>
            )}
            {conflicted && <span className="tag tag--conflict">Conflict</span>}
            <button
              type="button"
              className="course-card__tss"
              onClick={() => openInTss(course)}
              title={`Open ${course.courseCode} in TSS`}
            >
              open in TSS <External size={11} strokeWidth={2.2} />
            </button>
          </div>
        </div>
        <button
          type="button"
          className="course-card__remove"
          onClick={onRemove}
          aria-label={`Remove ${course.courseCode}`}
          title={`Remove ${course.courseCode}`}
        >
          <Trash size={15} />
        </button>
      </div>
      <OptionPicker
        course={course}
        selectedOptionId={entry.selectedOptionId}
        onSelect={onSelect}
      />
    </section>
  );
}
