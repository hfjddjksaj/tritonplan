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

/* ---- message hub ------------------------------------------------------------ */

/*
 * Why a hub: planner-bridge.ts (extension) drains the "+ TritonPlan" queue exactly once at
 * document_idle and posts it into the page; after that the extension's queue is empty. The
 * planner only renders after sign-in and the account snapshot load, so listeners installed
 * by usePlan / useApptTimes come too late and the pushes would be dropped (and a Google
 * sign-in is a full-page round trip that throws away the whole page). The hub listens from
 * the first statement of main.tsx, holds what nobody has subscribed to yet, and replays it
 * on subscribe. We fix this page-side rather than in the extension because the new
 * extension build has to go to review as early as possible (Task 1).
 *
 * Snapshots (`courses`, `booked`, `appt-times`) are kept after delivery too: the planner
 * remounts when the tab comes back to newer server state, and the extension only speaks
 * again on the next page load or the next TSS capture, so the new planner must hear the
 * latest of each as the old one did. A `plan-add` is a click, delivered exactly once to the
 * signed-in planner. The signed-out planner shows the clicks too, but only keeps a copy: they
 * stay queued for the planner that can save them.
 */

export type BridgeKind = 'courses' | 'plan-add' | 'booked' | 'appt-times';

/** Queued plan-adds mirror here so they survive the sign-in page navigation (same tab). */
export const PENDING_ADDS_KEY = 'triton-planner:pending-adds:v1';

/** Queue cap for `plan-add`: keeps the latest N, so a student who never signs in does not grow memory without bound. */
const MAX_QUEUED_PER_KIND = 200;
const MAX_MIRRORED_ADDS = 50;
/** Each push of these is a full snapshot (`courses` = the extension's whole captured pool), so only the latest is worth keeping. */
type SnapshotKind = 'courses' | 'booked' | 'appt-times';
const SNAPSHOT_KINDS: readonly SnapshotKind[] = ['courses', 'booked', 'appt-times'];
const isSnapshot = (kind: BridgeKind): kind is SnapshotKind => kind !== 'plan-add';
let warnedEviction = false;

function classify(data: unknown): BridgeKind | null {
  if (isPlanAddMessage(data)) return 'plan-add';
  if (isCoursesMessage(data)) return 'courses';
  if (isBookedMessage(data)) return 'booked';
  if (isApptTimesMessage(data)) return 'appt-times';
  return null;
}

interface Queued { kind: BridgeKind; data: unknown }
/** `keep`: hears plan-adds without taking them (the signed-out planner). */
interface Subscriber { kinds: ReadonlySet<BridgeKind>; handler: (data: unknown) => void; keep: boolean }

let hubInstalled = false;
let hubListener: ((event: MessageEvent) => void) | null = null;
/** Undelivered plan-adds, in arrival order. */
let queue: Queued[] = [];
/** The latest snapshot of each kind this page load, delivered or not. */
const latest = new Map<SnapshotKind, unknown>();
const subscribers = new Set<Subscriber>();

function persistPendingAdds(): void {
  try {
    // Newest only: stays well under the sessionStorage quota.
    const adds = queue.filter((q) => q.kind === 'plan-add').map((q) => q.data).slice(-MAX_MIRRORED_ADDS);
    if (adds.length === 0) sessionStorage.removeItem(PENDING_ADDS_KEY);
    else sessionStorage.setItem(PENDING_ADDS_KEY, JSON.stringify(adds));
  } catch {
    // Private mode / blocked storage / quota: the hub keeps working in memory. Don't leave
    // a stale mirror behind (it would resurrect already-delivered adds after a reload).
    try { sessionStorage.removeItem(PENDING_ADDS_KEY); } catch { /* blocked */ }
  }
}

function restorePendingAdds(): void {
  try {
    const raw = sessionStorage.getItem(PENDING_ADDS_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    // Restored entries go first: they arrived before anything posted on this page load.
    const restored = parsed.filter(isPlanAddMessage).map((data) => ({ kind: 'plan-add' as const, data }));
    queue = [...restored, ...queue].slice(-MAX_QUEUED_PER_KIND);
  } catch {
    // Corrupt or unreadable: start empty.
  }
}

/** Returns false when the handler threw, so replay can keep the message for the next subscriber. */
function deliver(handler: (data: unknown) => void, data: unknown): boolean {
  try {
    handler(data);
    return true;
  } catch (err) {
    // One failing subscriber must not lose the rest of a replay.
    console.error('bridge subscriber threw', err);
    return false;
  }
}

function enqueue(item: Queued): void {
  queue.push(item);
  if (queue.length > MAX_QUEUED_PER_KIND) {
    queue.shift();
    if (!warnedEviction) {
      warnedEviction = true;
      console.warn(`bridge queue full for "${item.kind}"; dropping the oldest`);
    }
  }
  persistPendingAdds();
}

/** Install the page's single bridge `message` listener. Idempotent; call it before render. */
export function installBridgeHub(): void {
  if (hubInstalled) return;
  hubInstalled = true;
  restorePendingAdds();
  hubListener = (event: MessageEvent) => {
    // The extension's content script posts from this page's own window/origin; anything
    // else (iframes, other windows) is untrusted.
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || (data as { source?: unknown }).source !== BRIDGE_SOURCE) return;
    const kind = classify(data);
    if (!kind) return;
    if (isSnapshot(kind)) latest.set(kind, data);
    const targets = [...subscribers].filter((s) => s.kinds.has(kind));
    if (!isSnapshot(kind) && !targets.some((s) => !s.keep)) enqueue({ kind, data });
    for (const s of targets) deliver(s.handler, data);
  };
  window.addEventListener('message', hubListener);
}

/**
 * Subscribe to these kinds: the latest snapshot of each comes first, then queued plan-adds
 * in arrival order (removed, so each click is delivered once), then live messages. Plan-adds
 * nobody takes keep queueing. With `keep`, plan-adds are heard but stay queued, queued ones
 * included. Returns the unsubscribe function.
 */
export function subscribeBridge(
  kinds: BridgeKind[],
  handler: (data: unknown) => void,
  { keep = false }: { keep?: boolean } = {},
): () => void {
  const sub: Subscriber = { kinds: new Set(kinds), handler, keep };
  subscribers.add(sub);
  for (const kind of SNAPSHOT_KINDS) {
    if (!sub.kinds.has(kind) || !latest.has(kind) || !subscribers.has(sub)) continue;
    deliver(handler, latest.get(kind));
  }
  const unsubscribe = () => {
    subscribers.delete(sub);
  };
  if (!sub.kinds.has('plan-add')) return unsubscribe;
  if (keep) {
    for (const q of [...queue]) {
      if (!subscribers.has(sub)) break;
      deliver(handler, q.data);
    }
    return unsubscribe;
  }
  const replay = queue;
  queue = [];
  // Entries stay mirrored in sessionStorage until the loop ends: a handler that throws or
  // unsubscribes mid-replay must not cost the student a queued "+ TritonPlan" click.
  const undelivered: Queued[] = [];
  for (const q of replay) {
    if (!subscribers.has(sub) || !deliver(handler, q.data)) undelivered.push(q);
  }
  queue = [...undelivered, ...queue]; // back to the front, in original order
  if (replay.length > 0) persistPendingAdds();
  return unsubscribe;
}

/** Test seam: forget everything, as a full page reload would (sessionStorage is left alone). */
export function resetBridgeHubForTests(): void {
  if (hubListener) window.removeEventListener('message', hubListener);
  hubListener = null;
  hubInstalled = false;
  queue = [];
  latest.clear();
  warnedEviction = false;
  subscribers.clear();
}

/** Same-window/same-origin listener for `appt-times` pushes. Separate from
 *  installBridgeListener so the appt hook subscribes independently of usePlan. */
export function installApptTimesListener(
  onApptTimes: (appt: ApptTimes[]) => void,
): () => void {
  if (hubInstalled) {
    return subscribeBridge(['appt-times'], (data) => {
      if (isApptTimesMessage(data)) onApptTimes(data.payload);
    });
  }
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
  // The remembered snapshot must forget them too, or a remounted planner would get them back.
  const kept = latest.get('courses');
  if (isCoursesMessage(kept)) {
    const gone = new Set(moduleIds);
    latest.set('courses', { ...kept, payload: kept.payload.filter((c) => !gone.has(c.moduleId)) });
  }
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
 * `keep`: the signed-out planner, which leaves every plan-add queued for after sign-in.
 */
export function installBridgeListener(handlers: BridgeHandlers, { keep = false }: { keep?: boolean } = {}): () => void {
  const dispatch = (data: unknown) => {
    if (isPlanAddMessage(data)) {
      handlers.onPlanAdd(data.payload.course, data.payload.selectedOptionId);
    } else if (isCoursesMessage(data)) {
      handlers.onCourses(data.payload);
    } else if (isBookedMessage(data)) {
      handlers.onBooked?.(data.payload, data.capturedAt, data.captured);
    }
  };
  if (hubInstalled) return subscribeBridge(['plan-add', 'courses', 'booked'], dispatch, { keep });
  const handler = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    dispatch(event.data);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
