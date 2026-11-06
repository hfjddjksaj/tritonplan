/**
 * Everything under the top bar: the course rail, the calendar / midterms / finals
 * views, the mobile tab bar, and the sheets, popovers and map they open. Driven
 * entirely by a controller, so the own planner and a shared plan render the same
 * body; what may be edited is the controller's business.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlanController } from '../hooks/usePlan';
import { useIsMobile } from '../hooks/useIsMobile';
import { countConflictPairs, entryHue } from '../lib/plan';
import { colorsForHue } from '../lib/colors';
import { pluralize } from '../lib/format';
import { loadCalView, saveCalView, type CalView } from '../lib/storage';
import type { PositionedBlock } from '../lib/layout';
import { CoursePanel } from './CoursePanel';
import { CalendarGrid } from './CalendarGrid';
import { CalViewToggle } from './CalViewToggle';
import { FinalsView } from './FinalsView';
import { MidtermsView } from './MidtermsView';
import { ConflictBanner } from './ConflictBanner';
import { BuildingPopover } from './BuildingPopover';
import { PlanPickerModal } from './PlanPickerModal';
import { CourseRmpModal } from './RmpModal';
import { BlockSheet } from './BlockSheet';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { ViewTabs, type PlannerView } from './ViewTabs';
const CampusMap = lazy(() => import('./CampusMap').then((m) => ({ default: m.CampusMap })));

/** The campus map: null while shut; {} from the top bar; a building from a class location's popover. */
export type CampusOpen = { focusBuilding?: string } | null;

export function PlannerBody({
  ctl,
  campus,
  setCampus,
}: {
  ctl: PlanController;
  /** Owned by the caller, whose top bar has a Map button of its own. */
  campus: CampusOpen;
  setCampus: (next: CampusOpen) => void;
  /** Shows the caller's toast. */
  flash: (msg: string) => void;
}) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<MobileTab>('calendar');
  const [calPulse, setCalPulse] = useState(false);
  const [calView, setCalView] = useState<CalView>(loadCalView);
  const handleCalView = useCallback((v: CalView) => {
    setCalView(v);
    saveCalView(v);
  }, []);
  // Desktop has no Courses tab — the rail is always visible there.
  const view: MobileTab = !isMobile && tab === 'courses' ? 'calendar' : tab;
  const plannerView: PlannerView = view === 'courses' ? 'calendar' : view;
  const [mapLoc, setMapLoc] = useState<{ building: string; room?: string } | null>(null);
  const [sheetBlock, setSheetBlock] = useState<PositionedBlock | null>(null);
  // A teacher's name on the calendar opens the same ratings dialog as the course card's button.
  const [rmpCourseId, setRmpCourseId] = useState<string | null>(null);
  const rmpEntry = rmpCourseId ? ctl.viewPlan.entries.find((e) => e.course.id === rmpCourseId) : undefined;
  // Clicking a calendar block reveals that course's card in the rail. The nonce
  // makes a second click on the same course re-trigger the scroll/expand.
  const [focusReq, setFocusReq] = useState<{ courseId: string; nonce: number } | null>(null);

  useEffect(() => {
    setSheetBlock(null);
  }, [view]);

  // When the plan changes while the calendar is off-screen (mobile Courses tab),
  // pulse the Calendar tab as a "your week updated" hint. No auto-switching.
  const prevPlanRef = useRef(ctl.plan);
  useEffect(() => {
    const changed = prevPlanRef.current !== ctl.plan;
    prevPlanRef.current = ctl.plan;
    if (!changed || !isMobile || view !== 'courses') return;
    setCalPulse(true);
    const t = setTimeout(() => setCalPulse(false), 1600);
    return () => clearTimeout(t);
  }, [ctl.plan, isMobile, view]);

  const handleOpenCourse = useCallback(
    (courseId: string) => {
      const course = ctl.courseById.get(courseId);
      if (course) ctl.openCourseInTss(course);
    },
    [ctl.courseById, ctl.openCourseInTss],
  );

  const handleFocusCourse = useCallback(
    (courseId: string) => {
      if (isMobile) setTab('courses'); // the card lives on the Courses tab
      setFocusReq((prev) => ({ courseId, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [isMobile],
  );

  const conflictCount = useMemo(
    () => countConflictPairs(ctl.weeklyConflicts, ctl.finalConflicts),
    [ctl.weeklyConflicts, ctl.finalConflicts],
  );

  function hintText(): string {
    if (conflictCount > 0) return `${conflictCount} ${pluralize(conflictCount, 'conflict')}`;
    if (ctl.selectedCourses.length > 0) return 'No conflicts — looks clear';
    return 'Bring in a course to begin';
  }

  return (
    <>
      <div className="app__body">
        <CoursePanel ctl={ctl} focus={focusReq} hidden={isMobile && view !== 'courses'} />

        {(!isMobile || view !== 'courses') && (
          <main className="main">
            <div className="toolbar">
              {isMobile && view !== 'courses' && (
                <CalViewToggle value={calView} onChange={handleCalView} />
              )}
              <ViewTabs
                value={plannerView}
                onChange={setTab}
                finalsBadge={ctl.finalConflicts.length}
              />
              <div className="toolbar__spacer" />
              <span className="toolbar__hint">{hintText()}</span>
            </div>

            {view === 'calendar' && (
              <ConflictBanner
                weekly={ctl.weeklyConflicts}
                finals={ctl.finalConflicts}
                codeById={ctl.codeById}
              />
            )}

            {view === 'calendar' ? (
              <CalendarGrid
                instances={ctl.instances}
                onOpenCourse={handleOpenCourse}
                onOpenLocation={(block) => {
                  if (block.building) setMapLoc({ building: block.building, room: block.room });
                }}
                onOpenInstructor={(block) => setRmpCourseId(block.courseId)}
                onFocusCourse={handleFocusCourse}
                onBlockDetail={isMobile ? setSheetBlock : undefined}
                variant={isMobile ? (calView === 'scroll' ? 'scroll' : 'fit') : 'desktop'}
              />
            ) : view === 'midterms' ? (
              <MidtermsView
                dated={ctl.midterms.dated}
                tbd={ctl.midterms.tbd}
                onOpenCourse={handleOpenCourse}
                onFocusCourse={handleFocusCourse}
                onOpenLocation={(l) => setMapLoc(l)}
                onBlockDetail={isMobile ? setSheetBlock : undefined}
                variant={isMobile ? (calView === 'scroll' ? 'scroll' : 'fit') : 'desktop'}
              />
            ) : (
              <FinalsView
                finals={ctl.finals}
                conflicts={ctl.finalConflicts}
                onOpenCourse={handleOpenCourse}
                onFocusCourse={handleFocusCourse}
                onOpenLocation={(l) => setMapLoc(l)}
                onBlockDetail={isMobile ? setSheetBlock : undefined}
                variant={isMobile ? (calView === 'scroll' ? 'scroll' : 'fit') : 'desktop'}
              />
            )}
          </main>
        )}
      </div>

      {isMobile && (
        <MobileTabBar
          tab={view}
          onTab={setTab}
          coursesCount={ctl.viewPlan.entries.length}
          finalsBadge={ctl.finalConflicts.length}
          pulse={calPulse}
        />
      )}

      {sheetBlock && (
        <BlockSheet
          block={sheetBlock}
          onClose={() => setSheetBlock(null)}
          onOpenCourse={(id) => {
            setSheetBlock(null);
            handleOpenCourse(id);
          }}
          onOpenLocation={(b) => {
            setSheetBlock(null);
            if (b.building) setMapLoc({ building: b.building, room: b.room });
          }}
          onOpenInstructor={(b) => {
            setSheetBlock(null);
            setRmpCourseId(b.courseId);
          }}
          onFocusCourse={(id) => {
            setSheetBlock(null);
            handleFocusCourse(id);
          }}
        />
      )}

      {rmpEntry && (
        <CourseRmpModal
          course={rmpEntry.course}
          selectedOptionId={rmpEntry.selectedOptionId}
          accent={colorsForHue(entryHue(ctl.viewPlan, rmpEntry))}
          onClose={() => setRmpCourseId(null)}
        />
      )}

      {mapLoc && (
        <BuildingPopover
          building={mapLoc.building}
          room={mapLoc.room}
          onOpenCampusMap={() => {
            setMapLoc(null);
            setCampus({ focusBuilding: mapLoc.building });
          }}
          onClose={() => setMapLoc(null)}
        />
      )}

      {ctl.pendingAdd && (
        <PlanPickerModal
          course={ctl.pendingAdd.course}
          plans={ctl.pendingAddPlans}
          onPick={ctl.confirmPendingAdd}
          onCancel={ctl.cancelPendingAdd}
        />
      )}

      {campus && (
        <Suspense
          fallback={
            <div className="campusmap campusmap--pending" role="dialog" aria-modal="true" aria-label="Campus map">
              <div className="campusmap__loading">Loading campus…</div>
            </div>
          }
        >
          <CampusMap
            plan={ctl.viewPlan}
            booked={ctl.bookedIds}
            readOnly={ctl.readOnly}
            initialView={plannerView}
            focusBuilding={campus.focusBuilding}
            onClose={() => setCampus(null)}
          />
        </Suspense>
      )}
    </>
  );
}
