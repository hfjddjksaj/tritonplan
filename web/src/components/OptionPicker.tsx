import type { CourseOffering } from '@triton/shared';
import { optionSummary } from '../lib/plan';

interface Props {
  course: CourseOffering;
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
}

export function OptionPicker({ course, selectedOptionId, onSelect }: Props) {
  if (course.options.length === 0) return null;
  return (
    <div className="picker">
      <div className="eyebrow picker__label">
        Section {course.options.length > 1 ? `· ${course.options.length} options` : ''}
      </div>
      <div className="picker__list" role="radiogroup" aria-label={`${course.courseCode} section`}>
        {course.options.map((opt) => {
          const active = opt.id === selectedOptionId;
          const seatsFull = opt.seatsAvailable !== undefined && opt.seatsAvailable <= 0;
          const instructor = opt.components.find((c) => c.instructors[0])?.instructors[0];
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
                <span className="opt__summary">
                  {instructor ? `${instructor} · ` : ''}
                  {optionSummary(opt)}
                </span>
              </span>
              {opt.seatsAvailable !== undefined && (
                <span className="opt__seats">
                  <span className={`opt__seats-n mono${seatsFull ? ' opt__seats-n--full' : ''}`}>
                    {opt.seatsAvailable}
                    {opt.limit !== undefined ? `/${opt.limit}` : ''}
                  </span>
                  <br />
                  <span className="opt__seats-label">{seatsFull ? 'waitlist' : 'seats'}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
