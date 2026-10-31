/**
 * The old planner, drawn from the student's own saved plan and blurred behind
 * the migration card, so they can see both that this is TritonPlan and which
 * plan is about to move. Loaded after the card, as its own chunk: it is the
 * only part of this page that needs React and the planner's stylesheet.
 *
 * A picture, not an app: the planner's real components with no-op handlers,
 * the whole tree `inert` and hidden from assistive tech. Nothing here writes
 * storage or makes a request; the old data stays exactly as it was found.
 */
import { createRoot } from 'react-dom/client';
import { courseIdsInConflicts, findFinalConflicts, findWeeklyConflicts } from '@triton/shared';
import { ApptCapsule } from '../src/components/ApptCapsule';
import { CalendarGrid } from '../src/components/CalendarGrid';
import { ConflictBanner } from '../src/components/ConflictBanner';
import { CourseCard } from '../src/components/CourseCard';
import { MobileTabBar } from '../src/components/MobileTabBar';
import { PlanSwitcher } from '../src/components/PlanSwitcher';
import { TermSwitcher } from '../src/components/TermSwitcher';
import { Topbar } from '../src/components/Topbar';
import { ViewTabs } from '../src/components/ViewTabs';
import { Plus } from '../src/components/icons';
import { useIsMobile } from '../src/hooks/useIsMobile';
import { PRODUCT_NAME } from '../src/lib/brand';
import { pluralize } from '../src/lib/format';
import { buildSelectedCourses, countConflictPairs, meetingInstances, planUnits } from '../src/lib/plan';
import { displayTermLabel, isArchived, termKey } from '../src/lib/terms';
import type { MigrationPayload } from '../src/lib/migration';
import '../src/styles/app.css';
import { backdropView, type BackdropView } from './backdrop-view';

const noop = () => {};

export function PlannerBackdrop({ view, now }: { view: BackdropView; now: Date }) {
  const isMobile = useIsMobile();
  const { plan } = view;
  const selected = buildSelectedCourses(plan);
  const weekly = findWeeklyConflicts(selected);
  const finals = findFinalConflicts(selected);
  const conflicted = courseIdsInConflicts([...weekly, ...finals]);
  const conflicts = countConflictPairs(weekly, finals);
  const units = planUnits(plan);
  const codeById = new Map(plan.entries.map((e) => [e.course.id, e.course.courseCode]));
  const hint =
    conflicts > 0
      ? `${conflicts} ${pluralize(conflicts, 'conflict')}`
      : selected.length > 0
        ? 'No conflicts — looks clear'
        : 'Bring in a course to begin';

  return (
    <div className={`app${isMobile ? ' app--mobile' : ''}`}>
      <Topbar
        termSlot={
          <TermSwitcher
            terms={view.terms}
            activeKey={termKey(plan.term)}
            activeLabel={displayTermLabel(plan.term)}
            archived={isArchived(plan.term, now)}
            onSwitch={noop}
          />
        }
        units={units}
        readOnly={false}
        planSwitcher={
          <PlanSwitcher
            plans={view.plans.map((p) => ({ id: p.id, name: p.name, count: p.plan.entries.length }))}
            activeId={view.activeId}
            onSwitch={noop}
            onCreate={noop}
            onRename={noop}
            onDuplicate={noop}
            onDelete={noop}
          />
        }
        apptSlot={<ApptCapsule appt={view.appt} />}
        onReset={noop}
        onOpenMap={noop}
      />
      <div className="app__body">
        {/* The rail's head and lists, as CoursePanel draws them for the student's own plan. */}
        <aside className={`rail${isMobile ? ' rail--hidden' : ''}`}>
          <div className="rail__head">
            <div className="rail__title-row">
              <span className="rail__title">Added Courses</span>
              <span className="rail__count mono">
                {plan.entries.length} added<span className="rail__units"> · {units} units</span>
              </span>
            </div>
            <p className="rail__lede">Sections you pick in TSS land here. Switch a section below to clear a conflict.</p>
          </div>
          <div className="rail__scroll">
            {plan.entries.map((entry, i) => (
              <CourseCard
                key={entry.course.id}
                entry={entry}
                index={i}
                conflicted={conflicted.has(entry.course.id)}
                onSelect={noop}
                onRemove={noop}
                onOpenTss={noop}
                onBook={noop}
                booked={view.booked.has(entry.course.id)}
                waitlisted={view.waitlisted.has(entry.course.id)}
              />
            ))}
            {view.browsed.length > 0 && (
              <>
                <div className="rail__section">
                  <span className="eyebrow">Browsed — not yet added</span>
                </div>
                <ul className="browse-list">
                  {view.browsed.map((c) => (
                    <li key={c.id} className="browse-item">
                      <span className="browse-row">
                        <span className="browse-row__main">
                          <span className="browse-row__code mono">{c.courseCode}</span>
                          <span className="browse-row__title">{c.title}</span>
                        </span>
                        <span className="browse-row__add">
                          <Plus size={13} strokeWidth={2.4} /> {PRODUCT_NAME}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </aside>

        <main className="main">
          <div className="toolbar">
            <ViewTabs value="calendar" onChange={noop} finalsBadge={finals.length} />
            <div className="toolbar__spacer" />
            <span className="toolbar__hint">{hint}</span>
          </div>
          <ConflictBanner weekly={weekly} finals={finals} codeById={codeById} />
          <CalendarGrid
            instances={meetingInstances(plan, view.booked)}
            onOpenCourse={noop}
            onOpenLocation={noop}
            onFocusCourse={noop}
            variant={isMobile ? 'fit' : 'desktop'}
          />
        </main>
      </div>
      {isMobile && (
        <MobileTabBar
          tab="calendar"
          onTab={noop}
          coursesCount={plan.entries.length}
          finalsBadge={finals.length}
          pulse={false}
        />
      )}
    </div>
  );
}

/** Draws the backdrop under everything else on the page. Never throws past the caller's catch. */
export function mountBackdrop(doc: Document, payload: MigrationPayload, nowIso: string): void {
  const view = backdropView(payload, nowIso);
  const host = doc.createElement('div');
  host.className = 'moved-backdrop';
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  doc.body.prepend(host);
  createRoot(host).render(<PlannerBackdrop view={view} now={new Date(nowIso)} />);
}
