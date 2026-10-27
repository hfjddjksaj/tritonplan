/**
 * Thin same-origin client for the TritonPlan server. Every call carries the
 * session cookie (credentials: 'same-origin'); writes are JSON. Nothing here
 * talks to tss.ucsd.edu.
 */
import type { PlanState, RmpLookup, SyncOp } from '@triton/shared';
import type { SendResult } from './engine';
import type { WebSnapshot } from './records';

export interface Me { email: string; hasPassword: boolean; hasGoogle: boolean }
export type ApiResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: string; retryAfter?: number };

export class UnauthorizedError extends Error {
  constructor() { super('unauthorized'); this.name = 'UnauthorizedError'; }
}

const SYNC_TIMEOUT_MS = 20_000;
const READ_TIMEOUT_MS = 15_000;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * A GET whose headers must arrive within 15 s: a hung server would leave the start page
 * blank, or hold the refocus refresh forever (the abort throws like a network failure).
 * The limit ends once the headers are in. A big pool on a slow link can take far longer
 * than that to download, and cutting the body off would turn it into "offline" every time.
 */
async function getWithTimeout(path: string): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('The operation timed out.', 'TimeoutError')), READ_TIMEOUT_MS);
  try {
    return await fetch(path, { credentials: 'same-origin', signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 401 → null (signed out); anything else unexpected throws so the caller can show "offline" rather than "signed out". */
export async function fetchMe(): Promise<Me | null> {
  const r = await getWithTimeout('/api/me');
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`GET /api/me failed: ${r.status}`);
  return (await r.json()) as Me;
}

export async function fetchState(): Promise<WebSnapshot> {
  const r = await getWithTimeout('/api/state');
  if (r.status === 401) throw new UnauthorizedError();
  if (!r.ok) throw new Error(`GET /api/state failed: ${r.status}`);
  return (await r.json()) as WebSnapshot;
}

/** 20 s plus 1 s per 25 KB: a big body on a slow uplink must not time out while it is still uploading. */
export const syncTimeoutMs = (bytes: number): number => SYNC_TIMEOUT_MS + Math.ceil(bytes / 25_000) * 1_000;

export async function postSync(ops: SyncOp[]): Promise<SendResult> {
  let r: Response;
  const body = JSON.stringify({ ops });
  try {
    r = await fetch('/api/sync', {
      method: 'POST', credentials: 'same-origin', headers: JSON_HEADERS, body,
      // A hung request would hold the engine's one in-flight slot forever; an abort counts as a network failure.
      ...(typeof AbortSignal.timeout === 'function'
        ? { signal: AbortSignal.timeout(syncTimeoutMs(new TextEncoder().encode(body).length)) } : {}),
    });
  } catch {
    return { ok: false, kind: 'network' };
  }
  if (r.status === 409) return { ok: false, kind: 'conflict' };
  if (r.status === 401) return { ok: false, kind: 'unauthorized' };
  // 403 is the server's same-origin guard: retrying will not fix it.
  if (r.status === 400 || r.status === 403 || r.status === 413) return { ok: false, kind: 'rejected' };
  if (r.status !== 200) return { ok: false, kind: 'network' };
  try {
    const body = (await r.json()) as { ok?: boolean; versions?: unknown };
    if (body.ok !== true || !body.versions) return { ok: false, kind: 'network' };
    return { ok: true, versions: body.versions as Extract<SendResult, { ok: true }>['versions'] };
  } catch {
    return { ok: false, kind: 'network' };
  }
}

async function send(method: 'POST' | 'PUT' | 'DELETE', path: string, body: unknown): Promise<ApiResult> {
  let r: Response;
  try {
    r = await fetch(path, { method, credentials: 'same-origin', headers: JSON_HEADERS, body: JSON.stringify(body) });
  } catch {
    return { ok: false, status: 0, error: 'network' };
  }
  let parsed: unknown = null;
  try { parsed = await r.json(); } catch { /* empty or non-JSON body */ }
  if (r.ok) return { ok: true, body: parsed };
  const o = (parsed && typeof parsed === 'object' ? parsed : {}) as { error?: unknown; retryAfter?: unknown };
  const out: ApiResult = { ok: false, status: r.status, error: typeof o.error === 'string' ? o.error : 'error' };
  if (typeof o.retryAfter === 'number') out.retryAfter = o.retryAfter;
  return out;
}

export const apiPost = (path: string, body: unknown): Promise<ApiResult> => send('POST', path, body);
export const apiPut = (path: string, body: unknown): Promise<ApiResult> => send('PUT', path, body);
export const apiDelete = (path: string, body: unknown): Promise<ApiResult> => send('DELETE', path, body);

export interface ShareRow { code: string; name: string; url: string; createdAt: string }

const SHARE_NAME_MAX = 100; // the server's limit, counted in UTF-16 code units

/** Plan names are uncapped locally, but the server refuses a share name over 100; cut it, never mid-emoji. */
export function clampShareName(name: string): string {
  let s = name.trim();
  if (s.length > SHARE_NAME_MAX) {
    s = s.slice(0, SHARE_NAME_MAX);
    const last = s.charCodeAt(s.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1); // a high surrogate whose pair was cut off
    s = s.trimEnd();
  }
  return s || 'Shared plan';
}

/** The server only checks the snapshot loosely, so callers must hand over a bare PlanState (no booked/appointment marks). */
export async function createShare(name: string, plan: PlanState): Promise<{ code: string; url: string } | null> {
  const r = await apiPost('/api/shares', { name: clampShareName(name), plan });
  if (!r.ok) return null;
  const b = (r.body ?? {}) as { code?: unknown; url?: unknown };
  return typeof b.code === 'string' && typeof b.url === 'string' ? { code: b.code, url: b.url } : null;
}

export async function listShares(): Promise<ShareRow[] | null> {
  try {
    const r = await getWithTimeout('/api/shares');
    if (!r.ok) return null;
    const b = (await r.json()) as { shares?: unknown };
    return Array.isArray(b.shares) ? (b.shares as ShareRow[]) : null;
  } catch {
    return null;
  }
}

/** A link that is already gone (404) counts as turned off: that is the state the student asked for. */
export async function revokeShare(code: string): Promise<boolean> {
  const r = await apiDelete(`/api/shares/${encodeURIComponent(code)}`, {});
  return r.ok || r.status === 404;
}

/**
 * Opening someone's link. Only a 404 means "this link is dead"; a rate limit, a 5xx or a dropped
 * connection says nothing about the link, so those come back null and the caller can offer a retry.
 */
export async function fetchShare(
  code: string,
): Promise<{ name: string; plan: PlanState; createdAt: string } | 'not-found' | null> {
  try {
    const r = await getWithTimeout(`/api/s/${encodeURIComponent(code)}`);
    if (r.status === 404) return 'not-found';
    if (!r.ok) return null;
    return (await r.json()) as { name: string; plan: PlanState; createdAt: string };
  } catch {
    return null;
  }
}

export interface CalendarLinks { https: string; webcal: string }
export interface CalendarState {
  https: string | null;
  webcal: string | null;
  /** termKey → the plan id the student picked for it. */
  terms: Record<string, string>;
  /** Term keys whose picked plan is gone (or moved to another term); the feed leaves them out. */
  missing: string[];
}

/** null = could not load; callers show a retry-able message rather than an empty calendar. */
export async function fetchCalendar(): Promise<CalendarState | null> {
  try {
    const r = await getWithTimeout('/api/calendar');
    if (!r.ok) return null;
    const b = (await r.json()) as Partial<CalendarState>;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
      https: str(b.https),
      webcal: str(b.webcal),
      terms: b.terms && typeof b.terms === 'object' ? b.terms : {},
      missing: Array.isArray(b.missing) ? b.missing : [],
    };
  } catch {
    return null;
  }
}

/** The server replaces the whole map, so callers always send every pick, not just the one that changed. */
export async function saveCalendarTerms(terms: Record<string, string>): Promise<boolean> {
  return (await apiPut('/api/calendar', { terms })).ok;
}

function links(r: ApiResult): CalendarLinks | null {
  if (!r.ok) return null;
  const b = (r.body ?? {}) as { https?: unknown; webcal?: unknown };
  return typeof b.https === 'string' && typeof b.webcal === 'string' ? { https: b.https, webcal: b.webcal } : null;
}

/** Idempotent: an existing link comes back unchanged. */
export const createCalendarLink = async (): Promise<CalendarLinks | null> => links(await apiPost('/api/calendar/link', {}));
/** A NEW secret; the old link stops working at once. */
export const resetCalendarLink = async (): Promise<CalendarLinks | null> => links(await apiPost('/api/calendar/reset', {}));

const RMP_MAX_NAMES = 20; // the server's per-request limit
const rmpCache = new Map<string, RmpLookup>();
/** Tests only: the cache is page-session state, so each test starts from nothing. */
export const clearRmpCache = (): void => rmpCache.clear();

/**
 * Ratings change monthly, so a name looked up once stays answered for the page session.
 * Failures are never cached: the next click should get another try. null = the lookup
 * failed (signed out, offline, server error); callers fall back to RMP's search.
 */
export async function lookupRmp(names: string[]): Promise<RmpLookup[] | null> {
  const wanted = names.map((n) => n.trim());
  const missing = [...new Set(wanted.filter((n) => !rmpCache.has(n)))];
  try {
    for (let i = 0; i < missing.length; i += RMP_MAX_NAMES) {
      const q = new URLSearchParams();
      const chunk = missing.slice(i, i + RMP_MAX_NAMES);
      for (const n of chunk) q.append('name', n);
      const r = await getWithTimeout(`/api/rmp?${q}`);
      if (!r.ok) return null;
      const b = (await r.json()) as { results?: unknown };
      if (!Array.isArray(b.results)) return null;
      // Results come back in request order; key by what we asked, not by what the server echoes.
      const results = b.results as RmpLookup[];
      chunk.forEach((n, j) => { if (results[j]) rmpCache.set(n, results[j]); });
    }
  } catch {
    return null;
  }
  const out: RmpLookup[] = [];
  for (const n of wanted) {
    const hit = rmpCache.get(n);
    if (!hit) return null;
    out.push(hit);
  }
  return out;
}
