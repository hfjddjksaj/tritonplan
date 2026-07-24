import { Fragment } from 'react';
import type { CourseOffering } from '@triton/shared';
import { findOption, optionSummaryParts } from '../lib/plan';
import { ChevronDown } from './icons';

interface Props {
  course: CourseOffering;
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
  /** Received (shared/imported) plan: options are visible but not switchable. */
  readOnly?: boolean;
  /** Collapsed: only the toggle row shows (with the selected section's code). */
  collapsed: boolean;
  onToggle: () => void;
}

export function OptionPicker({ course, selectedOptionId, onSelect, readOnly = false, collapsed, onToggle }: Props) {
  if (course.options.length === 0) return null;
  const selected = findOption(course, selectedOptionId);
  const hasSeats = course.options.some((o) => o.seatsAvailable !== undefined);
  const showSub = course.options.length > 1 || (collapsed && selected);
  return (
    <div className="picker">
      <button
        type="button"
        className="picker__toggle"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={collapsed ? 'Show all sections' : 'Hide sections'}
      >
        <span className="eyebrow picker__label">Section</span>
        <ChevronDown
          size={14}
          strokeWidth={2.2}
          className={`picker__chev${collapsed ? '' : ' picker__chev--open'}`}
        />
        {showSub && (
          <span className="picker__sub">
            {course.options.length > 1 && (
              <span className="eyebrow picker__count">{course.options.length} options</span>
            )}
            {collapsed && selected && <span className="picker__selected mono">{selected.code}</span>}
          </span>
        )}
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
              aria-disabled={readOnly}
              className={`opt${active ? ' opt--active' : ''}${readOnly ? ' opt--readonly' : ''}`}
              onClick={readOnly ? undefined : () => onSelect(opt.id)}
              title={readOnly ? 'Read-only — save this plan as yours to switch sections' : undefined}
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
