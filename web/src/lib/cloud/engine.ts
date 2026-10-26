/**
 * Debounced sync engine. Holds `acked` (what the server confirmed) and
 * `desired` (what the UI shows); whenever they differ it sends diffOps() and
 * folds the response in with applyAck(). One request in flight at a time, so
 * an edit made meanwhile goes out next with the versions that request returned.
 */
import { useSyncExternalStore } from 'react';
import type { ApptTimes, CourseOffering, SyncOp, SyncVersions } from '@triton/shared';
import type { TermsState } from '../terms-state';
import { ackedFromSnapshot, applyAck, diffOps, type Acked, type Desired } from './diff';
import { assembleTerms, type WebSnapshot } from './records';

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
  hasPending(): boolean;
  /** The ops the next request would carry; empty while one is in flight or the engine has stopped (used by the unload guard). */
  pendingOps(): SyncOp[];
  subscribe(fn: () => void): () => void;
  dispose(): void;
}

// Well under the server's SYNC_LIMITS (500 ops / 8 MB body); the byte budget leaves headroom for the envelope.
const MAX_OPS = 500;
const MAX_BATCH_BYTES = 4_000_000;
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
 * <= 2 000 course items/ids and <= ~4 MB of JSON. Course lists are chunked by
 * count AND bytes first: real courses average several KB, so a 2 000-course
 * chunk by count alone would blow the server's body limit.
 */
export function batchOps(ops: SyncOp[]): SyncOp[][] {
  const out: SyncOp[][] = [];
  let cur: SyncOp[] = [];
  let bytes = 0;
  let items = 0;
  const close = () => { if (cur.length) { out.push(cur); cur = []; bytes = 0; items = 0; } };
  const push = (op: SyncOp, b: number, n: number) => {
    if (cur.length > 0 && (cur.length >= MAX_OPS || bytes + b > MAX_BATCH_BYTES || items + n > MAX_ITEMS)) close();
    cur.push(op);
    bytes += b;
    items += n;
  };
  for (const op of ops) {
    if (op.op === 'putCourses') {
      for (const p of listPieces(op.courses, (courses) => ({ op: 'putCourses', courses }))) push(p.op, p.bytes, p.items);
    } else if (op.op === 'deleteCourses') {
      for (const p of listPieces(op.ids, (ids) => ({ op: 'deleteCourses', ids }))) push(p.op, p.bytes, p.items);
    } else push(op, byteLen(JSON.stringify(op)) + 1, 0);
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
    terms: assembleTerms(
      Object.fromEntries(Object.entries(o.snapshot.terms).map(([k, v]) => [k, v.data])),
      Object.fromEntries(Object.entries(o.snapshot.plans).map(([k, v]) => [k, { termKey: v.termKey, plan: v.data }])),
    ),
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
        const ops = diffOps(acked, desired);
        if (ops.length === 0) { setStatus('idle'); return; }
        const batch = batchOps(ops)[0]!;
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
 */
export function installUnloadGuard(e: SyncEngine, reload: () => void = () => location.reload()): () => void {
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
  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
}
