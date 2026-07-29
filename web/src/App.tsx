import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlan } from './hooks/usePlan';
import { useIsMobile } from './hooks/useIsMobile';
import { useApptTimes } from './hooks/useApptTimes';
import { Topbar } from './components/Topbar';
import { PlanSwitcher } from './components/PlanSwitcher';
import { ApptCapsule } from './components/ApptCapsule';
import { CoursePanel } from './components/CoursePanel';
import { CalendarGrid } from './components/CalendarGrid';
import { CalViewToggle } from './components/CalViewToggle';
import { FinalsView } from './components/FinalsView';
import { MidtermsView } from './components/MidtermsView';
import { ConflictBanner } from './components/ConflictBanner';
import { ReceivedBanner } from './components/ReceivedBanner';
import { BuildingPopover } from './components/BuildingPopover';
import { BlockSheet } from './components/BlockSheet';
import { MobileTabBar, type MobileTab } from './components/MobileTabBar';
import { Calendar, Cap, Check, PenLine } from './components/icons';
import { parsePlanJson, planFromLinkText } from './lib/share';
import { countConflictPairs } from './lib/plan';
import { pluralize } from './lib/format';
import { PRODUCT_NAME } from './lib/brand';
import { loadCalView, saveCalView, type CalView } from './lib/storage';
import type { PositionedBlock } from './lib/layout';

export default function App() {
  const ctl = usePlan();
  const isMobile = useIsMobile();
  const appt = useApptTimes();
  const [tab, setTab] = useState<MobileTab>('calendar');
  const [calPulse, setCalPulse] = useState(false);
  const [calView, setCalView] = useState<CalView>(loadCalView);
  const handleCalView = useCallback((v: CalView) => {
    setCalView(v);
    saveCalView(v);
  }, []);
  // Desktop has no Courses tab — the rail is always visible there.
  const view: MobileTab = !isMobile && tab === 'courses' ? 'calendar' : tab;
  const [toast, setToast] = useState<string | null>(null);
  const [mapLoc, setMapLoc] = useState<{ building: string; room?: string } | null>(null);
  const [sheetBlock, setSheetBlock] = useState<PositionedBlock | null>(null);
  // Clicking a calendar block reveals that course's card in the rail. The nonce
  // makes a second click on the same course re-trigger the scroll/expand.
  const [focusReq, setFocusReq] = useState<{ courseId: string; nonce: number } | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

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

  const handleImportText = useCallback(
    (text: string) => {
      const plan = parsePlanJson(text);
      if (!plan) {
        flash(`That file isn’t a valid ${PRODUCT_NAME} plan`);
        return;
      }
      ctl.importReceived(plan, 'json');
      flash('Imported plan opened — read-only, your own plan is untouched');
    },
    [ctl, flash],
  );

  const handleImportLink = useCallback(
    (text: string): boolean => {
      const plan = planFromLinkText(text);
      if (!plan) {
        flash('That doesn’t look like a valid share link');
        return false;
      }
      ctl.importReceived(plan, 'link');
      flash('Shared plan opened — read-only, your own plan is untouched');
      return true;
    },
    [ctl, flash],
  );

  const handleSaveAsMine = useCallback(() => {
    const n = ctl.plan.entries.length;
    if (
      n > 0 &&
      !window.confirm(
        `Replace “${ctl.activePlanName}” (${n} ${pluralize(n, 'course')}) with this plan?`,
      )
    ) {
      return;
    }
    ctl.saveReceivedAsMine();
    flash(`Replaced “${ctl.activePlanName}” — you can edit it now`);
  }, [ctl, flash]);

  const handleSaveAsNewPlan = useCallback(() => {
    if (!ctl.received) return;
    const d = new Date(ctl.received.receivedAt);
    const fallback = `${ctl.received.source === 'link' ? 'Shared' : 'Imported'} plan ${d.getMonth() + 1}/${d.getDate()}`;
    const name = window.prompt('Name this plan', fallback);
    if (name === null) return;
    ctl.saveReceivedAsNewPlan(name.trim() || fallback);
    flash('Saved as a new plan — you can edit it now');
  }, [ctl, flash]);

  const handleDiscardReceived = useCallback(() => {
    if (window.confirm('Discard this plan? Your own plan is not affected.')) {
      ctl.discardReceived();
    }
  }, [ctl]);

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

  const handleReset = useCallback(() => {
    if (ctl.plan.entries.length === 0) return;
    if (window.confirm('Remove every course from the plan? Browsed courses stay.')) {
      ctl.resetPlan();
      flash('Plan cleared');
    }
  }, [ctl, flash]);

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
    <div className={`app${isMobile ? ' app--mobile' : ''}`}>
      <Topbar
        termLabel={ctl.viewPlan.term.label}
        units={ctl.units}
        readOnly={ctl.readOnly}
        planSwitcher={
          <PlanSwitcher
            plans={ctl.plans.map((p) => ({ id: p.id, name: p.name, count: p.plan.entries.length }))}
            activeId={ctl.activePlanId}
            onSwitch={ctl.switchPlan}
            onCreate={ctl.createNewPlan}
            onRename={ctl.renamePlan}
            onDuplicate={ctl.duplicatePlan}
            onDelete={ctl.deletePlan}
          />
        }
        apptSlot={<ApptCapsule appt={appt} />}
        sharePlan={ctl.viewPlan}
        onFlash={flash}
        onImportText={handleImportText}
        onImportLink={handleImportLink}
        onReset={handleReset}
      />
      {ctl.received && (
        <ReceivedBanner
          received={ctl.received}
          viewing={ctl.viewing}
          onView={() => ctl.switchViewing('received')}
          onBackToMine={() => ctl.switchViewing('mine')}
          onSaveAsNew={handleSaveAsNewPlan}
          onSaveAsMine={handleSaveAsMine}
          onDiscard={handleDiscardReceived}
        />
      )}
      <div className="app__body">
        <CoursePanel ctl={ctl} focus={focusReq} hidden={isMobile && view !== 'courses'} />

        {(!isMobile || view !== 'courses') && (
          <main className="main">
            <div className="toolbar">
              {isMobile && view !== 'courses' && (
                <CalViewToggle value={calView} onChange={handleCalView} />
              )}
              <div className="tabs" role="tablist" aria-label="Planner views">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'calendar'}
                  className={`tab${view === 'calendar' ? ' tab--active' : ''}`}
                  onClick={() => setTab('calendar')}
                >
                  <Calendar size={15} /> Calendar
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'midterms'}
                  className={`tab${view === 'midterms' ? ' tab--active' : ''}`}
                  onClick={() => setTab('midterms')}
                >
                  <PenLine size={15} /> Midterms
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'finals'}
                  className={`tab${view === 'finals' ? ' tab--active' : ''}`}
                  onClick={() => setTab('finals')}
                >
                  <Cap size={15} /> Finals
                  {ctl.finalConflicts.length > 0 && (
                    <span className="tab__badge">{ctl.finalConflicts.length}</span>
                  )}
                </button>
              </div>
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
                variant={isMobile ? (calView === 'scroll' ? 'scroll' : 'fit') : 'desktop'}
              />
            ) : (
              <FinalsView
                finals={ctl.finals}
                conflicts={ctl.finalConflicts}
                onOpenCourse={handleOpenCourse}
                onFocusCourse={handleFocusCourse}
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

      {toast && (
        <div className="toast" role="status">
          <Check size={16} className="toast__check" /> {toast}
        </div>
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
          onFocusCourse={(id) => {
            setSheetBlock(null);
            handleFocusCourse(id);
          }}
        />
      )}

      {mapLoc && (
        <BuildingPopover
          building={mapLoc.building}
          room={mapLoc.room}
          onClose={() => setMapLoc(null)}
        />
      )}
    </div>
  );
}
