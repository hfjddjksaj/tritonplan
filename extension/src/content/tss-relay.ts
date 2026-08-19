/**
 * tss-relay — ISOLATED-world content script on TSS.
 *
 * ⛔ NO-BAN RED LINE: this only READS window messages the MAIN-world interceptor
 * already posted (data the page itself fetched). It NEVER issues a request. Its sole
 * job is to hand each captured OData body to the background worker for storage.
 *
 * We do NOT import interceptor.ts here (that would re-run its fetch/XHR hook in the
 * isolated world). We only reuse the shared channel string constant.
 */

import { ODATA_CAPTURE_CHANNEL, MSG } from '../config.js';

interface CaptureMessage {
  __tritonPlanner: true;
  channel: string;
  url: string;
  status: number;
  body: string;
}

function isCaptureMessage(d: unknown): d is CaptureMessage {
  return (
    !!d &&
    typeof d === 'object' &&
    (d as { __tritonPlanner?: unknown }).__tritonPlanner === true &&
    (d as { channel?: unknown }).channel === ODATA_CAPTURE_CHANNEL &&
    typeof (d as { body?: unknown }).body === 'string'
  );
}

/**
 * TEMPORARY diagnostic (2026-08-19) — remove once the homepage booked feed is
 * confirmed on a live account.
 *
 * The feed reaches the store or it doesn't, and from the outside those two failures
 * look the same. This prints, to the TSS page's own console, WHAT arrived: which OData
 * services answered, whether booked rows were in there, and whether they carried the
 * term fields. Nothing here leaves the page — it is a console.log, not a request — and
 * it names only field/service names, never a value.
 */
const BOOKED_HINT = /BC_OVP_BOOKED_MODULES_SRV|"SmShort"/;
const ENTITY_TYPE_RE = /"type"\s*:\s*"([^"]+)"/g;

function probe(url: string, body: string): void {
  if (!BOOKED_HINT.test(url) && !BOOKED_HINT.test(body)) return;
  const types = new Set<string>();
  ENTITY_TYPE_RE.lastIndex = 0;
  for (let m = ENTITY_TYPE_RE.exec(body); m !== null; m = ENTITY_TYPE_RE.exec(body)) {
    types.add(m[1]!);
  }
  const count = (needle: string): number => body.split(needle).length - 1;
  console.log('[TritonPlan] booked probe', {
    url: url.replace(/^https?:\/\/[^/]+/, ''),
    head: body.slice(0, 40),
    bytes: body.length,
    entityTypes: [...types],
    SmShort: count('"SmShort"'),
    AcademicYear: count('"AcademicYear"'),
    AcademicSession: count('"AcademicSession"'),
    SmObjid: count('"SmObjid"'),
    ModregId: count('"ModregId"'),
  });
}

window.addEventListener('message', (event: MessageEvent) => {
  // Only accept same-window, same-origin posts from our interceptor.
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!isCaptureMessage(data)) return;
  if (!data.body) return;
  try {
    probe(data.url, data.body);
  } catch {
    /* a diagnostic must never break the capture path */
  }

  // Forward to the service worker; fire-and-forget (ignore the ack). The URL rides
  // along so the store can tell a paged continuation ($skip>0) from a fresh browse.
  try {
    void chrome.runtime
      .sendMessage({ type: MSG.INGEST, body: data.body, url: data.url })
      .catch(() => {});
  } catch {
    /* extension context may be gone (reload) — never throw into the page */
  }
});
