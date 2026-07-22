/**
 * Central config + branding for the TritonPlan extension.
 *
 * ⛔ NO-BAN RED LINE: nothing here ever triggers a TSS request. These are just
 * constants shared by the background worker, content scripts and popup.
 */

/** Product/brand name. The injected button reads `+ ${PRODUCT_NAME}` → "+ TritonPlan". */
export const PRODUCT_NAME = 'TritonPlan';

/**
 * The planner website — deployed to GitHub Pages (a PROJECT site, so it lives under the
 * `/tritonplan/` subpath). The extension posts captured data to PLANNER_ORIGIN only
 * (never `'*'`) and opens/focuses a tab at PLANNER_URL.
 *
 * ORIGIN is scheme+host only (postMessage targetOrigin); URL/MATCH include the subpath.
 * Keep the manifest.json planner-bridge `content_scripts[].matches` and `host_permissions`
 * in sync with PLANNER_MATCH (manifest is strict JSON, so no comment there).
 * For local dev, temporarily set these three back to `http://localhost:5173`.
 */
export const PLANNER_ORIGIN = 'https://hfjddjksaj.github.io';

/** Concrete URL opened/focused for the planner tab (GitHub Pages project subpath). */
export const PLANNER_URL = 'https://hfjddjksaj.github.io/tritonplan/';

/** Match pattern for chrome.tabs.query (kept in sync with the manifest content-script glob). */
export const PLANNER_MATCH = 'https://hfjddjksaj.github.io/tritonplan/*';

/**
 * window.postMessage channel used by the MAIN-world interceptor → isolated relay.
 * MUST stay byte-identical to `CHANNEL` in content/interceptor.ts.
 */
export const ODATA_CAPTURE_CHANNEL = 'triton-planner:odata-capture';

/** The page-facing bridge contract the planner website validates (see web/src/lib/bridge.ts). */
export const BRIDGE_SOURCE = 'triton-planner-extension';
export const BRIDGE_VERSION = 1 as const;

/** Internal chrome.runtime message types (extension-internal only). */
export const MSG = {
  /** relay → SW: one captured OData body to ingest + persist. */
  INGEST: 'tp:ingest',
  /** any → SW: return the captured CourseOffering[]. */
  GET_COURSES: 'tp:get-courses',
  /** tss-inject → SW: student clicked "+ TritonPlan" on a section. */
  PLAN_ADD: 'tp:plan-add',
  /** popup → SW: open/focus the planner tab. */
  OPEN_PLANNER: 'tp:open-planner',
  /** planner-bridge → SW: atomically read+clear queued plan-adds. */
  DRAIN_PLAN_ADDS: 'tp:drain-plan-adds',
  /** SW → planner-bridge (via tabs.sendMessage): re-push courses + queued plan-adds. */
  FLUSH: 'tp:flush',
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

/** A queued "add this exact section" intent (persisted so it survives SW eviction). */
export interface PlanAddIntent {
  course: import('@triton/shared').CourseOffering;
  selectedOptionId: string;
}
