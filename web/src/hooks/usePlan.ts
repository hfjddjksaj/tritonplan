/** The app's single source of truth: the browsed course pool + the working plan, with actions. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CourseOffering,
  type PlanState,
  type SectionOption,
  courseIdsInConflicts,
  findWeeklyConflicts,
  findFinalConflicts,
} from '@triton/shared';
import sampleCourses from '../data/sample-courses.json';
import { pickHue } from '../lib/colors';
import { installBridgeListener, mergeCourses } from '../lib/bridge';
import {
  loadPlan,
  loadPlans,
  savePlans,
  loadPool,
  savePool,
  purgeSeededSamples,
  loadReceived,
  saveReceived,
  clearReceived,
  loadViewing,
  saveViewing,
  type ReceivedPlan,
  type Viewing,
} from '../lib/storage';
import {
  migratePlans,
  activePlan,
  updateActivePlan,
  mapAllPlans,
  createPlan,
  addPlan,
  renamePlan as renamePlanIn,
  duplicatePlan as duplicatePlanIn,
  deletePlan as deletePlanIn,
  switchActive,
  type PlansState,
} from '../lib/plans';
import { planFromHash } from '../lib/share';
import { openBooking, openInTss } from '../lib/tss';
import {
  buildSelectedCourses,
  emptyPlan,
  finalsSorted,
  meetingInstances,
  planUnits,
  refreshPlanEntries,
} from '../lib/plan';

// Demo seed for LOCAL DEV ONLY: stands in for courses the student has "browsed" in
// TSS so the UI isn't empty without the extension. Production ships an empty pool —
// the extension re-pushes the real pool on each load via a `courses` bridge message.
const SAMPLE = import.meta.env.DEV ? (sampleCourses as unknown as CourseOffering[]) : [];

/** Named-plans list: stored list wins, else the legacy single plan is migrated in. */
function initialPlans(): PlansState {
  return migratePlans(loadPlans(), loadPlan(), new Date().toISOString());
}

/** Seed the browsed pool from anything persisted from a prior session (+ dev samples). */
function initialPool(): CourseOffering[] {
  return mergeCourses(SAMPLE, purgeSeededSamples(loadPool() ?? []));
}

/** Append a fresh plan entry, coloring it with the next hue in the palette. */
function appendEntry(
  prev: PlanState,
  course: CourseOffering,
  selectedOptionId: string | null,
): PlanState {
  const hue = pickHue(prev.entries.length);
  return {
    ...prev,
    entries: [...prev.entries, { course, selectedOptionId, color: String(hue) }],
  };
}

export function usePlan() {
  const [pool, setPool] = useState<CourseOffering[]>(initialPool);
  const [plansState, setPlansState] = useState<PlansState>(initialPlans);
  // A plan someone else sent (share link or imported JSON). Lives in its own slot,
  // shown read-only — it can never overwrite any of the user's plans.
  const [received, setReceived] = useState<ReceivedPlan | null>(loadReceived);
  const [viewing, setViewing] = useState<Viewing>(() =>
    loadReceived() ? loadViewing() : 'mine',
  );
  const firstRun = useRef(true);

  // The plan every existing action/selector works on = the ACTIVE named plan.
  const active = activePlan(plansState);
  const plan = active.plan;
  /** Route a PlanState update into the active member of the plans list. */
  const setPlan = useCallback((update: (prev: PlanState) => PlanState) => {
    setPlansState((s) => updateActivePlan(s, update, new Date().toISOString()));
  }, []);

  const switchViewing = useCallback((v: Viewing) => {
    setViewing(v);
    saveViewing(v);
  }, []);

  // A share link's #p=… is consumed ONCE into the received slot, then stripped from
  // the address bar (leaving it would pin every reload to that snapshot). The user's
  // own plan is untouched — the shared plan opens read-only alongside it. Also runs
  // on hashchange: pasting a link into an already-open planner tab doesn't reload.
  useEffect(() => {
    const consume = () => {
      const fromHash = planFromHash(window.location.hash);
      if (!fromHash) return;
      const rec: ReceivedPlan = {
        plan: fromHash,
        source: 'link',
        receivedAt: new Date().toISOString(),
      };
      saveReceived(rec);
      setReceived(rec);
      switchViewing('received');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    consume();
    window.addEventListener('hashchange', consume);
    return () => window.removeEventListener('hashchange', consume);
  }, [switchViewing]);

  // Persist the plans list on change (skip first render so we don't clobber before load).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    savePlans(plansState);
  }, [plansState]);

  // Persist the browsed pool so the "Browsed — not yet added" list survives reloads.
  useEffect(() => {
    savePool(pool);
  }, [pool]);

  /** Add a course to the plan (default to its first option); no-op if already added. */
  const addCourse = useCallback((course: CourseOffering) => {
    setPlan((prev) => {
      if (prev.entries.some((e) => e.course.id === course.id)) return prev;
      return appendEntry(prev, course, course.options[0]?.id ?? null);
    });
  }, []);

  /**
   * Add a course with a specific option pre-selected, or — if it's already in the
   * plan — switch it to that option. Also merges the (fresh) course into the pool.
   * This is the `plan-add` path and the "+" quick-add can reuse it too.
   */
  const addCourseWithOption = useCallback((course: CourseOffering, optionId: string) => {
    setPool((prev) => mergeCourses(prev, [course]));
    setPlan((prev) => {
      const existing = prev.entries.find((e) => e.course.id === course.id);
      if (existing) {
        return {
          ...prev,
          entries: prev.entries.map((e) =>
            e.course.id === course.id ? { ...e, course, selectedOptionId: optionId } : e,
          ),
        };
      }
      return appendEntry(prev, course, optionId);
    });
  }, []);

  const removeCourse = useCallback((courseId: string) => {
    setPlan((prev) => ({
      ...prev,
      entries: prev.entries.filter((e) => e.course.id !== courseId),
    }));
  }, []);

  const selectOption = useCallback((courseId: string, optionId: string) => {
    setPlan((prev) => ({
      ...prev,
      entries: prev.entries.map((e) =>
        e.course.id === courseId ? { ...e, selectedOptionId: optionId } : e,
      ),
    }));
  }, []);

  const replacePlan = useCallback(
    (next: PlanState) => {
      // Any courses referenced by the imported plan should also exist in the pool.
      setPool((prev) => mergeCourses(prev, next.entries.map((e) => e.course)));
      setPlan(() => next);
    },
    [setPlan],
  );

  const resetPlan = useCallback(() => {
    setPlan((prev) => emptyPlan(prev.term));
  }, [setPlan]);

  // ---- named-plans management -------------------------------------------
  const switchPlan = useCallback(
    (id: string) => {
      setPlansState((s) => switchActive(s, id));
      switchViewing('mine');
    },
    [switchViewing],
  );

  const createNewPlan = useCallback(() => {
    setPlansState((s) => createPlan(s, new Date().toISOString()));
    switchViewing('mine');
  }, [switchViewing]);

  const renamePlan = useCallback((id: string, name: string) => {
    setPlansState((s) => renamePlanIn(s, id, name));
  }, []);

  const duplicatePlan = useCallback(
    (id: string) => {
      setPlansState((s) => duplicatePlanIn(s, id, new Date().toISOString()));
      switchViewing('mine');
    },
    [switchViewing],
  );

  const deletePlan = useCallback((id: string) => {
    setPlansState((s) => deletePlanIn(s, id));
  }, []);

  /** Bring in a plan someone sent (imported JSON / pasted link) — read-only view. */
  const importReceived = useCallback(
    (incoming: PlanState, source: ReceivedPlan['source']) => {
      const rec: ReceivedPlan = { plan: incoming, source, receivedAt: new Date().toISOString() };
      saveReceived(rec);
      setReceived(rec);
      switchViewing('received');
    },
    [switchViewing],
  );

  /** Replace the ACTIVE plan with the received one (destructive — caller confirms). */
  const saveReceivedAsMine = useCallback(() => {
    if (received) replacePlan(received.plan);
    clearReceived();
    setReceived(null);
    switchViewing('mine');
  }, [received, replacePlan, switchViewing]);

  /** Keep the received plan as a NEW named plan ("朋友的plan") and switch to it. */
  const saveReceivedAsNewPlan = useCallback(
    (name: string) => {
      if (!received) return;
      const incoming = received.plan;
      setPool((prev) => mergeCourses(prev, incoming.entries.map((e) => e.course)));
      setPlansState((s) => addPlan(s, incoming, name, new Date().toISOString()));
      clearReceived();
      setReceived(null);
      switchViewing('mine');
    },
    [received, switchViewing],
  );

  /** Drop the received plan and go back to my own. */
  const discardReceived = useCallback(() => {
    clearReceived();
    setReceived(null);
    switchViewing('mine');
  }, [switchViewing]);

  /**
   * Drop a browsed course from the pool. Plan entries keep their own course copy, so
   * this only affects the "Browsed — not yet added" list. A course the extension has
   * captured reappears on its next `courses` push (it's still "browsed" in TSS).
   */
  const removeFromPool = useCallback((courseId: string) => {
    setPool((prev) => prev.filter((c) => c.id !== courseId));
  }, []);

  /** Clear every browsed course that isn't in the plan. */
  const clearBrowsed = useCallback(() => {
    const added = new Set(plan.entries.map((e) => e.course.id));
    setPool((prev) => prev.filter((c) => added.has(c.id)));
  }, [plan]);

  // True once the extension's bridge has delivered anything this session — used to
  // route "open in TSS" through the extension (which can reuse an open TSS tab).
  const bridgeSeen = useRef(false);

  // Data bridge: `courses` merges into the pool; `plan-add` adds to the plan.
  useEffect(() => {
    return installBridgeListener({
      onCourses: (incoming) => {
        bridgeSeen.current = true;
        setPool((prev) => mergeCourses(prev, incoming));
        // EVERY plan holds its own course copies — refresh them all, or seat
        // counts stay frozen at whatever they were when the course was added.
        setPlansState((s) =>
          mapAllPlans(s, (p) => refreshPlanEntries(p, incoming), new Date().toISOString()),
        );
      },
      onPlanAdd: (course, optionId) => {
        bridgeSeen.current = true;
        addCourseWithOption(course, optionId);
        // Adds always land in MY plan — surface it, even if a received plan was up.
        switchViewing('mine');
      },
    });
  }, [addCourseWithOption, switchViewing]);

  /** Jump back to TSS — through the extension when present, else a plain new tab. */
  const openCourseInTss = useCallback((course: CourseOffering) => {
    openInTss(course, bridgeSeen.current);
  }, []);

  /** Open a section's booking page (the extension reuses the one booking tab). */
  const openBookingInTss = useCallback((course: CourseOffering, option: SectionOption) => {
    openBooking(course, option, bridgeSeen.current);
  }, []);

  // ---- derived view data (memoized) --------------------------------------
  // Everything the screen shows derives from the plan being VIEWED — the user's
  // own, or a received one (read-only).
  const viewPlan = viewing === 'received' && received ? received.plan : plan;
  const readOnly = viewing === 'received' && received !== null;

  const selectedCourses = useMemo(() => buildSelectedCourses(viewPlan), [viewPlan]);
  const weeklyConflicts = useMemo(() => findWeeklyConflicts(selectedCourses), [selectedCourses]);
  const finalConflicts = useMemo(() => findFinalConflicts(selectedCourses), [selectedCourses]);
  const conflictedCourseIds = useMemo(
    () => courseIdsInConflicts([...weeklyConflicts, ...finalConflicts]),
    [weeklyConflicts, finalConflicts],
  );

  const instances = useMemo(() => meetingInstances(viewPlan), [viewPlan]);
  const finals = useMemo(() => finalsSorted(viewPlan), [viewPlan]);
  const units = useMemo(() => planUnits(viewPlan), [viewPlan]);

  const codeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of viewPlan.entries) m.set(e.course.id, e.course.courseCode);
    return m;
  }, [viewPlan]);

  /** Resolve a course by id (pool + viewed plan) — used for TSS jump-back from a block. */
  const courseById = useMemo(() => {
    const m = new Map<string, CourseOffering>();
    for (const c of pool) m.set(c.id, c);
    for (const e of viewPlan.entries) m.set(e.course.id, e.course);
    return m;
  }, [pool, viewPlan]);

  /** Pool courses not yet in the plan — the "Browsed — not yet added" list. */
  const browsedNotAdded = useMemo(() => {
    const added = new Set(plan.entries.map((e) => e.course.id));
    return pool.filter((c) => !added.has(c.id));
  }, [pool, plan]);

  return {
    pool,
    plan,
    addCourse,
    addCourseWithOption,
    removeCourse,
    selectOption,
    replacePlan,
    resetPlan,
    removeFromPool,
    clearBrowsed,
    openCourseInTss,
    openBookingInTss,
    // named plans
    plans: plansState.plans,
    activePlanId: plansState.activeId,
    activePlanName: active.name,
    switchPlan,
    createNewPlan,
    renamePlan,
    duplicatePlan,
    deletePlan,
    // received plans (share links / imported JSON) — read-only companion slot
    received,
    viewing,
    viewPlan,
    readOnly,
    switchViewing,
    importReceived,
    saveReceivedAsMine,
    saveReceivedAsNewPlan,
    discardReceived,
    // derived
    selectedCourses,
    weeklyConflicts,
    finalConflicts,
    conflictedCourseIds,
    instances,
    finals,
    units,
    codeById,
    courseById,
    browsedNotAdded,
  };
}

export type PlanController = ReturnType<typeof usePlan>;
