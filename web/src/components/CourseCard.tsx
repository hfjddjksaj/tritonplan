import { useState } from 'react';
import type { PlanEntry } from '@triton/shared';
import { colorsForHue, hueFromEntryColor } from '../lib/colors';
import { OptionPicker } from './OptionPicker';
import { Trash, External } from './icons';

interface Props {
  entry: PlanEntry;
  index: number;
  conflicted: boolean;
  onSelect: (optionId: string) => void;
  onRemove: () => void;
  onOpenTss: () => void;
  /** Open the selected section's booking page; absent when no link can be built. */
  onBook?: () => void;
}

export function CourseCard({ entry, index, conflicted, onSelect, onRemove, onOpenTss, onBook }: Props) {
  const hue = hueFromEntryColor(entry.color, index);
  const c = colorsForHue(hue);
  const { course } = entry;
  // Section list starts tucked away — long option lists otherwise dominate the rail.
  const [sectionsOpen, setSectionsOpen] = useState(false);

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
              onClick={onOpenTss}
              title={`Open ${course.courseCode} in TSS`}
            >
              open in TSS <External size={11} strokeWidth={2.2} />
            </button>
            {onBook && (
              <button
                type="button"
                className="course-card__tss"
                onClick={onBook}
                title={`Go to booking for the selected ${course.courseCode} section`}
              >
                book section <External size={11} strokeWidth={2.2} />
              </button>
            )}
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
        collapsed={!sectionsOpen}
        onToggle={() => setSectionsOpen((v) => !v)}
      />
    </section>
  );
}
