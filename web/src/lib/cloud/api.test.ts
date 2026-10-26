import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDelete, apiPost, fetchMe, fetchState, postSync, syncTimeoutMs, UnauthorizedError } from './api';

const res = (status: number, body: unknown = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const stub = (fn: (...a: unknown[]) => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(fn));
const calls = () => (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
afterEach(() => vi.unstubAllGlobals());

describe('fetchMe / fetchState', () => {
  it('200 → Me, 401 → null, other → throws', async () => {
    stub(async () => res(200, { email: 'a@b.c', hasPassword: true, hasGoogle: false }));
    expect((await fetchMe())?.email).toBe('a@b.c');
    stub(async () => res(401));
    expect(await fetchMe()).toBeNull();
    stub(async () => res(500));
    await expect(fetchMe()).rejects.toThrow();
    stub(async () => { throw new TypeError('offline'); });
    await expect(fetchMe()).rejects.toThrow();
  });
  it('fetchState 401 → UnauthorizedError; 200 → snapshot; sends same-origin credentials', async () => {
    stub(async () => res(401));
    await expect(fetchState()).rejects.toBeInstanceOf(UnauthorizedError);
    const snap = { terms: {}, plans: {}, pool: [], appt: null };
    stub(async () => res(200, snap));
    expect(await fetchState()).toEqual(snap);
    expect(calls()[0]![1]).toMatchObject({ credentials: 'same-origin' });
  });
});

describe('fetchMe / fetchState on a slow or hung server', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Any AbortSignal.timeout runs on the fake clock too, so the test holds for either way of timing out.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
      return c.signal;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Like a real fetch: headers after `headersMs` (never, if null), then the body after
   * `bodyMs` more; aborting the signal fails whichever is still outstanding.
   */
  function slowServer(headersMs: number | null, bodyMs: number, body: unknown) {
    stub((...a: unknown[]) => {
      const signal = (a[1] as RequestInit).signal!;
      return new Promise<Response>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
        if (headersMs === null) return;
        setTimeout(() => {
          let done = false;
          const stream = new ReadableStream<Uint8Array>({
            start(c) {
              signal.addEventListener('abort', () => { if (!done) { done = true; c.error(signal.reason); } });
              setTimeout(() => {
                if (done) return;
                done = true;
                c.enqueue(new TextEncoder().encode(JSON.stringify(body)));
                c.close();
              }, bodyMs);
            },
          });
          resolve(new Response(stream, { status: 200 }));
        }, headersMs);
      });
    });
  }
  function track(p: Promise<unknown>) {
    const t: { settled: boolean; value?: unknown; error?: unknown } = { settled: false };
    p.then((v) => { t.settled = true; t.value = v; }, (e: unknown) => { t.settled = true; t.error = e; });
    return t;
  }

  it('no headers within 15 s → gives up, as a network failure (not a sign-out)', async () => {
    slowServer(null, 0, {});
    const me = track(fetchMe());
    const state = track(fetchState());
    await vi.advanceTimersByTimeAsync(14_999);
    expect(me.settled || state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(me.error).toBeDefined();
    expect(state.error).toBeDefined();
    expect(state.error).not.toBeInstanceOf(UnauthorizedError);
  });

  it('headers in time but a body that takes longer than 15 s still loads', async () => {
    const snap = { terms: {}, plans: {}, pool: [], appt: null };
    slowServer(200, 40_000, snap);
    const state = track(fetchState());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.settled).toBe(false); // still downloading, not given up on
    await vi.advanceTimersByTimeAsync(10_200);
    expect(state.error).toBeUndefined();
    expect(state.value).toEqual(snap);

    const me = { email: 'a@b.c', hasPassword: true, hasGoogle: false };
    slowServer(200, 20_000, me);
    const got = track(fetchMe());
    await vi.advanceTimersByTimeAsync(20_200);
    expect(got.value).toEqual(me);
  });
});

describe('postSync', () => {
  it.each([[409, 'conflict'], [401, 'unauthorized'], [400, 'rejected'], [403, 'rejected'], [413, 'rejected'], [429, 'network'], [500, 'network'], [503, 'network']])(
    'status %i → %s', async (status, kind) => {
      stub(async () => res(status, {}));
      expect(await postSync([])).toEqual({ ok: false, kind });
    });
  it('200 → versions; sends JSON with credentials', async () => {
    stub(async () => res(200, { ok: true, versions: { terms: { t: 3 }, plans: {} } }));
    expect(await postSync([{ op: 'deleteCourses', ids: ['a'] }])).toEqual({ ok: true, versions: { terms: { t: 3 }, plans: {} } });
    const [url, init] = calls()[0]!;
    expect(url).toBe('/api/sync');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(init.body as string)).toEqual({ ops: [{ op: 'deleteCourses', ids: ['a'] }] });
  });
  it('the timeout grows with the body: 20 s + 1 s per 25 KB', () => {
    expect(syncTimeoutMs(0)).toBe(20_000);
    expect(syncTimeoutMs(25_000)).toBe(21_000);
    expect(syncTimeoutMs(25_001)).toBe(22_000);
    expect(syncTimeoutMs(1_000_000)).toBe(60_000);
  });
  it('passes a timeout signal, and an abort maps to network', async () => {
    stub(async () => { throw new DOMException('timed out', 'TimeoutError'); });
    expect(await postSync([])).toEqual({ ok: false, kind: 'network' });
    expect(calls()[0]![1].signal).toBeInstanceOf(AbortSignal);
  });
  it('network error and bad JSON → network', async () => {
    stub(async () => { throw new TypeError('x'); });
    expect(await postSync([])).toEqual({ ok: false, kind: 'network' });
    stub(async () => res(200, 'not json'));
    expect(await postSync([])).toEqual({ ok: false, kind: 'network' });
  });
});

describe('apiPost / apiDelete', () => {
  it('ok body, error shape with retryAfter, network failure', async () => {
    stub(async () => res(200, { ok: true }));
    expect(await apiPost('/api/x', { a: 1 })).toEqual({ ok: true, body: { ok: true } });
    stub(async () => res(429, { error: 'rate_limited', retryAfter: 7 }));
    expect(await apiPost('/api/x', {})).toEqual({ ok: false, status: 429, error: 'rate_limited', retryAfter: 7 });
    stub(async () => res(400, 'garbage'));
    expect(await apiDelete('/api/x', {})).toMatchObject({ ok: false, status: 400 });
    expect(calls()[0]![1].method).toBe('DELETE');
    stub(async () => { throw new TypeError('x'); });
    expect(await apiPost('/api/x', {})).toMatchObject({ ok: false, status: 0, error: 'network' });
  });
});
