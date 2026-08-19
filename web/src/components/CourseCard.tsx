import { useEffect, useRef, useState } from 'react';
import type { PlanEntry } from '@triton/shared';
import { colorsForHue, hueFromEntryColor } from '../lib/colors';
import { relativeTime } from '../lib/format';
import { courseFull } from '../lib/seats';
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
  /** User has confirmed enrollment — supersedes the "Full" seat-count treatment. */
  booked: boolean;
  onToggleBooked?: () => void;
}

export function CourseCard({ entry, index, conflicted, readOnly = false, focusNonce, onSelect, onRemove, onOpenTss, onBook, booked, onToggleBooked }: Props) {
  const hue = hueFromEntryColor(entry.color, index);
  const c = colorsForHue(hue);
  const { course } = entry;
  // Every section is taken. Says so next to the code, where the eye lands first —
  // unless the user is booked, in which case a 0-seat count doesn't apply to them.
  const full = !booked && courseFull(course);
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
      className={`course-card${conflicted ? ' course-card--conflict' : ''}${full ? ' course-card--full' : ''}${flash ? ' course-card--flash' : ''}`}
      style={{
        ['--c-spine' as string]: c.spine,
        ['--c-border' as string]: c.border,
        ['--c-text' as string]: c.text,
      }}
    >
      <div className="course-card__head">
        <div className="course-card__head-main">
          {/* Line 1 is identity + status: code, then every badge that describes
              this course's standing. Nothing actionable lives here. */}
          <div className="course-card__codeline">
            <span className="course-card__code">{course.courseCode}</span>
            {booked ? (
              <span className="tag tag--booked" title="You are enrolled in this course">
                Booked
              </span>
            ) : (
              full && (
                <span className="tag tag--full" title="Every section of this course is full">
                  Full
                </span>
              )
            )}
            {conflicted && <span className="tag tag--conflict">Conflict</span>}
          </div>
          <div className="course-card__title">{course.title}</div>
          {/* Facts about the course, not controls — units sat in the button row
              before and read as a fifth thing to click. */}
          {(course.units !== undefined || freshness) && (
            <div className="course-card__facts mono">
              {course.units !== undefined && <span>{course.units} units</span>}
              {course.units !== undefined && freshness && (
                <span className="course-card__dot" aria-hidden="true">
                  ·
                </span>
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
          )}
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
        </div>
      </div>
      {/* Two-by-two: each button fills its cell, so none can ever be pushed past
          the card edge the way a single wrapping row did. */}
      <div className="course-card__actions">
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
        <button
          type="button"
          className="course-card__tss"
          onClick={() => setPrereqsOpen(true)}
          title={`Enrollment requirements for ${course.courseCode}`}
        >
          prerequisites
        </button>
        {onToggleBooked && (
          <button
            type="button"
            className="course-card__tss"
            onClick={onToggleBooked}
            title={
              booked
                ? `Unmark ${course.courseCode} as booked`
                : `Mark ${course.courseCode} as booked — you enrolled, so a 0-seat count doesn't apply to you`
            }
          >
            {booked ? 'unmark' : 'mark booked'}
          </button>
        )}
      </div>
      <OptionPicker
        course={course}
        selectedOptionId={entry.selectedOptionId}
        onSelect={onSelect}
        readOnly={readOnly}
        booked={booked}
        collapsed={!sectionsOpen}
        onToggle={() => setSectionsOpen((v) => !v)}
      />
      {prereqsOpen && (
        <PrereqPopover
          course={course}
          accent={{ text: c.text, spine: c.spine }}
          onOpenTss={onOpenTss}
          onClose={() => setPrereqsOpen(false)}
        />
      )}
    </section>
  );
}
