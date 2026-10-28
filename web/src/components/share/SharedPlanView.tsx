/**
 * Someone's plan, opened from a link by a visitor who is not signed in. Nothing
 * here edits or saves: keeping the plan needs an account, so the caller decides
 * what "Save to my account" does.
 */
import { useMemo, type ReactNode } from 'react';
import { formatDisplay, optionMidterms, type FinalExam, type PlanState } from '@triton/shared';
import { useIsMobile } from '../../hooks/useIsMobile';
import { PRODUCT_NAME } from '../../lib/brand';
import { colorsForHue } from '../../lib/colors';
import { dateParts } from '../../lib/format';
import { entryHue, findOption, meetingInstances } from '../../lib/plan';
import { displayTermLabel } from '../../lib/terms';
import { CalendarGrid } from '../CalendarGrid';
import { Trident } from '../icons';

const noop = () => {};

/** "Midterm 1 · Wed, Oct 28 · 11:00 AM – 12:20 PM" */
function examLine(label: string, exam: FinalExam): string {
  const d = dateParts(exam.date);
  return `${label} · ${d.dow}, ${d.month} ${Number(d.day)} · ${formatDisplay(exam.start)} – ${formatDisplay(exam.end)}`;
}

export function SharedPlanView({ name, plan, onSave }: { name: string; plan: PlanState; onSave: () => void }) {
  return (
    <main className="shared">
      <SharedBar />
      <div className="shared__body">
        <div className="shared__head">
          <div className="shared__titles">
            <h1 className="shared__title">{name}</h1>
            <p className="shared__sub">{displayTermLabel(plan.term)} · shared with you · read-only</p>
          </div>
          <button type="button" className="btn btn--primary shared__save" onClick={onSave}>
            Save to my account
          </button>
        </div>
        <PlanPicture plan={plan} />
      </div>
    </main>
  );
}

/** The brand strip over a page that is not the planner. */
export function SharedBar() {
  return (
    <header className="shared__bar">
      <div className="brand shared__brand">
        <Trident className="brand__mark" size={22} />
        <span>{PRODUCT_NAME}</span>
      </div>
    </header>
  );
}

/**
 * A plan's week and its courses, with nothing to click. `empty` stands where the
 * week would be when nothing meets; `side` goes under the course list.
 */
export function PlanPicture({ plan, empty, side }: { plan: PlanState; empty?: ReactNode; side?: ReactNode }) {
  const isMobile = useIsMobile();
  const instances = useMemo(() => meetingInstances(plan), [plan]);
  const hasSide = plan.entries.length > 0 || side !== undefined;

  return (
    <div className={`shared__layout${hasSide ? '' : ' shared__layout--solo'}`}>
      {/* The planner's empty grid invites the student to add courses; with nothing
          scheduled here there is no week to draw. onBlockDetail turns each block's
          code and room into plain text, and a no-op leaves nothing on it to click. */}
      {instances.length > 0 ? (
        <CalendarGrid
          instances={instances}
          onOpenCourse={noop}
          onOpenLocation={noop}
          onFocusCourse={noop}
          onBlockDetail={noop}
          variant={isMobile ? 'fit' : 'desktop'}
        />
      ) : (
        empty
      )}

      {hasSide && (
        <div className="shared__side">
          {plan.entries.length > 0 && <PlanCourses plan={plan} />}
          {side}
        </div>
      )}
    </div>
  );
}

function PlanCourses({ plan }: { plan: PlanState }) {
  return (
    <ul className="shared__courses">
      {plan.entries.map((entry) => {
        const option = findOption(entry.course, entry.selectedOptionId);
        // An explicit midterms list can arrive unsorted; "Midterm 1" is always the earlier one.
        const midterms = option
          ? [...optionMidterms(option)].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
          : [];
        const exams = midterms.map((m, i) => examLine(midterms.length > 1 ? `Midterm ${i + 1}` : 'Midterm', m));
        if (option?.final) exams.push(examLine('Final', option.final));
        return (
          <li
            key={entry.course.id}
            className="shared__course"
            style={{ ['--c-spine' as string]: colorsForHue(entryHue(plan, entry)).spine }}
          >
            <div className="shared__courseline">
              <span className="shared__code">{entry.course.courseCode}</span>
              <span className={`shared__section${option ? ' mono' : ''}`}>
                {option ? option.code : 'no section chosen'}
              </span>
            </div>
            <div className="shared__name">{entry.course.title}</div>
            {exams.length > 0 && (
              <ul className="shared__exams">
                {exams.map((line) => (
                  <li key={line} className="shared__exam">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
