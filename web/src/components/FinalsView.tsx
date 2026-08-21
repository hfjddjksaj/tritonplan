import { courseIdsInConflicts, examDisplay, formatDisplay, type FinalConflict } from '@triton/shared';
import { colorsForHue } from '../lib/colors';
import { dateParts } from '../lib/format';
import type { FinalItem } from '../lib/plan';
import { FinalsCalendar } from './FinalsCalendar';
import { Warning, Calendar } from './icons';
import type { PositionedBlock } from '../lib/layout';
import { tip } from './Tooltip';

interface Props {
  finals: FinalItem[];
  conflicts: FinalConflict[];
  onOpenCourse: (courseId: string) => void;
  onFocusCourse?: (courseId: string) => void;
  /** Show where this exam's building is; when absent the location stays plain text. */
  onOpenLocation?: (loc: { building: string; room?: string }) => void;
  /** When set, calendar blocks become a single tap target opening a detail sheet (mobile). */
  onBlockDetail?: (block: PositionedBlock) => void;
  /** Forwarded to the finals-week calendar (mobile fit/scroll variants). */
  variant?: 'desktop' | 'fit' | 'scroll';
}

export function FinalsView({
  finals,
  conflicts,
  onOpenCourse,
  onFocusCourse,
  onOpenLocation,
  onBlockDetail,
  variant,
}: Props) {
  const conflicted = courseIdsInConflicts(conflicts);

  if (finals.length === 0) {
    return (
      <div className="empty" style={{ height: '60vh' }}>
        <Calendar size={40} className="empty__mark" strokeWidth={1.4} />
        <div className="empty__title">No finals to show yet</div>
        <p className="empty__text">
          Once you pick sections that carry a final exam, they’ll line up here in date order so
          you can spot back-to-back or overlapping finals.
        </p>
      </div>
    );
  }

  return (
    <div className="finals">
      <p className="finals__intro">
        Final exams for your selected sections, earliest first. Overlapping finals on the same
        day are flagged — those are the ones you can’t sit for at once.
      </p>
      <div className="finals__timeline">
        {finals.map((f) => {
          const c = colorsForHue(f.hue);
          const dp = dateParts(f.final.date);
          const isConflict = conflicted.has(f.courseId);
          const loc = examDisplay(f.final);
          return (
            <div
              key={f.courseId}
              className={`final-row${isConflict ? ' final-row--conflict' : ''}`}
              style={{ ['--c-spine' as string]: c.spine, ['--c-text' as string]: c.text }}
            >
              <div className="final-row__date">
                <div className="final-row__dow">{dp.dow}</div>
                <div className="final-row__day">{dp.day}</div>
                <div className="final-row__month">{dp.month}</div>
              </div>
              <div className="final-row__main">
                <div className="final-row__code">{f.courseCode}</div>
                <div className="final-row__title">{f.title}</div>
                {isConflict && (
                  <div className="final-row__flag">
                    <Warning size={13} /> Overlaps another final
                  </div>
                )}
              </div>
              <div className="final-row__time">
                <div className="final-row__time-range">
                  {formatDisplay(f.final.start)} – {formatDisplay(f.final.end)}
                </div>
                {loc.modality && (
                  <div className="opt__seats-label">{loc.modality}{loc.location ? ' @' : ''}</div>
                )}
                {loc.location &&
                  (loc.building && onOpenLocation ? (
                    <button
                      type="button"
                      className="final-row__loc"
                      onClick={() => onOpenLocation({ building: loc.building!, room: loc.room })}
                      {...tip(`Where is ${loc.building}?`)}
                    >
                      {loc.location}
                    </button>
                  ) : (
                    <div className="final-row__loc final-row__loc--plain">{loc.location}</div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="eyebrow fincal__title">Finals week at a glance</div>
      <FinalsCalendar
        finals={finals}
        onOpenCourse={onOpenCourse}
        onFocusCourse={onFocusCourse}
        onOpenLocation={
          onOpenLocation
            ? (b) => {
                if (b.building) onOpenLocation({ building: b.building, room: b.room });
              }
            : undefined
        }
        onBlockDetail={onBlockDetail}
        variant={variant}
      />
    </div>
  );
}
