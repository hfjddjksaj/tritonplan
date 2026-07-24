import { useMemo } from 'react';
import { formatDisplay } from '@triton/shared';
import {
  FINALS_GRID,
  gridHeightPx,
  hourMarks,
  hourMarkTop,
  isoWeekday,
  layoutFinalsWeek,
  type FinalInstance,
} from '../lib/layout';
import { dateParts } from '../lib/format';
import type { FinalItem } from '../lib/plan';
import { CourseBlock } from './CourseBlock';

interface Props {
  finals: FinalItem[];
  onOpenCourse: (courseId: string) => void;
  onFocusCourse?: (courseId: string) => void;
}

/**
 * Week-style calendar of finals: one column per date from the earliest to the
 * latest exam (weekends included — finals do land on Sat/Sun).
 */
export function FinalsCalendar({ finals, onOpenCourse, onFocusCourse }: Props) {
  const cfg = FINALS_GRID;
  const { dates, byDate } = useMemo(() => {
    const items: FinalInstance[] = finals.map((f) => ({
      courseId: f.courseId,
      courseCode: f.courseCode,
      hue: f.hue,
      date: f.final.date,
      start: f.final.start,
      end: f.final.end,
      modality: f.final.modality,
    }));
    return layoutFinalsWeek(items, cfg);
  }, [finals, cfg]);
  const marks = useMemo(() => hourMarks(cfg), [cfg]);
  const height = gridHeightPx(cfg);

  if (dates.length === 0) return null;

  const colTemplate = `repeat(${dates.length}, 1fr)`;

  return (
    <section className="fincal" aria-label="Finals week calendar">
      <div className="cal-head">
        <div className="cal-head__corner" />
        <div className="cal-head__days" style={{ gridTemplateColumns: colTemplate }}>
          {dates.map((date) => {
            const dp = dateParts(date);
            const wd = isoWeekday(date);
            const weekend = wd === 'Sat' || wd === 'Sun';
            return (
              <div key={date} className={`cal-head__day${weekend ? ' cal-head__day--dim' : ''}`}>
                <span className="cal-head__dow">{dp.dow}</span>
                <span className="cal-head__date">
                  {dp.month} {dp.day}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="cal-grid" style={{ height: 'auto' }}>
        <div className="cal-gutter" style={{ height }}>
          {marks.map((h) => (
            <div
              key={h}
              className="cal-gutter__hour"
              style={{ top: hourMarkTop(h, cfg) }}
            >
              {formatDisplay(`${String(h).padStart(2, '0')}:00`)}
            </div>
          ))}
        </div>

        <div className="cal-canvas" style={{ height }}>
          <div className="cal-cols" style={{ gridTemplateColumns: colTemplate }}>
            {dates.map((date) => {
              const wd = isoWeekday(date);
              return (
                <div
                  key={date}
                  className={`cal-col${wd === 'Sat' || wd === 'Sun' ? ' cal-col--weekend' : ''}`}
                />
              );
            })}
          </div>

          <div className="cal-hlines">
            {marks.map((h) => (
              <div
                key={h}
                className="cal-hline"
                style={{ top: hourMarkTop(h, cfg) }}
              />
            ))}
          </div>

          <div className="cal-cols" style={{ gridTemplateColumns: colTemplate }}>
            {dates.map((date) => (
              <div key={date} className="cal-col" style={{ position: 'relative' }}>
                {byDate[date]?.map((block) => (
                  <CourseBlock
                    key={block.key}
                    block={block}
                    onOpen={onOpenCourse}
                    onFocusCourse={onFocusCourse}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
