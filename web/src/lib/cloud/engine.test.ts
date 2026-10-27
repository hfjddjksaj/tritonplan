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
      expect(JSON.stringify({ ops }).length).toBeLessThanOrEqual(1_000_000);
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

  it('hiding the tab sends pending edits now instead of after the debounce; showing it does not', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    const off = installUnloadGuard(e);
    const visibility = (v: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    try {
      e.setTerms(state('b'));
      visibility('visible');
      await vi.advanceTimersByTimeAsync(0);
      expect(f.impl).not.toHaveBeenCalled();
      visibility('hidden');
      await vi.advanceTimersByTimeAsync(0); // no debounce wait: the send went out on the event
      expect(f.impl).toHaveBeenCalledTimes(1);
      expect(e.hasPending()).toBe(false);
      off();
      e.setTerms(state('c'));
      visibility('hidden');
      await vi.advanceTimersByTimeAsync(0);
      expect(f.impl).toHaveBeenCalledTimes(1); // removed with the guard
    } finally {
      off();
      delete (document as unknown as { visibilityState?: string }).visibilityState;
    }
  });
});

/** A course of roughly `kb` kilobytes of JSON, like the real ones (1.4-15.7 KB). */
const fatCourse = (id: string, kb: number) => ({ id, title: id, pad: 'x'.repeat(kb * 1000) }) as unknown as CourseOffering;
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

describe('realistic course sizes', () => {
  it('2 500 courses of 3-7 KB: every request within 4 MB and 2 000 items, all sent, idle at the end', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.setPool(Array.from({ length: 2500 }, (_, i) => fatCourse(`c${i}`, 3 + (i % 5))));
    await vi.advanceTimersByTimeAsync(800);
    expect(f.calls.length).toBeGreaterThan(1);
    for (const ops of f.calls) {
      expect(enc({ ops })).toBeLessThanOrEqual(1_000_000);
      expect(ops.length).toBeLessThanOrEqual(500);
      const n = ops.reduce((a, o) => a + (o.op === 'putCourses' ? o.courses.length : o.op === 'deleteCourses' ? o.ids.length : 0), 0);
      expect(n).toBeLessThanOrEqual(2000);
    }
    const ids = new Set(f.calls.flat().flatMap((o) => (o.op === 'putCourses' ? o.courses.map((c) => c.id) : [])));
    expect(ids.size).toBe(2500);
    expect(e.status()).toBe('idle');
    expect(e.hasPending()).toBe(false);
  });

  it('one plan edit plus one course change is a single request', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.setTerms(state('b'));
    e.setPool([fatCourse('x', 7)]);
    await vi.advanceTimersByTimeAsync(800);
    expect(f.impl).toHaveBeenCalledTimes(1);
    expect(f.calls[0]!.map((o) => o.op)).toEqual(['putPlan', 'putCourses']);
  });

  it('a plan edit travels in a small request and is acked even when the course batches cannot upload', async () => {
    const f = fakeSend();
    const slow = (ops: SyncOp[]) => (enc({ ops }) > 300_000 ? Promise.resolve(fail('network')) : f.base(ops));
    const send = vi.fn(slow);
    const e = createSyncEngine({ snapshot: snap(state()), send });
    e.setTerms(state('b'));
    e.setPool(Array.from({ length: 200 }, (_, i) => fatCourse(`c${i}`, 5))); // ~1 MB of changes
    await vi.advanceTimersByTimeAsync(800 + 2000 + 5000 + 10_000);
    expect(e.status()).toBe('offline');
    expect(f.calls).toHaveLength(1); // only the plan batch ever got through
    expect(f.calls[0]!.map((o) => o.op)).toEqual(['putPlan']);
    const later = send.mock.calls.slice(1).map((c) => c[0]);
    expect(later.length).toBeGreaterThanOrEqual(3);
    for (const ops of later) expect(ops.every((o) => o.op === 'putCourses')).toBe(true);
    expect(e.hasPending()).toBe(true);
  });

  it('plan ops share a request only with small course payloads', () => {
    const plan: SyncOp = { op: 'putPlan', planId: 'a', termKey: 't', baseVersion: 1, data: {} };
    const small = batchOps([plan, { op: 'putCourses', courses: [fatCourse('s', 5)] }]);
    expect(small).toHaveLength(1);
    const big = batchOps([plan, { op: 'putCourses', courses: Array.from({ length: 60 }, (_, i) => fatCourse(`b${i}`, 5)) }]);
    expect(big[0]).toEqual([plan]);
    expect(big.length).toBeGreaterThan(1);
  });

  it('stops in error (and logs without data) if building a request throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.setPool([{ id: 'x', n: 1n } as unknown as CourseOffering]); // JSON.stringify throws on BigInt
    await vi.advanceTimersByTimeAsync(800);
    expect(e.status()).toBe('error');
    expect(f.impl).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0])).not.toContain('"x"');
    spy.mockRestore();
  });

  it('a single oversized course goes alone', () => {
    const b = batchOps([{ op: 'putCourses', courses: [fatCourse('a', 1), fatCourse('big', 4200), fatCourse('c', 1)] }]);
    expect(b.flat().flatMap((o) => (o.op === 'putCourses' ? o.courses.map((c) => c.id) : []))).toEqual(['a', 'big', 'c']);
    const withBig = b.find((x) => x.some((o) => o.op === 'putCourses' && o.courses.some((c) => c.id === 'big')))!;
    expect(withBig).toHaveLength(1);
    expect((withBig[0] as { courses: unknown[] }).courses).toHaveLength(1);
  });
});

describe('re-entrancy and lifecycle', () => {
  it('an edit made by a subscriber on the idle notification is still sent', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    let edited = false;
    e.subscribe(() => { if (e.status() === 'idle' && !edited) { edited = true; e.setTerms(state('late')); } });
    e.setTerms(state('b'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.impl).toHaveBeenCalledTimes(2);
    expect(f.calls[1]).toMatchObject([{ op: 'putPlan', data: { name: 'late' } }]);
    expect(e.hasPending()).toBe(false);
  });

  it('a subscriber calling flush() on saving does not start a second concurrent request', async () => {
    const f = fakeSend();
    let inFlight = 0;
    let maxInFlight = 0;
    f.impl.mockImplementation(async (ops) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      const r = await f.base(ops);
      await Promise.resolve();
      inFlight--;
      return r;
    });
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.subscribe(() => { if (e.status() === 'saving') void e.flush(); });
    e.setTerms(state('b'));
    await vi.advanceTimersByTimeAsync(800);
    expect(f.impl).toHaveBeenCalledTimes(1);
    expect(maxInFlight).toBe(1);
  });

  it('an edit while offline keeps the backoff schedule instead of the debounce', async () => {
    const f = fakeSend();
    f.impl.mockResolvedValueOnce(fail('network'));
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.setTerms(state('b'));
    await vi.advanceTimersByTimeAsync(800);
    expect(e.status()).toBe('offline');
    e.setTerms(state('c'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.impl).toHaveBeenCalledTimes(1); // not retried after the 800 ms debounce
    await vi.advanceTimersByTimeAsync(500); // the 2 s backoff
    expect(f.impl).toHaveBeenCalledTimes(2);
    expect(f.calls[0]).toMatchObject([{ data: { name: 'c' } }]); // the failed attempt never reached base()
  });

  it('dispose during a request: no further sends, no status change, hasPending false', async () => {
    const f = fakeSend();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    f.impl.mockImplementationOnce(async (ops) => { const r = await f.base(ops); await gate; return r; });
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    e.setTerms(state('b'));
    await vi.advanceTimersByTimeAsync(800);
    e.setTerms(state('c'));
    e.dispose();
    expect(e.hasPending()).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.impl).toHaveBeenCalledTimes(1);
    expect(e.status()).toBe('saving');
  });

  it('notifies subscribers once per status change, not per edit', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    const fn = vi.fn();
    const off = e.subscribe(fn);
    e.setTerms(state('b')); e.setTerms(state('c'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(fn).toHaveBeenCalledTimes(2); // saving, idle
    off();
    e.setTerms(state('d'));
    await vi.advanceTimersByTimeAsync(800);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('unload guard and bfcache', () => {
  it('a keepalive send is followed by a reload on a persisted pageshow only', async () => {
    const fetchMock = vi.fn(async (..._a: unknown[]) => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state()), send: f.impl });
    const reload = vi.fn();
    const off = installUnloadGuard(e, reload);
    const show = (persisted: boolean) => { const ev = new Event('pageshow') as Event & { persisted: boolean }; ev.persisted = persisted; window.dispatchEvent(ev); };
    show(true); // no keepalive happened yet: nothing to reload for
    expect(reload).not.toHaveBeenCalled();
    e.setTerms(state('b'));
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.ops).toMatchObject([{ op: 'putPlan', data: { name: 'b' } }]);
    show(false);
    expect(reload).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    show(true);
    expect(reload).toHaveBeenCalledTimes(1);
    off();
    vi.unstubAllGlobals();
  });
});

describe('matchesServer', () => {
  it('matches its own snapshot, then the server state its acks describe; a change elsewhere does not match', async () => {
    const f = fakeSend();
    const e = createSyncEngine({ snapshot: snap(state(), [course('x')]), send: f.impl });
    expect(e.matchesServer(snap(state(), [course('x')]))).toBe(true);
    e.setTerms(state('b'));
    await e.flush();
    // fakeSend acked the plan with version 101; the term doc did not change (still 5).
    const after = snap(state('b'), [course('x')]);
    after.plans.a!.version = 101;
    expect(e.matchesServer(after)).toBe(true);
    expect(e.matchesServer(snap(state('b'), [course('x')]))).toBe(false); // the plan is at another version
    after.pool = [course('x'), course('y')];
    expect(e.matchesServer(after)).toBe(false); // a course arrived from another device
    e.dispose();
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
    for (const x of fb) expect(JSON.stringify({ ops: x }).length).toBeLessThanOrEqual(1_000_000);
  });
});
