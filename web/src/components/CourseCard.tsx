import { useEffect, useRef, useState } from 'react';
import type { PlanEntry } from '@triton/shared';
import { colorsForHue, hueFromEntryColor } from '../lib/colors';
import { relativeTime } from '../lib/format';
import { OptionPicker } from './OptionPicker';
import { PrereqPopover } from './PrereqPopover';
import { Trash, External } from './icons';

interface Props {
  entry: PlanEntry;
  index: number;
  conflicted: boolean;
  /** Received (shared/imported) plan: no removing, no section switching. */
  readOnly?: boolean;
  /** Bumped when this course's calendar block is clicked — expand sections and scroll here. */
  focusNonce?: number | undefined;
  onSelect: (optionId: string) => void;
  onRemove: () => void;
  onOpenTss: () => void;
  /** Open the selected section's booking page; absent when no link can be built. */
  onBook?: () => void;
}

export function CourseCard({ entry, index, conflicted, readOnly = false, focusNonce, onSelect, onRemove, onOpenTss, onBook }: Props) {
  const hue = hueFromEntryColor(entry.color, index);
  const c = colorsForHue(hue);
  const { course } = entry;
  // Section list starts tucked away — long option lists otherwise dominate the rail.
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const [prereqsOpen, setPrereqsOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  // Re-render once a minute so the "seats Xm ago" staleness label keeps aging
  // while the tab sits open.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!course.capturedAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [course.capturedAt]);
  const freshness = course.capturedAt ? relativeTime(course.capturedAt) : '';

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
            {(course.prereqs?.length ?? 0) > 0 && (
              <button
                type="button"
                className="course-card__tss"
                onClick={() => setPrereqsOpen(true)}
                title={`Enrollment requirements for ${course.courseCode}`}
              >
                prerequisites
              </button>
            )}
          </div>
        </div>
        <div className="course-card__side">
          {!readOnly && (
            <button
              type="button"
              className="course-card__remove"
              onClick={onRemove}
              aria-label={`Remove ${course.courseCode}`}
              title={`Remove ${course.courseCode}`}
            >
              <Trash size={15} />
            </button>
          )}
          {freshness && (
            <span
              className="course-card__fresh"
              title={`Seat counts are from when this course was last browsed in TSS (${new Date(course.capturedAt!).toLocaleString()}). Open it in TSS to refresh them.`}
            >
              seats {freshness}
            </span>
          )}
        </div>
      </div>
      <OptionPicker
        course={course}
        selectedOptionId={entry.selectedOptionId}
        onSelect={onSelect}
        readOnly={readOnly}
        collapsed={!sectionsOpen}
        onToggle={() => setSectionsOpen((v) => !v)}
      />
      {prereqsOpen && (
        <PrereqPopover
          course={course}
          accent={{ text: c.text, spine: c.spine }}
          onClose={() => setPrereqsOpen(false)}
        />
      )}
    </section>
  );
}
