import { Fragment, useEffect, useState } from 'react';
import type { CourseOffering } from '@triton/shared';
import { optionSummaryParts } from '../lib/plan';
import { relativeTime } from '../lib/format';
import { ChevronDown } from './icons';

interface Props {
  course: CourseOffering;
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
  /** Collapsed: only the toggle row shows (with the selected section's code). */
  collapsed: boolean;
  onToggle: () => void;
}

export function OptionPicker({ course, selectedOptionId, onSelect, collapsed, onToggle }: Props) {
  // Re-render once a minute so the "seats Xm ago" staleness label keeps aging
  // while the tab sits open. (Hook order: before any early return.)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!course.capturedAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [course.capturedAt]);

  if (course.options.length === 0) return null;
  const selected = course.options.find((o) => o.id === selectedOptionId);
  const freshness = course.capturedAt ? relativeTime(course.capturedAt) : '';
  const hasSeats = course.options.some((o) => o.seatsAvailable !== undefined);
  return (
    <div className="picker">
      <button
        type="button"
        className="picker__toggle"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={collapsed ? 'Show all sections' : 'Hide sections'}
      >
        <span className="eyebrow picker__label">
          Section {course.options.length > 1 ? `· ${course.options.length} options` : ''}
        </span>
        {freshness && (
          <span
            className="picker__fresh"
            title={`Seat counts are from when this course was last browsed in TSS (${new Date(course.capturedAt!).toLocaleString()}). Open it in TSS to refresh them.`}
          >
            seats {freshness}
          </span>
        )}
        {collapsed && selected && <span className="picker__selected mono">{selected.code}</span>}
        <ChevronDown
          size={14}
          strokeWidth={2.2}
          className={`picker__chev${collapsed ? '' : ' picker__chev--open'}`}
        />
      </button>
      {collapsed ? null : (
      <div className="picker__list" role="radiogroup" aria-label={`${course.courseCode} section`}>
        {course.options.map((opt) => {
          const active = opt.id === selectedOptionId;
          const seatsFull = opt.seatsAvailable !== undefined && opt.seatsAvailable <= 0;
          const instructor = opt.components.find((c) => c.instructors[0])?.instructors[0];
          const parts = optionSummaryParts(opt);
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`opt${active ? ' opt--active' : ''}`}
              onClick={() => onSelect(opt.id)}
            >
              <span className="opt__radio" aria-hidden />
              <span className="opt__main">
                <span className="opt__code mono">{opt.code}</span>
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
                  <span className="opt__seats-label">{seatsFull ? 'waitlist' : 'seats'}</span>
                </span>
              )}
            </button>
          );
        })}
        {hasSeats && (
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
