import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDisplay } from '@triton/shared';
import {
  DEFAULT_GRID,
  MOBILE_GRID,
  gridHeightPx,
  gridStartMinutes,
  gridTotalMinutes,
  hourMarks,
  hourMarkTop,
  layoutWeek,
  visibleDays,
  type MeetingInstance,
  type PositionedBlock,
} from '../lib/layout';
import { todayWeekday, weekdayLong } from '../lib/format';
import { CourseBlock } from './CourseBlock';
import { Calendar } from './icons';

/** Current wall-clock time, refreshed once a minute (drives the now-line + today highlight). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

interface Props {
  instances: MeetingInstance[];
  onOpenCourse: (courseId: string) => void;
  onOpenLocation: (block: PositionedBlock) => void;
  onFocusCourse: (courseId: string) => void;
  /** 'desktop' (default) | mobile 'fit' (whole week in viewport) | mobile 'scroll' (wide snap-scrolling day columns). */
  variant?: 'desktop' | 'fit' | 'scroll';
  onBlockDetail?: (block: PositionedBlock) => void;
}

/** "8a" / "12p" / "9p" — the 64px desktop gutter shrinks to 34px on mobile. */
function shortHour(h: number): string {
  return `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;
}

export function CalendarGrid({
  instances,
  onOpenCourse,
  onOpenLocation,
  onFocusCourse,
  variant = 'desktop',
  onBlockDetail,
}: Props) {
  const cfg = variant === 'desktop' ? DEFAULT_GRID : MOBILE_GRID;
  const { byDay, usedDays } = useMemo(() => layoutWeek(instances, cfg), [instances, cfg]);
  const days = useMemo(() => visibleDays(usedDays), [usedDays]);
  const marks = useMemo(() => hourMarks(cfg), [cfg]);
  const height = gridHeightPx(cfg);
  const now = useNow();
  const today = todayWeekday(now);
  const nowOffsetMin = now.getHours() * 60 + now.getMinutes() - gridStartMinutes(cfg);
  const nowInWindow = nowOffsetMin >= 0 && nowOffsetMin <= gridTotalMinutes(cfg);
  const nowTop = nowOffsetMin * cfg.pxPerMinute;
  const scrollRef = useRef<HTMLDivElement>(null);

  const colTemplate =
    variant === 'scroll' ? `repeat(${days.length}, var(--day-col-w))` : `repeat(${days.length}, 1fr)`;

  // Day-scroll mode starts with today at the left edge. Re-arm whenever the
  // scroll view is left or the grid unmounts (empty plan), so entering it —
  // or adding the first course while already in it — scrolls exactly once.
  const hasGrid = instances.length > 0;
  const didAutoScroll = useRef(false);
  useEffect(() => {
    if (variant !== 'scroll' || !hasGrid) {
      didAutoScroll.current = false;
      return;
    }
    if (didAutoScroll.current) return;
    didAutoScroll.current = true;
    const el = scrollRef.current?.querySelector('.cal-col--today');
    el?.scrollIntoView({ inline: 'start', block: 'nearest' });
  }, [variant, hasGrid]);

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
    <div className={`cal-wrap${variant !== 'desktop' ? ` cal--${variant}` : ''}`}>
      <div className="cal-scroll" ref={scrollRef}>
        {/* Sticky header INSIDE the scroll container: it then shares the scrollbar
            gutter with the body, so header and body columns always align (classic
            scrollbars shrink the scroll content; a header outside wouldn't shrink). */}
        <div className="cal-head">
          <div className="cal-head__corner" />
          <div className="cal-head__days" style={{ gridTemplateColumns: colTemplate }}>
            {days.map((d) => (
              <div
                key={d}
                className={`cal-head__day${d === today ? ' cal-head__day--today' : ''}`}
              >
                <span className="cal-head__dow">
                  {d}
                  {d === today && <span className="cal-head__today-dot" aria-hidden />}
                </span>
                <span className="sr-only">{weekdayLong(d)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="cal-grid" style={{ height }}>
          {/* hour gutter */}
          <div className="cal-gutter" style={{ height }}>
            {marks.map((h) => (
              <div
                key={h}
                className="cal-gutter__hour"
                style={{ top: hourMarkTop(h, cfg) }}
              >
                {variant === 'desktop' ? formatDisplay(`${String(h).padStart(2, '0')}:00`) : shortHour(h)}
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
                  style={{ top: hourMarkTop(h, cfg) }}
                />
              ))}
              {marks.slice(0, -1).map((h) => (
                <div
                  key={`half-${h}`}
                  className="cal-hline cal-hline--half"
                  style={{ top: hourMarkTop(h, cfg) + 30 * cfg.pxPerMinute }}
                />
              ))}
            </div>

            {/* blocks, one absolutely-positioned lane grid per visible day */}
            <div className="cal-cols" style={{ gridTemplateColumns: colTemplate }}>
              {days.map((d) => (
                <div key={d} className="cal-col" style={{ position: 'relative' }}>
                  {byDay[d].map((block) => (
                    <CourseBlock
                      key={block.key}
                      block={block}
                      onOpen={onOpenCourse}
                      onOpenLocation={onOpenLocation}
                      onFocusCourse={onFocusCourse}
                      onDetail={onBlockDetail}
                    />
                  ))}
                  {d === today && nowInWindow && (
                    <div className="cal-nowline" style={{ top: nowTop }} aria-hidden />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
