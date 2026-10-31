/**
 * Debounced sync engine. Holds `acked` (what the server confirmed) and
 * `desired` (what the UI shows); whenever they differ it sends diffOps() and
 * folds the response in with applyAck(). One request in flight at a time, so
 * an edit made meanwhile goes out next with the versions that request returned.
 */
import { useSyncExternalStore } from 'react';
import type { ApptTimes, CourseOffering, SyncOp, SyncVersions } from '@triton/shared';
import type { TermsState } from '../terms-state';
import { ackedFromSnapshot, applyAck, diffOps, sameAcked, type Acked, type Desired } from './diff';
import { termsFromSnapshot, type WebSnapshot } from './records';

export type SyncStatus = 'idle' | 'saving' | 'offline' | 'conflict' | 'signed-out' | 'error';
export type SendResult =
  | { ok: true; versions: SyncVersions }
  | { ok: false; kind: 'conflict' | 'unauthorized' | 'network' | 'rejected' };

export interface SyncEngine {
  setTerms(t: TermsState): void;
  setPool(p: CourseOffering[]): void;
  setAppt(a: ApptTimes[]): void;
  flush(): Promise<void>;
  status(): SyncStatus;
  /** False once the engine has stopped (conflict / signed-out / error / disposed): such edits can no longer be saved, and the page reload replaces the engine. */
  hasPending(): boolean;
  /** The ops the next request would carry; empty while one is in flight or the engine has stopped (used by the unload guard). */
  pendingOps(): SyncOp[];
  /** True when a fresh server snapshot holds exactly what this engine last saw acknowledged: nothing changed elsewhere since. */
  matchesServer(s: WebSnapshot): boolean;
  subscribe(fn: () => void): () => void;
  dispose(): void;
}

/** Signed out there is nowhere to save, so nothing is ever pending. */
export function idleEngine(): SyncEngine {
  return {
    setTerms() {},
    setPool() {},
    setAppt() {},
    flush: () => Promise.resolve(),
    status: () => 'idle',
    hasPending: () => false,
    pendingOps: () => [],
    matchesServer: () => false,
    subscribe: () => () => {},
    dispose() {},
  };
}

// Well under the server's SYNC_LIMITS (500 ops / 8 MB body); the byte budget leaves headroom for the envelope.
const MAX_OPS = 500;
// ~1 MB keeps a request finishable within postSync's size-scaled timeout on a slow uplink; a timeout that
// follows a server commit would resend stale baseVersions and read as a false conflict.
const MAX_BATCH_BYTES = 1_000_000;
// term/plan ops only share a request with this much course data, so a plan edit is never stuck behind an upload.
const SMALL_COURSE_BYTES = 256_000;
const MAX_ITEMS = 2000;
const UNLOAD_MAX_BYTES = 60_000;
// Slack for the op wrapper and the `{"ops":[...]}` envelope around a list piece.
const ENVELOPE_BYTES = 1000;

const encoder = new TextEncoder();
const byteLen = (s: string) => encoder.encode(s).length;

/** Split a list op into pieces of <= MAX_ITEMS items and <= ~MAX_BATCH_BYTES bytes (an oversized single item goes alone). */
function listPieces<T>(items: T[], make: (chunk: T[]) => SyncOp): { op: SyncOp; bytes: number; items: number }[] {
  const pieces: { op: SyncOp; bytes: number; items: number }[] = [];
  let chunk: T[] = [];
  let bytes = 0;
  const flush = () => {
    if (chunk.length === 0) return;
    pieces.push({ op: make(chunk), bytes: bytes + ENVELOPE_BYTES, items: chunk.length });
    chunk = [];
    bytes = 0;
  };
  for (const it of items) {
    const size = byteLen(JSON.stringify(it)) + 1;
    if (chunk.length > 0 && (chunk.length >= MAX_ITEMS || bytes + size > MAX_BATCH_BYTES - ENVELOPE_BYTES)) flush();
    chunk.push(it);
    bytes += size;
  }
  flush();
  return pieces;
}

/**
 * Pack ops, in order (term/plan ops stay first), into batches of <= 500 ops,
 * <= 2 000 course items/ids and <= ~1 MB of JSON. Course lists are chunked by
 * count AND bytes first: real courses average several KB, so a 2 000-course
 * chunk by count alone would blow the server's body limit. Non-list ops
 * (term/plan/appt) only share a batch with < 256 KB of course data.
 * Also the entry point for one-off bulk imports (Task 15): send these in order.
 */
export function batchOps(ops: SyncOp[]): SyncOp[][] {
  const out: SyncOp[][] = [];
  let cur: SyncOp[] = [];
  let bytes = 0;
  let items = 0;
  let courseBytes = 0;
  let meta = 0;
  const close = () => { if (cur.length) { out.push(cur); cur = []; bytes = 0; items = 0; courseBytes = 0; meta = 0; } };
  const push = (op: SyncOp, b: number, n: number, list: boolean) => {
    const mixes = list ? meta > 0 && courseBytes + b >= SMALL_COURSE_BYTES : courseBytes >= SMALL_COURSE_BYTES;
    if (cur.length > 0 && (mixes || cur.length >= MAX_OPS || bytes + b > MAX_BATCH_BYTES || items + n > MAX_ITEMS)) close();
    cur.push(op);
    bytes += b;
    items += n;
    if (list) courseBytes += b; else meta++;
  };
  for (const op of ops) {
    if (op.op === 'putCourses') {
      for (const p of listPieces(op.courses, (courses) => ({ op: 'putCourses', courses }))) push(p.op, p.bytes, p.items, true);
    } else if (op.op === 'deleteCourses') {
      for (const p of listPieces(op.ids, (ids) => ({ op: 'deleteCourses', ids }))) push(p.op, p.bytes, p.items, true);
    } else push(op, byteLen(JSON.stringify(op)) + 1, 0, false);
  }
  close();
  return out;
}

export function createSyncEngine(o: {
  snapshot: WebSnapshot;
  send: (ops: SyncOp[]) => Promise<SendResult>;
  debounceMs?: number;
  retryDelaysMs?: number[];
}): SyncEngine {
  const debounceMs = o.debounceMs ?? 800;
  const retryDelays = o.retryDelaysMs ?? [2000, 5000, 10000, 30000];
  const RETRY_FOREVER = 30000;

  let acked: Acked = ackedFromSnapshot(o.snapshot);
  const desired: Desired = {
    terms: termsFromSnapshot(o.snapshot),
    pool: o.snapshot.pool,
    appt: o.snapshot.appt,
  };

  let status: SyncStatus = 'idle';
  let stopped = false; // conflict / signed-out / error / dispose: never send again
  let busy = false; // set synchronously on drain entry, cleared synchronously on loop exit
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  const subs = new Set<() => void>();

  const setStatus = (s: SyncStatus) => {
    if (s === status) return;
    status = s;
    // Deferred so no subscriber runs inside a state transition (it could edit or flush mid-loop).
    queueMicrotask(() => { for (const fn of [...subs]) fn(); });
  };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const schedule = (ms: number) => {
    if (stopped) return;
    clearTimer();
    timer = setTimeout(() => { timer = null; void drain(); }, ms);
  };

  async function sendLoop(): Promise<void> {
    // The finally runs synchronously with the final return, before any queued subscriber microtask,
    // so an edit made on the 'idle' notification sees busy === false and schedules its own send.
    try {
      while (!stopped) {
        let batch: SyncOp[];
        try {
          const ops = diffOps(acked, desired);
          if (ops.length === 0) { setStatus('idle'); return; }
          batch = batchOps(ops)[0]!;
        } catch {
          // Unserializable state: retrying cannot help. Log without the data.
          console.error('TritonPlan sync: could not build a request; sync stopped');
          stopped = true;
          setStatus('error');
          return;
        }
        setStatus('saving');
        let res: SendResult;
        try { res = await o.send(batch); } catch { res = { ok: false, kind: 'network' }; }
        if (stopped) return; // disposed while in flight
        if (res.ok) {
          try { acked = applyAck(acked, batch, res.versions); } catch { stopped = true; setStatus('error'); return; }
          failures = 0;
          continue; // later batches / edits made meanwhile are recomputed from the new acked
        }
        if (res.kind === 'network') {
          setStatus('offline');
          schedule(retryDelays[failures] ?? RETRY_FOREVER);
          failures++;
          return;
        }
        stopped = true;
        setStatus(res.kind === 'conflict' ? 'conflict' : res.kind === 'unauthorized' ? 'signed-out' : 'error');
        return;
      }
    } finally {
      busy = false;
      running = null;
    }
  }

  function drain(): Promise<void> {
    if (busy) return running ?? Promise.resolve();
    if (stopped) return Promise.resolve();
    busy = true;
    const p = sendLoop();
    running = busy ? p : null; // the loop may already have finished synchronously
    return p;
  }

  // While offline the backoff timer owns the schedule: an edit must not replace it with the short debounce.
  const touched = () => { if (!stopped && !busy && status !== 'offline') schedule(debounceMs); };

  return {
    setTerms(t) { desired.terms = t; touched(); },
    setPool(p) { desired.pool = p; touched(); },
    setAppt(a) { desired.appt = a; touched(); },
    async flush() { clearTimer(); await drain(); },
    status: () => status,
    hasPending: () => !stopped && (busy || diffOps(acked, desired).length > 0),
    pendingOps: () => (stopped || busy ? [] : diffOps(acked, desired)),
    matchesServer: (s) => sameAcked(acked, ackedFromSnapshot(s)),
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    dispose() { stopped = true; clearTimer(); subs.clear(); },
  };
}

export function useSyncStatus(e: SyncEngine): SyncStatus {
  return useSyncExternalStore(e.subscribe, e.status);
}

/**
 * Warn before leaving with unsaved changes; on pagehide, best-effort keepalive
 * send of a small remainder. The keepalive commits on the server behind the
 * engine's back, so if the page comes back from the bfcache it reloads to take
 * the server's versions instead of resending stale baseVersions (a 409).
 * Hiding the tab sends at once rather than after the debounce: a mobile browser
 * may freeze or discard a hidden tab before the timer fires, and hidden is often
 * the last moment a page gets.
 */
export function installUnloadGuard(e: SyncEngine, reload: () => void = () => location.reload()): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void e.flush();
  };
  const onPageShow = (ev: PageTransitionEvent) => {
    window.removeEventListener('pageshow', onPageShow);
    if (ev.persisted) reload();
  };
  const onBeforeUnload = (ev: BeforeUnloadEvent) => {
    if (!e.hasPending()) return;
    ev.preventDefault();
    ev.returnValue = '';
  };
  const onPageHide = () => {
    const ops = e.pendingOps();
    if (ops.length === 0) return;
    const body = JSON.stringify({ ops });
    if (byteLen(body) >= UNLOAD_MAX_BYTES) return;
    void fetch('/api/sync', {
      method: 'POST', keepalive: true, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body,
    }).catch(() => {});
    window.addEventListener('pageshow', onPageShow);
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
