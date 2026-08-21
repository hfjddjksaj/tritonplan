import { useEffect, useRef, useState } from 'react';
import type { PlanEntry } from '@triton/shared';
import { colorsForHue, hueFromEntryColor } from '../lib/colors';
import { relativeTime } from '../lib/format';
import { courseFull } from '../lib/seats';
import { OptionPicker } from './OptionPicker';
import { PrereqPopover } from './PrereqPopover';
import { BookedSectionPopover } from './BookedSectionPopover';
import { Trash, External, Bang } from './icons';
import { tip } from './Tooltip';

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
  /** TSS itself reported this course as booked, whatever the student marked here.
   *  Only used to surface the disagreement; `booked` alone decides how the card reads. */
  bookedByTss?: boolean;
  /** Code of the package TSS says was booked, when it is NOT the one selected here
   *  (e.g. "P-002-004"). Absent whenever they agree or nothing is certain. */
  bookedOptionCode?: string;
  onToggleBooked?: () => void;
}

export function CourseCard({ entry, index, conflicted, readOnly = false, focusNonce, onSelect, onRemove, onOpenTss, onBook, booked, bookedByTss = false, bookedOptionCode, onToggleBooked }: Props) {
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
  const [alertOpen, setAlertOpen] = useState(false);
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
              <span className="tag tag--booked" {...tip('You are enrolled in this course')}>
                Booked
              </span>
            ) : (
              full && (
                <span className="tag tag--full" {...tip('Every section of this course is full')}>
                  Full
                </span>
              )
            )}
            {/* TSS has you in a DIFFERENT package than the one on the grid. Its own
                mark, beside Booked rather than inside it: a caveat crammed into
                another badge reads as decoration on that badge, and at 13px it read
                as a smudge. It opens the explanation rather than only hovering it —
                one character can't carry the sentence, and a tooltip is mouse-only.
                Nothing here switches the section: that stays the student's own click. */}
            {booked && bookedOptionCode && (
              <button
                type="button"
                className="tag tag--alert"
                onClick={() => setAlertOpen(true)}
                aria-label={`Booked section differs: TSS has ${bookedOptionCode}`}
                {...tip(`TSS has you in ${bookedOptionCode}, not the section on this plan. Click for details.`)}
              >
                <Bang size={11} />
              </button>
            )}
          </div>
          <div className="course-card__title">{course.title}</div>
          {/* Facts about the course, not controls — units used to sit in the button row
              and read as a fifth thing to click. Conflict stays down here with it rather
              than up on the code line, where a third badge wrapped and shoved the title. */}
          {(course.units !== undefined || conflicted) && (
            <div className="course-card__facts">
              {course.units !== undefined && (
                <span className="tag tag--units mono">{course.units} units</span>
              )}
              {conflicted && <span className="tag tag--conflict">Conflict</span>}
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
              {...tip(`Remove ${course.courseCode}`)}
            >
              <Trash size={15} />
            </button>
          )}
          {freshness && (
            <span
              className="course-card__fresh"
              {...tip(`Seat counts are from when this course was last browsed in TSS (${new Date(course.capturedAt!).toLocaleString()}). Open it in TSS to refresh them.`)}
            >
              seats {freshness}
            </span>
          )}
        </div>
      </div>
      {/* Two rows of two, each row its own flex line. Written as rows rather than a
          two-column grid so the pair always sits shoulder to shoulder: a grid column
          is as wide as the widest button in it, which left a hole beside the short
          ones. Leaving TSS is the top row, working on the plan is the bottom. */}
      <div className="course-card__actions">
        <div className="course-card__actionrow">
          <button
            type="button"
            className="course-card__tss"
            onClick={onOpenTss}
            {...tip(`Open ${course.courseCode} in TSS`)}
          >
            open in TSS <External size={11} strokeWidth={2.2} />
          </button>
          {onBook && (
            <button
              type="button"
              className="course-card__tss"
              onClick={onBook}
              {...tip(`Go to booking for the selected ${course.courseCode} section`)}
            >
              book section <External size={11} strokeWidth={2.2} />
            </button>
          )}
        </div>
        <div className="course-card__actionrow">
          <button
            type="button"
            className="course-card__tss"
            onClick={() => setPrereqsOpen(true)}
            {...tip(`Enrollment requirements for ${course.courseCode}`)}
          >
            prerequisites
          </button>
          {/* Manual marking exists for courses TSS has not spoken about. Once it
              reports one, there is nothing here to decide — enrolment is its fact, not
              a preference — and the toggle only offered a way to contradict it that no
              enrolled student wants. One student unmarked all three of theirs and spent
              days wondering why the badges were dark (2026-08-19). */}
          {onToggleBooked && !bookedByTss && (
            <button
              type="button"
              className="course-card__tss"
              onClick={onToggleBooked}
              {...tip(
                booked
                  ? `Unmark ${course.courseCode} as booked`
                  : `Mark ${course.courseCode} as booked — you enrolled, so a 0-seat count doesn't apply to you`,
              )}
            >
              {booked ? 'unmark' : 'mark booked'}
            </button>
          )}
        </div>
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
      {alertOpen && bookedOptionCode && (
        <BookedSectionPopover
          courseCode={course.courseCode}
          booked={bookedOptionCode}
          selected={course.options.find((o) => o.id === entry.selectedOptionId)?.code}
          accent={{ text: c.text, spine: c.spine }}
          onShowSections={() => {
            setAlertOpen(false);
            setSectionsOpen(true);
          }}
          onClose={() => setAlertOpen(false)}
        />
      )}
    </section>
  );
}
