import { useCallback, useEffect, useState } from 'react';
import { usePlan } from './hooks/usePlan';
import { Topbar } from './components/Topbar';
import { CoursePanel } from './components/CoursePanel';
import { CalendarGrid } from './components/CalendarGrid';
import { FinalsView } from './components/FinalsView';
import { ConflictBanner } from './components/ConflictBanner';
import { BuildingPopover } from './components/BuildingPopover';
import { Calendar, Cap, Check } from './components/icons';
import { downloadPlanJson, parsePlanJson, planToHash, shareUrl } from './lib/share';
import { countConflictPairs } from './lib/plan';
import { PRODUCT_NAME } from './lib/brand';

type Tab = 'calendar' | 'finals';

export default function App() {
  const ctl = usePlan();
  const [tab, setTab] = useState<Tab>('calendar');
  const [toast, setToast] = useState<string | null>(null);
  const [mapLoc, setMapLoc] = useState<{ building: string; room?: string } | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const handleShare = useCallback(async () => {
    const url = shareUrl(ctl.plan);
    // keep the address bar in sync so a copy/paste or bookmark also works
    window.history.replaceState(null, '', `#${planToHash(ctl.plan)}`);
    try {
      await navigator.clipboard.writeText(url);
      flash('Share link copied to clipboard');
    } catch {
      flash('Share link is in the address bar');
    }
  }, [ctl.plan, flash]);

  const handleExport = useCallback(() => {
    downloadPlanJson(ctl.plan);
    flash('Plan exported as JSON');
  }, [ctl.plan, flash]);

  const handleImport = useCallback(
    (text: string) => {
      const plan = parsePlanJson(text);
      if (!plan) {
        flash(`That file isn’t a valid ${PRODUCT_NAME} plan`);
        return;
      }
      ctl.replacePlan(plan);
      flash('Plan imported');
    },
    [ctl, flash],
  );

  const handleOpenCourse = useCallback(
    (courseId: string) => {
      const course = ctl.courseById.get(courseId);
      if (course) ctl.openCourseInTss(course);
    },
    [ctl.courseById, ctl.openCourseInTss],
  );

  const handleReset = useCallback(() => {
    if (ctl.plan.entries.length === 0) return;
    if (window.confirm('Remove every course from the plan? Browsed courses stay.')) {
      ctl.resetPlan();
      flash('Plan cleared');
    }
  }, [ctl, flash]);

  const conflictCount = countConflictPairs(ctl.weeklyConflicts, ctl.finalConflicts);

  return (
    <div className="app">
      <Topbar
        termLabel={ctl.plan.term.label}
        units={ctl.units}
        onShare={handleShare}
        onExport={handleExport}
        onImportText={handleImport}
        onReset={handleReset}
      />
      <div className="app__body">
        <CoursePanel ctl={ctl} unscheduled={ctl.unscheduled} />

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
            <span className="toolbar__hint">
              {conflictCount > 0
                ? `${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`
                : ctl.selectedCourses.length > 0
                  ? 'No conflicts — looks clear'
                  : 'Bring in a course to begin'}
            </span>
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
            />
          ) : (
            <FinalsView
              finals={ctl.finals}
              conflicts={ctl.finalConflicts}
              onOpenCourse={handleOpenCourse}
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
