/** The app's single source of truth: the browsed course pool + the working plan, with actions. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CourseOffering,
  type PlanState,
  courseIdsInConflicts,
  findWeeklyConflicts,
  findFinalConflicts,
} from '@triton/shared';
import sampleCourses from '../data/sample-courses.json';
import { pickHue } from '../lib/colors';
import { installBridgeListener, mergeCourses } from '../lib/bridge';
import { loadPlan, savePlan, loadPool, savePool, purgeSeededSamples } from '../lib/storage';
import { planFromHash } from '../lib/share';
import {
  DEFAULT_TERM,
  buildSelectedCourses,
  emptyPlan,
  finalsSorted,
  meetingInstances,
  planUnits,
  unscheduledItems,
} from '../lib/plan';

// Demo seed for LOCAL DEV ONLY: stands in for courses the student has "browsed" in
// TSS so the UI isn't empty without the extension. Production ships an empty pool —
// the extension re-pushes the real pool on each load via a `courses` bridge message.
const SAMPLE = import.meta.env.DEV ? (sampleCourses as unknown as CourseOffering[]) : [];

/** Prefer a shared-URL plan, then a saved plan, then an empty one. */
function initialPlan(): PlanState {
  const fromHash = planFromHash(window.location.hash);
  if (fromHash) return fromHash;
  const saved = loadPlan();
  if (saved) return saved;
  return emptyPlan(SAMPLE[0]?.term ?? DEFAULT_TERM);
}

/** Seed the browsed pool from anything persisted from a prior session (+ dev samples). */
function initialPool(): CourseOffering[] {
  return mergeCourses(SAMPLE, purgeSeededSamples(loadPool() ?? []));
}

export function usePlan() {
  const [pool, setPool] = useState<CourseOffering[]>(initialPool);
  const [plan, setPlan] = useState<PlanState>(initialPlan);
  const firstRun = useRef(true);

  // Persist the plan on change (skip first render so we don't clobber before load).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    savePlan(plan);
  }, [plan]);

  // Persist the browsed pool so the "Browsed — not yet added" list survives reloads.
  useEffect(() => {
    savePool(pool);
  }, [pool]);

  /** Add a course to the plan (default to its first option); no-op if already added. */
  const addCourse = useCallback((course: CourseOffering) => {
    setPlan((prev) => {
      if (prev.entries.some((e) => e.course.id === course.id)) return prev;
      const hue = pickHue(prev.entries.length);
      return {
        ...prev,
        entries: [
          ...prev.entries,
          { course, selectedOptionId: course.options[0]?.id ?? null, color: String(hue) },
        ],
      };
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
      const hue = pickHue(prev.entries.length);
      return {
        ...prev,
        entries: [...prev.entries, { course, selectedOptionId: optionId, color: String(hue) }],
      };
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

  const replacePlan = useCallback((next: PlanState) => {
    // Any courses referenced by the imported plan should also exist in the pool.
    setPool((prev) => mergeCourses(prev, next.entries.map((e) => e.course)));
    setPlan(next);
  }, []);

  const resetPlan = useCallback(() => {
    setPlan((prev) => emptyPlan(prev.term));
  }, []);

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

  // Data bridge: `courses` merges into the pool; `plan-add` adds to the plan.
  useEffect(() => {
    return installBridgeListener({
      onCourses: (incoming) => setPool((prev) => mergeCourses(prev, incoming)),
      onPlanAdd: (course, optionId) => addCourseWithOption(course, optionId),
    });
  }, [addCourseWithOption]);

  // ---- derived view data (memoized) --------------------------------------
  const selectedCourses = useMemo(() => buildSelectedCourses(plan), [plan]);
  const weeklyConflicts = useMemo(() => findWeeklyConflicts(selectedCourses), [selectedCourses]);
  const finalConflicts = useMemo(() => findFinalConflicts(selectedCourses), [selectedCourses]);
  const conflictedCourseIds = useMemo(
    () => courseIdsInConflicts([...weeklyConflicts, ...finalConflicts]),
    [weeklyConflicts, finalConflicts],
  );

  const instances = useMemo(() => meetingInstances(plan), [plan]);
  const unscheduled = useMemo(() => unscheduledItems(plan), [plan]);
  const finals = useMemo(() => finalsSorted(plan), [plan]);
  const units = useMemo(() => planUnits(plan), [plan]);

  const codeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of plan.entries) m.set(e.course.id, e.course.courseCode);
    return m;
  }, [plan]);

  /** Resolve a course by id (pool + plan) — used for TSS jump-back from a block. */
  const courseById = useMemo(() => {
    const m = new Map<string, CourseOffering>();
    for (const c of pool) m.set(c.id, c);
    for (const e of plan.entries) m.set(e.course.id, e.course);
    return m;
  }, [pool, plan]);

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
    // derived
    selectedCourses,
    weeklyConflicts,
    finalConflicts,
    conflictedCourseIds,
    instances,
    unscheduled,
    finals,
    units,
    codeById,
    courseById,
    browsedNotAdded,
  };
}

export type PlanController = ReturnType<typeof usePlan>;
