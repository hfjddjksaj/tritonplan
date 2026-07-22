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
import type { BridgeMessage, CourseOffering } from '@triton/shared';

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
    merged.push(incomingById.get(existing.id) ?? existing);
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

export interface BridgeHandlers {
  /** A `courses` message: merge these offerings into the browsed pool. */
  onCourses: (courses: CourseOffering[]) => void;
  /** A `plan-add` message: add this course to the plan with the given option selected. */
  onPlanAdd: (course: CourseOffering, selectedOptionId: string) => void;
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
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
