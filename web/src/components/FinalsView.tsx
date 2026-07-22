import { formatDisplay, type FinalConflict } from '@triton/shared';
import { colorsForHue } from '../lib/colors';
import { dateParts } from '../lib/format';
import type { FinalItem } from '../lib/plan';
import { Warning, Calendar } from './icons';

interface Props {
  finals: FinalItem[];
  conflicts: FinalConflict[];
}

export function FinalsView({ finals, conflicts }: Props) {
  const conflicted = new Set<string>();
  for (const c of conflicts) {
    conflicted.add(c.aCourseId);
    conflicted.add(c.bCourseId);
  }

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
                {f.final.modality && (
                  <div className="opt__seats-label">{f.final.modality}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
