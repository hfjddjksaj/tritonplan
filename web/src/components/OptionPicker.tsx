import { Fragment } from 'react';
import type { CourseOffering } from '@triton/shared';
import { findOption, optionSummaryParts } from '../lib/plan';
import { pluralize } from '../lib/format';
import { optionFull, optionWaitlistOnly } from '../lib/seats';
import { ChevronDown, WarnTriangle } from './icons';
import { tip } from './Tooltip';

/** Said the same way in both places the mark appears — open seats are the part
 *  that needs explaining, since the number beside it reads as "go enroll". */
export function waitlistOnlyTitle(seatsAvailable?: number): string {
  return seatsAvailable !== undefined && seatsAvailable > 0
    ? `${seatsAvailable} seats are open, but TSS will only let you join this section's waitlist.`
    : "TSS will only let you join this section's waitlist.";
}

/** What TSS's own UI calls it: "Waitlist Only". Words only — the expanded list
 *  has room for them, and a triangle in front of a label that already reads at a
 *  glance only adds a second thing to look at. The road sign is kept for the
 *  collapsed row, where there is no room for words at all. */
function WaitlistOnlyChip({ seatsAvailable }: { seatsAvailable?: number }) {
  return (
    <span className="opt__wl" {...tip(waitlistOnlyTitle(seatsAvailable))}>
      Waitlist only
    </span>
  );
}

/** Folded away there is no room for the words — the road sign says the same
 *  thing in 13px, in the shape everyone already reads. The 13 is repeated in
 *  `.picker__wl`'s vertical-align, which drops the mark onto the code's cap
 *  band; change one and the other stops holding the line. */
function WaitlistOnlyMark({ seatsAvailable }: { seatsAvailable?: number }) {
  return (
    <span
      className="picker__wl"
      role="img"
      aria-label="Waitlist only"
      {...tip(waitlistOnlyTitle(seatsAvailable))}
    >
      <WarnTriangle size={13} />
    </span>
  );
}

interface Props {
  course: CourseOffering;
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
  /** Received (shared/imported) plan: options are visible but not switchable. */
  readOnly?: boolean;
  /** User has confirmed enrollment — supersedes the collapsed-row "full" greying. */
  booked?: boolean;
  /** Collapsed: only the toggle row shows (with the selected section's code). */
  collapsed: boolean;
  onToggle: () => void;
}

export function OptionPicker({ course, selectedOptionId, onSelect, readOnly = false, booked, collapsed, onToggle }: Props) {
  if (course.options.length === 0) return null;
  const selected = findOption(course, selectedOptionId);
  // With the list collapsed, this code is the only trace of the chosen section —
  // grey it too, or a full pick shows up nowhere but the calendar. Not when booked,
  // though: a 0-seat count doesn't apply to a section the user already has.
  const selectedFull = !booked && (selected ? optionFull(selected) : false);
  // Suppressed once booked for the same reason as the seat count above: the gate
  // is behind a student TSS already let in. The expanded list still marks every
  // waitlist-only package, because that list is for choosing a different one.
  const selectedWaitlistOnly = !booked && (selected ? optionWaitlistOnly(selected) : false);
  const hasSeats = course.options.some((o) => o.seatsAvailable !== undefined);
  const optionCount = course.options.length;
  return (
    <div className="picker">
      <button
        type="button"
        className="picker__toggle"
        onClick={onToggle}
        aria-expanded={!collapsed}
        {...tip(collapsed ? 'Show all sections' : 'Hide sections')}
      >
        <span className="eyebrow picker__label">Section</span>
        <ChevronDown
          size={14}
          strokeWidth={2.2}
          className={`picker__chev${collapsed ? '' : ' picker__chev--open'}`}
        />
        <span className="picker__sub">
          <span className="eyebrow picker__count">
            {optionCount} {pluralize(optionCount, 'option')}
          </span>
          {collapsed && selected && (
            <span className={`picker__selected mono${selectedFull ? ' picker__selected--full' : ''}`}>
              {selected.code}
              {selectedWaitlistOnly && <WaitlistOnlyMark seatsAvailable={selected.seatsAvailable} />}
            </span>
          )}
        </span>
      </button>
      {collapsed ? null : (
      <div className="picker__list" role="radiogroup" aria-label={`${course.courseCode} section`}>
        {course.options.map((opt) => {
          const active = opt.id === selectedOptionId;
          const seatsFull = optionFull(opt);
          const waitlistOnly = optionWaitlistOnly(opt);
          const instructor = opt.components.find((c) => c.instructors[0])?.instructors[0];
          const parts = optionSummaryParts(opt);
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-disabled={readOnly}
              className={`opt${active ? ' opt--active' : ''}${waitlistOnly ? ' opt--wl' : ''}${seatsFull ? ' opt--full' : ''}${readOnly ? ' opt--readonly' : ''}`}
              onClick={readOnly ? undefined : () => onSelect(opt.id)}
              {...tip(readOnly && 'Read-only plan — sections can’t be changed')}
            >
              <span className="opt__radio" aria-hidden />
              <span className="opt__main">
                {/* The code can ellipsize; the chip beside it never does — a mark
                    that disappears on a long package code is worse than no mark. */}
                <span className="opt__codeline">
                  <span className="opt__code mono">{opt.code}</span>
                  {waitlistOnly && <WaitlistOnlyChip seatsAvailable={opt.seatsAvailable} />}
                </span>
                {instructor && <span className="opt__instructor">{instructor}</span>}
                <span className="opt__summary">
                  {parts.length === 0
                    ? 'TBA / no set time'
                    : parts.map((p, i) => (
                        <Fragment key={p.type + p.time + i}>
                          {i > 0 && <span className="opt__summary-dot"> · </span>}
                          <span className="opt__summary-part">
                            {p.type && <span className="opt__summary-kind">{p.type}</span>}
                            {p.time}
                          </span>
                        </Fragment>
                      ))}
                </span>
              </span>
              {opt.seatsAvailable !== undefined && (
                <span className="opt__seats">
                  <span className={`opt__seats-n mono${seatsFull ? ' opt__seats-n--full' : ''}`}>
                    {opt.seatsAvailable}
                    {opt.limit !== undefined ? `/${opt.limit}` : ''}
                  </span>
                  {/* Always "seats". The number above it counts seats in every
                      row — swapping the word underneath on the full ones relabels
                      a measurement that never changed, and made the reader stop to
                      work out what `0/45` was counting. The count going red already
                      says there is nothing left; what TSS will let you do about it
                      is the Waitlist-only chip's job, up beside the code. */}
                  <span className="opt__seats-label">seats</span>
                </span>
              )}
            </button>
          );
        })}
        {hasSeats && !readOnly && (
          <p className="picker__note">
            Note: seat counts don’t refresh on their own. Use “open in TSS” above and browse the
            course again to refresh them.
          </p>
        )}
      </div>
      )}
    </div>
  );
}
