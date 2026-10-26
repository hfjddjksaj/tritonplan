import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseOffering, PlanState, SyncOp, SyncVersions, Term } from '@triton/shared';
import type { NamedPlan } from '../plans';
import type { TermsState } from '../terms-state';
import { splitTerms, type WebSnapshot } from './records';
import { batchOps, createSyncEngine, installUnloadGuard, type SendResult } from './engine';

const FA: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WI: Term = { year: '2027', period: '3', label: 'Winter 2027' };
const ps = (term: Term): PlanState => ({ version: 1, term, entries: [] });
const np = (id: string, name = id, term = FA): NamedPlan => ({ id, name, plan: ps(term), createdAt: 'c', updatedAt: 'u', browsed: [] });
const state = (name = 'a'): TermsState => ({
  version: 1, activeTermKey: '2026|2',
  terms: { '2026|2': { term: FA, plans: { activeId: 'a', plans: [np('a', name)] } } },
});
const course = (id: string) => ({ id, title: id }) as unknown as CourseOffering;
function snap(s: TermsState, pool: CourseOffering[] = []): WebSnapshot {
  const { terms, plans } = splitTerms(s);
  return {
    terms: Object.fromEntries(Object.entries(terms).map(([k, data]) => [k, { version: 5, data }])),
    plans: Object.fromEntries(Object.entries(plans).map(([id, p]) => [id, { version: 7, termKey: p.termKey, data: p.plan }])),
    pool, appt: null,
  };
}
/** A server stand-in: gives every put a fresh version, like the real counter. */
function fakeSend() {
  let counter = 100;
  const calls: SyncOp[][] = [];
  const base = async (ops: SyncOp[]): Promise<SendResult> => {
    calls.push(ops);
    const versions: SyncVersions = { terms: {}, plans: {} };
    for (const o of ops) {
      if (o.op === 'putTerm') versions.terms[o.termKey] = ++counter;
      if (o.op === 'putPlan') versions.plans[o.planId] = ++counter;
    }
    return { ok: true, versions };
  };
  return { impl: vi.fn(base), base, calls };
}
const fail = (kind: 'conflict' | 'unauthorized' | 'network' | 'rejected'): SendResult => ({ ok: false, kind });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSyncEngine', () => {
  it('setTerms with data identical to the snapshot sends nothing', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.setTerms(state());
    expect(e.hasPending()).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.impl).not.toHaveBeenCalled();
    expect(e.status()).toBe('idle');
  });

  it('three quick edits become one request after the debounce', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.setTerms(state('b'));
    await vi.advanceTimersByTimeAsync(300);
    e.setTerms(state('c'));
    await vi.advanceTimersByTimeAsync(300);
    e.setTerms(state('d'));
    await vi.advanceTimersByTimeAsync(799);
    expect(f.impl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.impl).toHaveBeenCalledTimes(1);
    expect(f.calls[0]).toMatchObject([{ op: 'putPlan', planId: 'a', baseVersion: 7, data: { name: 'd' } }]);
    expect(e.status()).toBe('idle');
    expect(e.hasPending()).toBe(false);
  });

  it('a network failure shows offline, retries, then settles to idle', async () => {
    const f = fakeSend();
    f.impl.mockResolvedValueOnce(fail('network'));
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    const seen: string[] = [];
    e.subscribe(() => seen.push(e.status()));
    e.setTerms(state('b'));
    await vi.advanceTimersByTimeAsync(800);
    expect(e.status()).toBe('offline');
    expect(e.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.impl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.impl).toHaveBeenCalledTimes(2);
    expect(e.status()).toBe('idle');
    expect(seen).toEqual(['saving', 'offline', 'saving', 'idle']);
  });

  it('backoff walks the delays, stays at 30 s, and resets after a success', async () => {
    const f = fakeSend();
    f.impl.mockResolvedValue(fail('network'));
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl, retryDelaysMs: [10, 20] });
    e.setTerms(state('b'));
    await vi.advanceTimersByTimeAsync(800); // attempt 1
    await vi.advanceTimersByTimeAsync(10); // 2
    await vi.advanceTimersByTimeAsync(20); // 3
    await vi.advanceTimersByTimeAsync(30_000); // 4
    expect(f.impl).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(f.impl).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.impl).toHaveBeenCalledTimes(5);
    f.impl.mockImplementation(f.base);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(e.status()).toBe('idle');
    f.impl.mockResolvedValueOnce(fail('network'));
    e.setTerms(state('c'));
    await vi.advanceTimersByTimeAsync(800);
    expect(f.impl).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(10); // reset: the first delay again
    expect(f.impl).toHaveBeenCalledTimes(8);
  });

  it('a conflict stops sending for good', async () => {
    const send = vi.fn(async () => fail('conflict'));
    const e = createSyncEngine({ snapshot: snap(state()), send });
    e.setTerms(state('b'));
    await vi.advanceTimersByTimeAsync(800);
    expect(e.status()).toBe('conflict');
    e.setTerms(state('c'));
    await e.flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(e.status()).toBe('conflict');
  });

  it('unauthorized → signed-out, rejected → error, both stop', async () => {
    for (const [kind, status] of [['unauthorized', 'signed-out'], ['rejected', 'error']] as const) {
      const send = vi.fn(async () => fail(kind));
      const e = createSyncEngine({ snapshot: snap(state()), send });
      e.setTerms(state('b'));
      await vi.advanceTimersByTimeAsync(800);
      expect(e.status()).toBe(status);
      e.setTerms(state('c'));
      await vi.advanceTimersByTimeAsync(120_000);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it('an edit made while a request is in flight is sent next with the new base version', async () => {
    const f = fakeSend();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    f.impl.mockImplementationOnce(async (ops) => { const r = await f.base(ops); await gate; return r; });
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.setTerms(state('b'));
    await vi.advanceTimersByTimeAsync(800);
    expect(e.status()).toBe('saving');
    expect(e.hasPending()).toBe(true);
    e.setTerms(state('c'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.impl).toHaveBeenCalledTimes(1); // one request in flight at a time
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.impl).toHaveBeenCalledTimes(2);
    expect(f.calls[1]).toMatchObject([{ op: 'putPlan', baseVersion: 101, data: { name: 'c' } }]);
    expect(e.status()).toBe('idle');
  });

  it('hasPending is true until the server acknowledged the latest state', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    expect(e.hasPending()).toBe(false);
    e.setPool([course('x')]);
    expect(e.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(e.hasPending()).toBe(false);
  });

  it('flush sends immediately and resolves when idle', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.setAppt([{ slot: 1 }] as never);
    await e.flush();
    expect(f.impl).toHaveBeenCalledTimes(1);
    expect(e.hasPending()).toBe(false);
  });

  it('dispose clears timers and stops sending', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.setTerms(state('b'));
    e.dispose();
    e.setTerms(state('c'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.impl).not.toHaveBeenCalled();
  });

  it('R23: a 5 000-course pool goes out in sequential, bounded batches and ends idle', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    const s = state();
    s.terms['2027|3'] = { term: WI, plans: { activeId: 'z', plans: [np('z', 'z', WI)] } };
    e.setTerms(s);
    e.setPool(Array.from({ length: 5000 }, (_, i) => course(`c${i}`)));
    await vi.advanceTimersByTimeAsync(800);
    expect(f.calls.length).toBeGreaterThanOrEqual(3);
    for (const ops of f.calls) {
      expect(ops.length).toBeLessThanOrEqual(500);
      expect(JSON.stringify({ ops }).length).toBeLessThanOrEqual(4_000_000);
      for (const o of ops) if (o.op === 'putCourses') expect(o.courses.length).toBeLessThanOrEqual(2000);
    }
    expect(f.calls[0]!.map((o) => o.op)).toEqual(expect.arrayContaining(['putTerm', 'putPlan']));
    const sent = f.calls.flat().flatMap((o) => (o.op === 'putCourses' ? o.courses : []));
    expect(sent).toHaveLength(5000);
    expect(e.status()).toBe('idle');
    expect(e.hasPending()).toBe(false);
  });

  it('R23: a failure mid-sequence stops it; the retry resumes with what is left', async () => {
    const f = fakeSend();
    f.impl.mockImplementationOnce(f.base).mockResolvedValueOnce(fail('network'));
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.setPool(Array.from({ length: 5000 }, (_, i) => course(`c${i}`)));
    await vi.advanceTimersByTimeAsync(800);
    expect(e.status()).toBe('offline');
    await vi.advanceTimersByTimeAsync(2000);
    expect(e.status()).toBe('idle');
    const sent = f.calls.flat().flatMap((o) => (o.op === 'putCourses' ? o.courses : []));
    expect(new Set(sent.map((c) => c.id)).size).toBe(5000);
  });
});

describe('installUnloadGuard', () => {
  it('beforeunload is blocked only while something is unsaved', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    const off = installUnloadGuard(e);
    const fire = () => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev; };
    expect(fire().defaultPrevented).toBe(false);
    e.setTerms(state('b'));
    expect(fire().defaultPrevented).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(fire().defaultPrevented).toBe(false);
    off();
  });

  it('pagehide sends small pending ops with keepalive, skips big ones and stopped engines', async () => {
    const fetchMock = vi.fn(async (..._a: unknown[]) => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    const off = installUnloadGuard(e);
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).not.toHaveBeenCalled();
    e.setTerms(state('b'));
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sync');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    e.setPool(Array.from({ length: 2000 }, (_, i) => course(`c${i}`)));
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const conflicted = createSyncEngine({ snapshot: snap(state()), send: async () => fail('conflict') });
    const off2 = installUnloadGuard(conflicted);
    conflicted.setTerms(state('b'));
    await vi.advanceTimersByTimeAsync(800);
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    off2();
    vi.unstubAllGlobals();
  });
});

describe('batchOps', () => {
  it('caps ops per batch and bytes per batch, keeping order', () => {
    const many: SyncOp[] = Array.from({ length: 1200 }, (_, i) => ({ op: 'deletePlan', planId: `p${i}`, baseVersion: 1 }));
    const b = batchOps(many);
    expect(b.map((x) => x.length)).toEqual([500, 500, 200]);
    expect(b.flat()).toEqual(many);
    const fat: SyncOp[] = Array.from({ length: 5 }, (_, i) => ({ op: 'putPlan', planId: `p${i}`, termKey: 't', baseVersion: 0, data: 'x'.repeat(900_000) }));
    const fb = batchOps(fat);
    expect(fb.length).toBeGreaterThan(1);
    for (const x of fb) expect(JSON.stringify({ ops: x }).length).toBeLessThanOrEqual(4_000_000);
  });
});
