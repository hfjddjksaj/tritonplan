import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { makeClashPlan, makeCourse } from '../lib/fixtures';
import { emptyPlan } from '../lib/plan';
import { tssDeepLink } from '../lib/tss';
import type { TermsState } from '../lib/terms-state';
import { makeTestBoot } from '../test/boot';
import { sharedController } from './sharedController';
import { usePlan, type PlanController } from './usePlan';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CSE = 'CSE-8A|2026|2';

describe('sharedController', () => {
  describe('beside the own planner', () => {
    let root: Root;
    let boot: ReturnType<typeof makeTestBoot>;
    let own: PlanController;

    function Probe() {
      own = usePlan(boot);
      return null;
    }

    beforeEach(async () => {
      localStorage.clear();
      // Fall 2026 is still open (it archives on Dec 20), so the planner opens on it.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-06T20:00:00Z'));
      const plan = makeClashPlan();
      const terms: TermsState = {
        version: 1,
        activeTermKey: '2026|2',
        terms: {
          '2026|2': {
            term: plan.term,
            plans: { activeId: 'p', plans: [{ id: 'p', name: 'Plan', plan, createdAt: 'c', updatedAt: 'u', browsed: [] }] },
          },
        },
      };
      boot = makeTestBoot({ terms });
      root = createRoot(document.createElement('div'));
      await act(async () => root.render(createElement(Probe)));
    });
    afterEach(() => {
      act(() => root.unmount());
      boot.engine.dispose();
      vi.useRealTimers();
    });

    it('derives the same week, conflicts, exams and units from a plan as usePlan does', () => {
      const plan = makeClashPlan();
      expect(own.viewPlan).toEqual(plan);
      // The fixture really does clash, so the comparison below is not of empty lists.
      expect(own.weeklyConflicts).toHaveLength(1);
      expect(own.finalConflicts).toHaveLength(1);

      const ctl = sharedController(plan, () => {});
      expect(ctl.selectedCourses).toEqual(own.selectedCourses);
      expect(ctl.weeklyConflicts).toEqual(own.weeklyConflicts);
      expect(ctl.finalConflicts).toEqual(own.finalConflicts);
      expect(ctl.conflictedCourseIds).toEqual(own.conflictedCourseIds);
      expect(ctl.instances).toEqual(own.instances);
      expect(ctl.finals).toEqual(own.finals);
      expect(ctl.midterms).toEqual(own.midterms);
      expect(ctl.units).toBe(own.units);
      expect(ctl.codeById).toEqual(own.codeById);
      for (const e of plan.entries) expect(ctl.courseById.get(e.course.id)).toBe(e.course);
    });

    it('is the only controller that says it is shared', () => {
      expect(own.shared).toBe(false);
      expect(sharedController(makeClashPlan(), () => {}).shared).toBe(true);
    });
  });

  it('hands a section switch to the caller', () => {
    const onSelect = vi.fn();
    sharedController(makeClashPlan(), onSelect).selectOption(CSE, 'o2');
    expect(onSelect.mock.calls).toEqual([[CSE, 'o2']]);
  });

  it('makes every other edit a no-op', () => {
    const onSelect = vi.fn();
    const plan = makeClashPlan();
    const before = structuredClone(plan);
    const ctl = sharedController(plan, onSelect);
    const course = plan.entries[0]!.course;
    ctl.removeCourse(CSE);
    ctl.addCourse(makeCourse('BILD-1|2026|2'));
    ctl.addCourseWithOption(course, 'o2');
    ctl.replacePlan(emptyPlan(plan.term));
    ctl.resetPlan();
    ctl.toggleBooked(course);
    ctl.removeFromPool(CSE);
    ctl.clearBrowsed();
    expect(onSelect).not.toHaveBeenCalled();
    expect(ctl.viewPlan).toBe(plan);
    expect(plan).toEqual(before);
  });

  it('reads as a locked plan with none of the own planner around it', () => {
    const plan = makeClashPlan();
    const ctl = sharedController(plan, () => {});
    expect(ctl).toMatchObject({
      readOnly: true,
      guest: false,
      viewing: 'mine',
      received: null,
      pendingAdd: null,
      pendingAddPlans: [],
      extensionSeen: false,
      browsedNotAdded: [],
      plans: [],
    });
    expect(ctl.plan).toBe(plan);
    expect(ctl.viewPlan).toBe(plan);
    expect(ctl.bookedIds.size).toBe(0);
    expect(ctl.waitlistedIds.size).toBe(0);
    expect(ctl.tssBookedIds.size).toBe(0);
  });

  it('still opens a course in TSS', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      const course = makeClashPlan().entries[0]!.course;
      sharedController(makeClashPlan(), () => {}).openCourseInTss(course);
      expect(open).toHaveBeenCalledWith(tssDeepLink(course), '_blank', 'noopener');
    } finally {
      open.mockRestore();
    }
  });
});
