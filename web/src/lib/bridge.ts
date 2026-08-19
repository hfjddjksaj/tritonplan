/**
 * Data bridge: the TritonPlan browser extension (extension/src/content/planner-bridge.ts)
 * passively captures courses the student browses in TSS and postMessages them into this
 * page. Two message kinds:
 *
 *  - `courses`  — pool-merge only. Feeds the "Browsed — not yet added" list.
 *  - `plan-add` — the primary add path: the student clicked "+ TritonPlan" on a specific
 *                 section in TSS. Merges the course AND drops the chosen option onto the grid.
 *
 * Implemented to the shared BridgeMessage contract (for `courses`) plus the `plan-add`
 * envelope below — the extension targets these exact shapes.
 */
import type { ApptTimes, BridgeMessage, BookedModule, CourseOffering } from '@triton/shared';
import { isApptTimesList } from './storage';
import { foldCourse } from './course-merge';

export const BRIDGE_SOURCE = 'triton-planner-extension';

/** Envelope for a passive "add this exact section" event from TSS. */
export interface PlanAddMessage {
  source: typeof BRIDGE_SOURCE;
  type: 'plan-add';
  version: 1;
  payload: { course: CourseOffering; selectedOptionId: string };
}

/** Validate a `courses` pool-merge envelope. */
export function isCoursesMessage(data: unknown): data is BridgeMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return (
    m.source === BRIDGE_SOURCE &&
    m.type === 'courses' &&
    m.version === 1 &&
    Array.isArray(m.payload)
  );
}

/** Back-compat alias — `courses` is the original BridgeMessage type. */
export const isBridgeMessage = isCoursesMessage;

/** Validate a `plan-add` envelope, including its nested course + option id. */
export function isPlanAddMessage(data: unknown): data is PlanAddMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  if (m.source !== BRIDGE_SOURCE || m.type !== 'plan-add' || m.version !== 1) return false;
  const p = m.payload as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return false;
  const course = p.course as Record<string, unknown> | undefined;
  return (
    typeof p.selectedOptionId === 'string' &&
    !!course &&
    typeof course === 'object' &&
    typeof course.id === 'string' &&
    Array.isArray(course.options)
  );
}

/** Envelope for the student's own appointment times (personal — never part of plans). */
export interface ApptTimesMessage {
  source: typeof BRIDGE_SOURCE;
  type: 'appt-times';
  version: 1;
  payload: ApptTimes[];
}

/** Validate an `appt-times` envelope (payload shape-checked per item). */
export function isApptTimesMessage(data: unknown): data is ApptTimesMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  if (m.source !== BRIDGE_SOURCE || m.type !== 'appt-times' || m.version !== 1) return false;
  return isApptTimesList(m.payload);
}

/** Envelope for the student's own booked (enrolled) modules. An EMPTY payload is
 *  meaningful — a captured feed with zero bookings clears the auto list. */
export interface BookedMessage {
  source: typeof BRIDGE_SOURCE;
  type: 'booked';
  version: 1;
  payload: BookedModule[];
  /** When TSS last reported this list. Optional: extensions before 1.1.1 don't send
   *  it, and the page must keep working (just without a freshness reading). */
  capturedAt?: string;
  /**
   * Whether the extension holds a capture at all. `false` means TSS has never reported
   * to it, and the page must forget any sync it remembers rather than keep asserting
   * one — the two sides drifted apart precisely because an extension with nothing to
   * say used to stay silent. Absent on extensions before 1.1.1, which only ever spoke
   * when they did hold a capture, so absent reads as `true`.
   */
  captured?: boolean;
}

function isBookedModule(v: unknown): v is BookedModule {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  const t = m.term as Record<string, unknown> | undefined;
  return (
    typeof m.courseCode === 'string' &&
    typeof m.moduleId === 'string' &&
    !!t && typeof t === 'object' &&
    typeof t.year === 'string' && typeof t.period === 'string' && typeof t.label === 'string'
  );
}

export function isBookedMessage(data: unknown): data is BookedMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return (
    m.source === BRIDGE_SOURCE &&
    m.type === 'booked' &&
    m.version === 1 &&
    Array.isArray(m.payload) &&
    m.payload.every(isBookedModule)
  );
}

/** Same-window/same-origin listener for `appt-times` pushes. Separate from
 *  installBridgeListener so the appt hook subscribes independently of usePlan. */
export function installApptTimesListener(
  onApptTimes: (appt: ApptTimes[]) => void,
): () => void {
  const handler = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (isApptTimesMessage(event.data)) onApptTimes(event.data.payload);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/**
 * Merge incoming offerings into an existing pool, de-duplicating by course id.
 * Incoming offerings replace existing ones with the same id (fresher scrape wins);
 * order is preserved with existing courses first, then genuinely new ones.
 */
export function mergeCourses(
  pool: CourseOffering[],
  incoming: CourseOffering[],
): CourseOffering[] {
  const incomingById = new Map<string, CourseOffering>();
  for (const c of incoming) incomingById.set(c.id, c);

  const seen = new Set<string>();
  const merged: CourseOffering[] = [];

  for (const existing of pool) {
    const fresh = incomingById.get(existing.id);
    // Fold, don't replace — see course-merge.ts for what a partial capture drops.
    merged.push(fresh ? foldCourse(existing, fresh) : existing);
    seen.add(existing.id);
  }
  for (const c of incoming) {
    if (!seen.has(c.id)) {
      merged.push(c);
      seen.add(c.id);
    }
  }
  return merged;
}

/* ---- page → extension requests -------------------------------------------- */

/** Envelope source for requests this page posts TO the extension's content script. */
export const PAGE_BRIDGE_SOURCE = 'triton-planner-page';

/** Ask the extension to open/focus a course in TSS (reusing an open TSS tab). */
export interface OpenTssMessage {
  source: typeof PAGE_BRIDGE_SOURCE;
  type: 'open-tss';
  version: 1;
  payload: { url: string; moduleId: string };
}

/** Post an open-tss request for the extension's content script (same window/origin). */
export function postOpenTss(url: string, moduleId: string): void {
  const msg: OpenTssMessage = {
    source: PAGE_BRIDGE_SOURCE,
    type: 'open-tss',
    version: 1,
    payload: { url, moduleId },
  };
  window.postMessage(msg, window.location.origin);
}

/**
 * Ask the extension to open the TSS home page — the planner's "check my bookings".
 * Routed through the extension so a TSS tab already sitting on the home page is
 * reused and reloaded, rather than piling up a new tab per check.
 */
export interface OpenTssHomeMessage {
  source: typeof PAGE_BRIDGE_SOURCE;
  type: 'open-tss-home';
  version: 1;
  payload: { url: string };
}

export function postOpenTssHome(url: string): void {
  const msg: OpenTssHomeMessage = {
    source: PAGE_BRIDGE_SOURCE,
    type: 'open-tss-home',
    version: 1,
    payload: { url },
  };
  window.postMessage(msg, window.location.origin);
}

/** Ask the extension to open a section's booking page, reusing the one booking tab. */
export interface OpenBookingMessage {
  source: typeof PAGE_BRIDGE_SOURCE;
  type: 'open-booking';
  version: 1;
  payload: { url: string };
}

/** Post an open-booking request for the extension's content script. */
export function postOpenBooking(url: string): void {
  const msg: OpenBookingMessage = {
    source: PAGE_BRIDGE_SOURCE,
    type: 'open-booking',
    version: 1,
    payload: { url },
  };
  window.postMessage(msg, window.location.origin);
}

/** Ask the extension to permanently drop captured data for these courses, so a
 *  removed browsed course doesn't come back on the extension's next push. */
export interface ForgetCoursesMessage {
  source: typeof PAGE_BRIDGE_SOURCE;
  type: 'forget-courses';
  version: 1;
  payload: { moduleIds: string[] };
}

/** Post a forget-courses request (extension ≥1.0.2 handles it). Used by the
 *  archive sweep to release captured data for terms that are over. */
export function postForgetCourses(moduleIds: string[]): void {
  if (moduleIds.length === 0) return;
  const msg: ForgetCoursesMessage = {
    source: PAGE_BRIDGE_SOURCE,
    type: 'forget-courses',
    version: 1,
    payload: { moduleIds },
  };
  window.postMessage(msg, window.location.origin);
}

export interface BridgeHandlers {
  /** A `courses` message: merge these offerings into the browsed pool. */
  onCourses: (courses: CourseOffering[]) => void;
  /** A `plan-add` message: add this course to the plan with the given option selected. */
  onPlanAdd: (course: CourseOffering, selectedOptionId: string) => void;
  /** A `booked` message: update the student's enrolled modules. `capturedAt` is absent
   *  on pushes from extensions that predate it; `captured` false means the extension
   *  holds no capture, so any remembered sync is stale and must go. */
  onBooked?: (rows: BookedModule[], capturedAt?: string, captured?: boolean) => void;
}

/**
 * Listen for bridge messages on the window. Returns an unsubscribe function.
 * Only same-window, same-origin messages matching a known contract invoke the
 * corresponding callback — the extension's content script posts from this page's
 * own window/origin, so anything else (iframes, other windows) is untrusted.
 */
export function installBridgeListener(handlers: BridgeHandlers): () => void {
  const handler = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (isPlanAddMessage(event.data)) {
      handlers.onPlanAdd(event.data.payload.course, event.data.payload.selectedOptionId);
    } else if (isCoursesMessage(event.data)) {
      handlers.onCourses(event.data.payload);
    } else if (isBookedMessage(event.data)) {
      handlers.onBooked?.(event.data.payload, event.data.capturedAt, event.data.captured);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
