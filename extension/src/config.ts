/**
 * Central config + branding for the TritonPlan extension.
 *
 * ⛔ NO-BAN RED LINE: nothing here ever triggers a TSS request. These are just
 * constants shared by the background worker, content scripts and popup.
 */

/** Product/brand name. The injected button reads `+ ${PRODUCT_NAME}` → "+ TritonPlan". */
export const PRODUCT_NAME = 'TritonPlan';

/**
 * The planner website. Production is GitHub Pages (a PROJECT site, so it lives under
 * the `/tritonplan/` subpath). Dev builds (`node build.mjs --dev`) target the local
 * Vite server instead: build.mjs `define`s the two globals below as string literals
 * (so a production bundle never even contains the localhost URL) and injects the
 * localhost matches into the dist manifest — the source manifest.json stays
 * production-only. Under plain tsc/vitest there is no define; the `typeof` guards
 * fall back to the production values there.
 */
declare const __PLANNER_URL__: string | undefined;
declare const __PLANNER_MATCH__: string | undefined;

/** Concrete URL opened/focused for the planner tab. */
export const PLANNER_URL =
  typeof __PLANNER_URL__ !== 'undefined'
    ? __PLANNER_URL__
    : 'https://hfjddjksaj.github.io/tritonplan/';

/** Match pattern for chrome.tabs.query (kept in sync with the manifest content-script glob). */
export const PLANNER_MATCH =
  typeof __PLANNER_MATCH__ !== 'undefined'
    ? __PLANNER_MATCH__
    : 'https://hfjddjksaj.github.io/tritonplan/*';

/**
 * window.postMessage channel used by the MAIN-world interceptor → isolated relay.
 * MUST stay byte-identical to `CHANNEL` in content/interceptor.ts.
 */
export const ODATA_CAPTURE_CHANNEL = 'triton-planner:odata-capture';

/** The page-facing bridge contract the planner website validates (see web/src/lib/bridge.ts). */
export const BRIDGE_SOURCE = 'triton-planner-extension';
export const BRIDGE_VERSION = 1 as const;

/** Envelope source for requests the planner PAGE posts to us (see web bridge `postOpenTss`). */
export const PAGE_BRIDGE_SOURCE = 'triton-planner-page';

/** The only origin the open-tss handler will ever navigate to. */
export const TSS_URL_PREFIX = 'https://tss.ucsd.edu/';

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
  /** planner-bridge → SW: focus/reuse an open TSS tab for a course (else open one). */
  OPEN_TSS: 'tp:open-tss',
  /** planner-bridge → SW: open a booking page, reusing the one booking tab. */
  OPEN_BOOKING: 'tp:open-booking',
  /** SW → planner-bridge (via tabs.sendMessage): re-push courses + queued plan-adds. */
  FLUSH: 'tp:flush',
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

/** A queued "add this exact section" intent (persisted so it survives SW eviction). */
export interface PlanAddIntent {
  course: import('@triton/shared').CourseOffering;
  selectedOptionId: string;
}
