import { useMemo } from 'react';
import { formatDisplay, type Weekday } from '@triton/shared';
import {
  DEFAULT_GRID,
  gridHeightPx,
  hourMarks,
  layoutWeek,
  visibleDays,
  type MeetingInstance,
} from '../lib/layout';
import { todayWeekday, weekdayLong } from '../lib/format';
import { CourseBlock } from './CourseBlock';
import { Calendar } from './icons';

const DOW_LABEL: Record<Weekday, string> = {
  Mon: 'Mon',
  Tue: 'Tue',
  Wed: 'Wed',
  Thu: 'Thu',
  Fri: 'Fri',
  Sat: 'Sat',
  Sun: 'Sun',
};

interface Props {
  instances: MeetingInstance[];
  onOpenCourse: (courseId: string) => void;
}

export function CalendarGrid({ instances, onOpenCourse }: Props) {
  const cfg = DEFAULT_GRID;
  const { byDay, usedDays } = useMemo(() => layoutWeek(instances, cfg), [instances, cfg]);
  const days = useMemo(() => visibleDays(usedDays), [usedDays]);
  const marks = useMemo(() => hourMarks(cfg), [cfg]);
  const height = gridHeightPx(cfg);
  const today = todayWeekday();

  const colTemplate = `repeat(${days.length}, 1fr)`;

  if (instances.length === 0) {
    return (
      <div className="cal-wrap">
        <div className="empty">
          <Calendar size={40} className="empty__mark" strokeWidth={1.4} />
          <div className="empty__title">Your week is open</div>
          <p className="empty__text">
            Bring a course over from the left and pick a section — its meetings drop onto the
            grid here, color-coded and checked for time conflicts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cal-wrap">
      {/* sticky-ish header row */}
      <div className="cal-head">
        <div className="cal-head__corner" />
        <div className="cal-head__days" style={{ gridTemplateColumns: colTemplate }}>
          {days.map((d) => (
            <div
              key={d}
              className={`cal-head__day${d === today ? ' cal-head__day--today' : ''}`}
            >
              <span className="cal-head__dow">
                {DOW_LABEL[d]}
                {d === today && <span className="cal-head__today-dot" aria-hidden />}
              </span>
              <span className="sr-only">{weekdayLong(d)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="cal-scroll">
        <div className="cal-grid" style={{ height }}>
          {/* hour gutter */}
          <div className="cal-gutter" style={{ height }}>
            {marks.map((h) => (
              <div
                key={h}
                className="cal-gutter__hour"
                style={{ top: (h - cfg.startHour) * 60 * cfg.pxPerMinute }}
              >
                {formatDisplay(`${String(h).padStart(2, '0')}:00`)}
              </div>
            ))}
          </div>

          {/* day canvas */}
          <div className="cal-canvas" style={{ height }}>
            {/* background columns */}
            <div className="cal-cols" style={{ gridTemplateColumns: colTemplate }}>
              {days.map((d) => (
                <div
                  key={d}
                  className={`cal-col${d === today ? ' cal-col--today' : ''}${
                    d === 'Sat' || d === 'Sun' ? ' cal-col--weekend' : ''
                  }`}
                />
              ))}
            </div>

            {/* horizontal hour lines */}
            <div className="cal-hlines">
              {marks.map((h) => (
                <div
                  key={h}
                  className="cal-hline"
                  style={{ top: (h - cfg.startHour) * 60 * cfg.pxPerMinute }}
                />
              ))}
              {marks.slice(0, -1).map((h) => (
                <div
                  key={`half-${h}`}
                  className="cal-hline cal-hline--half"
                  style={{ top: (h - cfg.startHour) * 60 * cfg.pxPerMinute + 30 * cfg.pxPerMinute }}
                />
              ))}
            </div>

            {/* blocks, one absolutely-positioned lane grid per visible day */}
            <div className="cal-cols" style={{ gridTemplateColumns: colTemplate }}>
              {days.map((d) => (
                <div key={d} className="cal-col" style={{ position: 'relative' }}>
                  {byDay[d].map((block) => (
                    <CourseBlock key={block.key} block={block} onOpen={onOpenCourse} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
