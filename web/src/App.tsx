import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlan } from './hooks/usePlan';
import { Topbar } from './components/Topbar';
import { CoursePanel } from './components/CoursePanel';
import { CalendarGrid } from './components/CalendarGrid';
import { FinalsView } from './components/FinalsView';
import { ConflictBanner } from './components/ConflictBanner';
import { ReceivedBanner } from './components/ReceivedBanner';
import { BuildingPopover } from './components/BuildingPopover';
import { Calendar, Cap, Check } from './components/icons';
import { downloadPlanJson, parsePlanJson, planFromLinkText, planToHash, shareUrl } from './lib/share';
import { countConflictPairs } from './lib/plan';
import { pluralize } from './lib/format';
import { PRODUCT_NAME } from './lib/brand';

type Tab = 'calendar' | 'finals';

export default function App() {
  const ctl = usePlan();
  const [tab, setTab] = useState<Tab>('calendar');
  const [toast, setToast] = useState<string | null>(null);
  const [mapLoc, setMapLoc] = useState<{ building: string; room?: string } | null>(null);
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

  // Share/export act on whatever plan is on screen — yours, or a received one
  // you're passing along.
  const handleCopyLink = useCallback(async () => {
    const url = shareUrl(ctl.viewPlan);
    try {
      await navigator.clipboard.writeText(url);
      flash('Share link copied to clipboard');
    } catch {
      // Clipboard unavailable — expose the link via the address bar instead. The
      // hash is consumed-and-cleared on next load, so it can't pin a stale plan.
      window.history.replaceState(null, '', `#${planToHash(ctl.viewPlan)}`);
      flash('Share link is in the address bar — copy it from there');
    }
  }, [ctl.viewPlan, flash]);

  const handleExportJson = useCallback(() => {
    downloadPlanJson(ctl.viewPlan);
    flash('Plan exported as JSON');
  }, [ctl.viewPlan, flash]);

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
        `Make this your plan? Your current plan (${n} ${pluralize(n, 'course')}) will be replaced.`,
      )
    ) {
      return;
    }
    ctl.saveReceivedAsMine();
    flash('Saved as your plan — you can edit it now');
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

  const handleFocusCourse = useCallback((courseId: string) => {
    setFocusReq((prev) => ({ courseId, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

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
    <div className="app">
      <Topbar
        termLabel={ctl.viewPlan.term.label}
        units={ctl.units}
        readOnly={ctl.readOnly}
        onCopyLink={handleCopyLink}
        onExportJson={handleExportJson}
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
          onSaveAsMine={handleSaveAsMine}
          onDiscard={handleDiscardReceived}
        />
      )}
      <div className="app__body">
        <CoursePanel ctl={ctl} focus={focusReq} />

        <main className="main">
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Planner views">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'calendar'}
                className={`tab${tab === 'calendar' ? ' tab--active' : ''}`}
                onClick={() => setTab('calendar')}
              >
                <Calendar size={15} /> Calendar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'finals'}
                className={`tab${tab === 'finals' ? ' tab--active' : ''}`}
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

          {tab === 'calendar' && (
            <ConflictBanner
              weekly={ctl.weeklyConflicts}
              finals={ctl.finalConflicts}
              codeById={ctl.codeById}
            />
          )}

          {tab === 'calendar' ? (
            <CalendarGrid
              instances={ctl.instances}
              onOpenCourse={handleOpenCourse}
              onOpenLocation={(block) => {
                if (block.building) setMapLoc({ building: block.building, room: block.room });
              }}
              onFocusCourse={handleFocusCourse}
            />
          ) : (
            <FinalsView
              finals={ctl.finals}
              conflicts={ctl.finalConflicts}
              onOpenCourse={handleOpenCourse}
              onFocusCourse={handleFocusCourse}
            />
          )}
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <Check size={16} className="toast__check" /> {toast}
        </div>
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
