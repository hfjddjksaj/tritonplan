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
  MSG,
  PAGE_BRIDGE_SOURCE,
  TSS_URL_PREFIX,
  type PlanAddIntent,
} from '../config.js';
import type { CourseOffering } from '@triton/shared';

/**
 * postMessage targetOrigin: always this page's own origin, never '*'. The manifest
 * only injects this script on allowed planner origins (GitHub Pages; plus localhost
 * in --dev builds), so location.origin is by construction one of those — and the page
 * listener (web/src/lib/bridge.ts) verifies the same-origin/same-window pair.
 */
const TARGET_ORIGIN = window.location.origin;

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
      TARGET_ORIGIN,
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
        TARGET_ORIGIN,
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

// Page → extension: "open this course/booking in TSS". The SW focuses/reuses an
// existing TSS tab instead of the page spawning a new one per click.
// This is user-driven navigation only — nothing is fetched or automated.
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const d = event.data as
    | { source?: unknown; type?: unknown; version?: unknown; payload?: { url?: unknown; moduleId?: unknown } }
    | null;
  if (!d || d.source !== PAGE_BRIDGE_SOURCE || d.version !== 1) return;
  if (d.type !== 'open-tss' && d.type !== 'open-booking') return;
  const url = d.payload?.url;
  if (typeof url !== 'string' || !url.startsWith(TSS_URL_PREFIX)) return;
  const moduleId = typeof d.payload?.moduleId === 'string' ? d.payload.moduleId : '';
  const type = d.type === 'open-tss' ? MSG.OPEN_TSS : MSG.OPEN_BOOKING;
  try {
    void chrome.runtime.sendMessage({ type, url, moduleId }).catch(() => {
      // SW unreachable — degrade to a plain new tab (may be popup-blocked; best effort).
      window.open(url, '_blank', 'noopener');
    });
  } catch {
    window.open(url, '_blank', 'noopener');
  }
});

// On load: feed the pool + deliver anything queued (e.g. the click that opened this tab).
void syncAll();
