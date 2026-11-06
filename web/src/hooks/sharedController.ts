/**
 * The planner controller for a plan opened from a share link. Anyone with the link
 * may switch a course to another of its sections — that switch goes to `onSelect`,
 * which owns syncing it — and nothing else changes the plan. None of the own
 * planner's world exists here: no other plans or terms, no browsed pool, no
 * bookings, no extension. Pure, so callers memoize it on the plan.
 */
import { courseIdsInConflicts, findFinalConflicts, findWeeklyConflicts, type PlanState } from '@triton/shared';
import {
  buildSelectedCourses,
  codesById,
  coursesById,
  finalsSorted,
  meetingInstances,
  midtermsSorted,
  planUnits,
} from '../lib/plan';
import { termKey } from '../lib/terms';
import { openBooking, openInTss } from '../lib/tss';
import type { PlanController } from './usePlan';

const noop = () => {};

export function sharedController(
  plan: PlanState,
  onSelect: (courseId: string, optionId: string) => void,
): PlanController {
  const selectedCourses = buildSelectedCourses(plan);
  const weeklyConflicts = findWeeklyConflicts(selectedCourses);
  const finalConflicts = findFinalConflicts(selectedCourses);
  const key = termKey(plan.term);
  return {
    pool: [],
    plan,
    addCourse: noop,
    addCourseWithOption: noop,
    removeCourse: noop,
    selectOption: onSelect,
    replacePlan: noop,
    resetPlan: noop,
    removeFromPool: noop,
    clearBrowsed: noop,
    // Bookings are the viewer's own and never travel with a plan.
    bookedIds: new Set(),
    waitlistedIds: new Set(),
    tssBookedIds: new Set(),
    enrolledEventIds: new Map(),
    bookedOptionCodes: new Map(),
    bookedSynced: false,
    bookedAt: null,
    bookedRows: [],
    extensionSeen: false,
    checkBookings: noop,
    toggleBooked: noop,
    // Leaving for TSS only opens a tab. Never through the extension: a shared page doesn't talk to it.
    openCourseInTss: (course) => openInTss(course),
    openBookingInTss: (course, option) => {
      openBooking(course, option);
    },
    activeTermKey: key,
    termsState: { version: 1, activeTermKey: key, terms: {} },
    termList: [],
    archived: false,
    switchTerm: noop,
    upcomingTerm: null,
    createTerm: noop,
    pendingAdd: null,
    pendingAddPlans: [],
    confirmPendingAdd: noop,
    cancelPendingAdd: noop,
    plans: [],
    activePlanId: '',
    activePlanName: '',
    switchPlan: noop,
    createNewPlan: noop,
    renamePlan: noop,
    duplicatePlan: noop,
    deletePlan: noop,
    received: null,
    viewing: 'mine',
    viewPlan: plan,
    readOnly: true,
    guest: false,
    shared: true,
    switchViewing: noop,
    saveReceivedAsMine: noop,
    saveReceivedAsNewPlan: noop,
    discardReceived: noop,
    selectedCourses,
    weeklyConflicts,
    finalConflicts,
    conflictedCourseIds: courseIdsInConflicts([...weeklyConflicts, ...finalConflicts]),
    instances: meetingInstances(plan),
    finals: finalsSorted(plan),
    midterms: midtermsSorted(plan),
    units: planUnits(plan),
    codeById: codesById(plan),
    courseById: coursesById([], plan),
    browsedNotAdded: [],
  };
}
