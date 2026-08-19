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

window.addEventListener('message', (event: MessageEvent) => {
  // Only accept same-window, same-origin posts from our interceptor.
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!isCaptureMessage(data)) return;
  if (!data.body) return;

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
