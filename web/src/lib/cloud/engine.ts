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

/**
 * Chunk the big list ops, then pack ops into batches under both caps, keeping
 * order (term/plan ops stay first). Each course chunk is its own request so
 * the server never has to apply several thousand rows alongside plan writes.
 */
export function batchOps(ops: SyncOp[]): SyncOp[][] {
  const flat: SyncOp[] = [];
  for (const op of ops) {
    if (op.op === 'putCourses') {
      for (let i = 0; i < op.courses.length; i += MAX_ITEMS) flat.push({ op: 'putCourses', courses: op.courses.slice(i, i + MAX_ITEMS) });
    } else if (op.op === 'deleteCourses') {
      for (let i = 0; i < op.ids.length; i += MAX_ITEMS) flat.push({ op: 'deleteCourses', ids: op.ids.slice(i, i + MAX_ITEMS) });
    } else flat.push(op);
  }
  const out: SyncOp[][] = [];
  let cur: SyncOp[] = [];
  let bytes = 0;
  for (const op of flat) {
    const size = JSON.stringify(op).length + 1;
    const bulk = op.op === 'putCourses' || op.op === 'deleteCourses';
    if (cur.length > 0 && (bulk || cur.length >= MAX_OPS || bytes + size > MAX_BATCH_BYTES)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(op);
    bytes += size;
    if (bulk) { out.push(cur); cur = []; bytes = 0; }
  }
  if (cur.length > 0) out.push(cur);
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
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  const subs = new Set<() => void>();

  const setStatus = (s: SyncStatus) => {
    if (s === status) return;
    status = s;
    for (const fn of [...subs]) fn();
  };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const schedule = (ms: number) => {
    if (stopped) return;
    clearTimer();
    timer = setTimeout(() => { timer = null; void drain(); }, ms);
  };

  async function sendLoop(): Promise<void> {
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
  }

  function drain(): Promise<void> {
    if (running) return running;
    if (stopped) return Promise.resolve();
    running = sendLoop().finally(() => { running = null; });
    return running;
  }

  const touched = () => { if (!stopped && !running) schedule(debounceMs); };

  return {
    setTerms(t) { desired.terms = t; touched(); },
    setPool(p) { desired.pool = p; touched(); },
    setAppt(a) { desired.appt = a; touched(); },
    async flush() { clearTimer(); await drain(); },
    status: () => status,
    hasPending: () => running !== null || diffOps(acked, desired).length > 0,
    pendingOps: () => (stopped || running ? [] : diffOps(acked, desired)),
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    dispose() { stopped = true; clearTimer(); subs.clear(); },
  };
}

export function useSyncStatus(e: SyncEngine): SyncStatus {
  return useSyncExternalStore(e.subscribe, e.status);
}

/** Warn before leaving with unsaved changes; on pagehide, best-effort keepalive send of a small remainder. */
export function installUnloadGuard(e: SyncEngine): () => void {
  const onBeforeUnload = (ev: BeforeUnloadEvent) => {
    if (!e.hasPending()) return;
    ev.preventDefault();
    ev.returnValue = '';
  };
  const onPageHide = () => {
    const ops = e.pendingOps();
    if (ops.length === 0) return;
    const body = JSON.stringify({ ops });
    if (body.length >= UNLOAD_MAX_BYTES) return;
    void fetch('/api/sync', {
      method: 'POST', keepalive: true, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body,
    }).catch(() => {});
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
  };
}
