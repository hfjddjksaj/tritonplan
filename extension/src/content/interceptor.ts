/**
 * PASSIVE OData interceptor — runs in the PAGE's MAIN world on TSS.
 *
 * ⛔ NO-BAN RED LINE (see docs/tss-recon + plan): this file must be a pure PASSIVE
 * OBSERVER. It only wraps fetch/XHR to READ responses the TSS page ALREADY requested,
 * via `response.clone()`. It MUST NEVER:
 *   - issue, replay, retry, or modify any request,
 *   - poll, prefetch, or call OData endpoints itself,
 *   - touch anything the page wasn't already going to fetch.
 * From the server's view, traffic is byte-for-byte identical to a normal student.
 * The only outward action is `window.postMessage` to our own isolated content script.
 *
 * MAIN-world content scripts cannot use chrome.* APIs, so we hand captures to the
 * isolated relay via window.postMessage; the relay does the chrome.storage work.
 */

const CHANNEL = 'triton-planner:odata-capture';

interface CapturePayload {
  __tritonPlanner: true;
  channel: typeof CHANNEL;
  url: string;
  status: number;
  body: string;
}

function isOData(url: string): boolean {
  return typeof url === 'string' && url.indexOf('/odata') !== -1;
}

function emit(url: string, status: number, body: string): void {
  if (!body) return;
  const msg: CapturePayload = { __tritonPlanner: true, channel: CHANNEL, url, status, body };
  // Only ever posts to our own extension relay; carries page data we already saw.
  window.postMessage(msg, window.location.origin);
}

function install(): void {
  const w = window as unknown as { __tritonPlannerHooked?: boolean };
  if (w.__tritonPlannerHooked) return;
  w.__tritonPlannerHooked = true;

  // fetch: clone the resolved response (never re-issue) and read the clone.
  const originalFetch = window.fetch;
  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    const promise = originalFetch.apply(this, args as never);
    promise
      .then((res) => {
        try {
          if (res && isOData(res.url)) {
            res
              .clone()
              .text()
              .then((t) => emit(res.url, res.status, t))
              .catch(() => {});
          }
        } catch {
          /* observation must never break the page */
        }
      })
      .catch(() => {});
    return promise;
  } as typeof fetch;

  // XHR: read responseText on load; do not alter the request.
  const OpenXHR = XMLHttpRequest.prototype.open;
  const SendXHR = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest & { __tpUrl?: string },
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this.__tpUrl = typeof url === 'string' ? url : url.toString();
    // @ts-expect-error passthrough
    return OpenXHR.call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest & { __tpUrl?: string },
    ...args: unknown[]
  ) {
    this.addEventListener('load', () => {
      try {
        if (this.__tpUrl && isOData(this.__tpUrl)) {
          emit(this.__tpUrl, this.status, this.responseText || '');
        }
      } catch {
        /* ignore */
      }
    });
    // @ts-expect-error passthrough
    return SendXHR.apply(this, args);
  } as typeof XMLHttpRequest.prototype.send;
}

install();

export { CHANNEL };
export type { CapturePayload };
