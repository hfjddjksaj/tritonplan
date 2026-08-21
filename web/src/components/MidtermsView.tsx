import { examDisplay, formatDisplay } from '@triton/shared';
import { colorsForHue } from '../lib/colors';
import { dateParts } from '../lib/format';
import {
  midtermItemKey,
  midtermOverlapKeys,
  type MidtermItem,
  type MidtermTbdItem,
} from '../lib/plan';
import { FinalsCalendar } from './FinalsCalendar';
import { Warning, Calendar } from './icons';
import type { PositionedBlock } from '../lib/layout';
import { tip } from './Tooltip';

interface Props {
  dated: MidtermItem[];
  tbd: MidtermTbdItem[];
  onOpenCourse: (courseId: string) => void;
  onFocusCourse?: (courseId: string) => void;
  /** Show where this exam's building is; when absent the location stays plain text. */
  onOpenLocation?: (loc: { building: string; room?: string }) => void;
  /** When set, calendar blocks become a single tap target opening a detail sheet (mobile). */
  onBlockDetail?: (block: PositionedBlock) => void;
  /** Forwarded to the at-a-glance calendar (mobile fit/scroll variants). */
  variant?: 'desktop' | 'fit' | 'scroll';
}

/**
 * Midterms view — the Finals layout applied to midterm exams. Courses whose
 * midterm time is visible in TSS data get dated rows + calendar blocks; every
 * other plan course shows as a TBD row only (TSS can't distinguish "no
 * midterm" from "not announced yet").
 */
export function MidtermsView({
  dated,
  tbd,
  onOpenCourse,
  onFocusCourse,
  onOpenLocation,
  onBlockDetail,
  variant,
}: Props) {
  const overlapping = midtermOverlapKeys(dated);

  if (dated.length === 0 && tbd.length === 0) {
    return (
      <div className="empty" style={{ height: '60vh' }}>
        <Calendar size={40} className="empty__mark" strokeWidth={1.4} />
        <div className="empty__title">No midterms to show yet</div>
        <p className="empty__text">
          Add courses to your plan and any midterm exams TSS lists for them will line up here in
          date order. Courses without an announced midterm show as TBD.
        </p>
      </div>
    );
  }

  return (
    <div className="finals">
      <p className="finals__intro">
        Midterm exams for your selected sections, earliest first. Courses whose midterm isn’t
        announced in TSS yet are listed as TBD — check back after browsing the course again.
      </p>
      <div className="finals__timeline">
        {dated.map((m) => {
          const c = colorsForHue(m.hue);
          const dp = dateParts(m.midterm.date);
          const key = midtermItemKey(m);
          const isOverlap = overlapping.has(key);
          const loc = examDisplay(m.midterm);
          return (
            <div
              key={key}
              className={`final-row${isOverlap ? ' final-row--conflict' : ''}`}
              style={{ ['--c-spine' as string]: c.spine, ['--c-text' as string]: c.text }}
            >
              <div className="final-row__date">
                <div className="final-row__dow">{dp.dow}</div>
                <div className="final-row__day">{dp.day}</div>
                <div className="final-row__month">{dp.month}</div>
              </div>
              <div className="final-row__main">
                <div className="final-row__code">
                  {m.courseCode}
                  {m.label && <span className="final-row__seq"> · {m.label}</span>}
                </div>
                <div className="final-row__title">{m.title}</div>
                {isOverlap && (
                  <div className="final-row__flag">
                    <Warning size={13} /> Overlaps another midterm
                  </div>
                )}
              </div>
              <div className="final-row__time">
                <div className="final-row__time-range">
                  {formatDisplay(m.midterm.start)} – {formatDisplay(m.midterm.end)}
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

        {tbd.map((t) => {
          const c = colorsForHue(t.hue);
          return (
            <div
              key={t.courseId}
              className="final-row final-row--tbd"
              style={{ ['--c-spine' as string]: c.spine, ['--c-text' as string]: c.text }}
            >
              <div className="final-row__date">
                <div className="final-row__day final-row__day--tbd">?</div>
              </div>
              <div className="final-row__main">
                <div className="final-row__code">{t.courseCode}</div>
                <div className="final-row__title">{t.title}</div>
              </div>
              <div className="final-row__time">
                <div className="final-row__time-range">TBD</div>
                <div className="opt__seats-label">Not announced in TSS yet</div>
              </div>
            </div>
          );
        })}
      </div>

      {dated.length > 0 && (
        <>
          <div className="eyebrow fincal__title">Midterms at a glance</div>
          <FinalsCalendar
            finals={dated.map((m) => ({
              courseId: m.courseId,
              courseCode: m.courseCode,
              title: m.title,
              hue: m.hue,
              final: m.midterm,
              full: m.full,
            }))}
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
            examLabel="Midterm"
            ariaLabel="Midterms calendar"
          />
        </>
      )}
    </div>
  );
}
