/**
 * Thin same-origin client for the TritonPlan server. Every call carries the
 * session cookie (credentials: 'same-origin'); writes are JSON. Nothing here
 * talks to tss.ucsd.edu.
 */
import type { SyncOp } from '@triton/shared';
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

/** A hung GET would leave the start page blank, or hold the refocus refresh forever; the abort throws like a network failure. */
const readInit = (): RequestInit => ({
  credentials: 'same-origin',
  ...(typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(READ_TIMEOUT_MS) } : {}),
});

/** 401 → null (signed out); anything else unexpected throws so the caller can show "offline" rather than "signed out". */
export async function fetchMe(): Promise<Me | null> {
  const r = await fetch('/api/me', readInit());
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`GET /api/me failed: ${r.status}`);
  return (await r.json()) as Me;
}

export async function fetchState(): Promise<WebSnapshot> {
  const r = await fetch('/api/state', readInit());
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

async function send(method: 'POST' | 'DELETE', path: string, body: unknown): Promise<ApiResult> {
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
export const apiDelete = (path: string, body: unknown): Promise<ApiResult> => send('DELETE', path, body);
