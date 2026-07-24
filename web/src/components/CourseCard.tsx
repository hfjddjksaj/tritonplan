import { useEffect, useRef, useState } from 'react';
import type { PlanEntry } from '@triton/shared';
import { colorsForHue, hueFromEntryColor } from '../lib/colors';
import { findOption } from '../lib/plan';
import { OptionPicker } from './OptionPicker';
import { Trash, External } from './icons';

interface Props {
  entry: PlanEntry;
  index: number;
  conflicted: boolean;
  /** Bumped when this course's calendar block is clicked — expand sections and scroll here. */
  focusNonce?: number | undefined;
  onSelect: (optionId: string) => void;
  onRemove: () => void;
  onOpenTss: () => void;
  /** Open the selected section's booking page; absent when no link can be built. */
  onBook?: () => void;
}

export function CourseCard({ entry, index, conflicted, focusNonce, onSelect, onRemove, onOpenTss, onBook }: Props) {
  const hue = hueFromEntryColor(entry.color, index);
  const c = colorsForHue(hue);
  const { course } = entry;
  // Section list starts tucked away — long option lists otherwise dominate the rail.
  const [sectionsOpen, setSectionsOpen] = useState(false);
  // Components of the chosen option that TSS lists without a meeting time
  // ("Schedule Not Defined") — shown inside this card, grayed, not clickable,
  // instead of duplicating the course in a separate "unscheduled" list.
  const selectedOption = findOption(course, entry.selectedOptionId);
  const notScheduled =
    selectedOption?.components.filter((c) => c.unscheduled || c.meetings.length === 0) ?? [];
  const [flash, setFlash] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (focusNonce === undefined) return;
    setSectionsOpen(true);
    setFlash(true);
    // Scroll after the expanded sections have been laid out.
    const raf = requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const t = setTimeout(() => setFlash(false), 1300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [focusNonce]);

  return (
    <section
      ref={rootRef}
      className={`course-card${conflicted ? ' course-card--conflict' : ''}${flash ? ' course-card--flash' : ''}`}
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
      {notScheduled.length > 0 && (
        <div className="course-card__nosched">
          {notScheduled.map((c) => (
            <div
              key={c.sectionCode}
              className="nosched-row"
              title="TSS lists this component as “Schedule Not Defined” — it has no meeting time and can’t be placed on the calendar."
            >
              <span className="nosched-row__type">{c.typeText}</span>
              <span className="nosched-row__code mono">{c.sectionCode}</span>
              <span className="nosched-row__label">not scheduled</span>
            </div>
          ))}
        </div>
      )}
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
