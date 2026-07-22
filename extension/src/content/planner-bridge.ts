/**
 * planner-bridge — ISOLATED-world content script on the PLANNER website origin.
 *
 * Bridges captured TSS data into the planner page using the exact contract the page
 * validates (see web/src/lib/bridge.ts):
 *   - `courses`   — re-push the whole captured pool on every planner load.
 *   - `plan-add`  — deliver any queued "+ TritonPlan" intents.
 *
 * ⛔ NO-BAN RED LINE: touches ONLY our own extension + our own page. No TSS traffic.
 */

import {
  BRIDGE_SOURCE,
  BRIDGE_VERSION,
  PLANNER_ORIGIN,
  MSG,
  type PlanAddIntent,
} from '../config.js';
import type { CourseOffering } from '@triton/shared';

/** Post the full captured pool to the page (targeted origin, never '*'). */
async function pushCourses(): Promise<void> {
  try {
    const courses = await chrome.runtime.sendMessage({ type: MSG.GET_COURSES });
    if (!Array.isArray(courses)) return;
    window.postMessage(
      {
        source: BRIDGE_SOURCE,
        type: 'courses',
        version: BRIDGE_VERSION,
        payload: courses as CourseOffering[],
      },
      PLANNER_ORIGIN,
    );
  } catch {
    /* SW asleep or context gone */
  }
}

/** Drain queued plan-add intents from the SW and deliver each to the page. */
async function flushPlanAdds(): Promise<void> {
  try {
    const items = await chrome.runtime.sendMessage({ type: MSG.DRAIN_PLAN_ADDS });
    if (!Array.isArray(items)) return;
    for (const it of items as PlanAddIntent[]) {
      if (!it || !it.course || typeof it.selectedOptionId !== 'string') continue;
      window.postMessage(
        {
          source: BRIDGE_SOURCE,
          type: 'plan-add',
          version: BRIDGE_VERSION,
          payload: { course: it.course, selectedOptionId: it.selectedOptionId },
        },
        PLANNER_ORIGIN,
      );
    }
  } catch {
    /* ignore */
  }
}

async function syncAll(): Promise<void> {
  await pushCourses();
  await flushPlanAdds();
}

// The SW pings us when a new plan-add arrives while this tab is already open.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === MSG.FLUSH) void syncAll();
});

// On load: feed the pool + deliver anything queued (e.g. the click that opened this tab).
void syncAll();
