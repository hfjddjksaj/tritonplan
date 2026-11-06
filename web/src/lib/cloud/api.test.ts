import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanState } from '@triton/shared';
import {
  apiDelete, apiPost, createSharedPlan, fetchMe, fetchShare, fetchSharedPlan, fetchSharedVersion, fetchState, listSharedPlans, selectSharedOption, googleCalendarUrl, postSync, syncTimeoutMs, termCalendarLinks, UnauthorizedError,
} from './api';

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

describe('shares', () => {
  const plan: PlanState = { version: 1, term: { year: '2026', period: '2', label: 'Fall 2026' }, entries: [] };

  const doc = { name: 'n', plan, version: 3, expiresAt: '2026-01-08T00:00:00Z' };

  it('fetchSharedPlan: doc on 200, not-found on 404, null for everything else', async () => {
    stub(async () => res(200, doc));
    expect(await fetchSharedPlan('a/b')).toEqual(doc);
    expect(calls()[0]![0]).toBe('/api/s/a%2Fb');
    stub(async () => res(404, { error: 'not_found' }));
    expect(await fetchSharedPlan('abc')).toBe('not-found');
    stub(async () => res(429, { error: 'rate_limited' }));
    expect(await fetchSharedPlan('abc')).toBeNull();
    stub(async () => res(503));
    expect(await fetchSharedPlan('abc')).toBeNull();
    stub(async () => { throw new TypeError('offline'); });
    expect(await fetchSharedPlan('abc')).toBeNull();
    stub(async () => res(200, 'not json'));
    expect(await fetchSharedPlan('abc')).toBeNull();
  });

  it('fetchShare wraps fetchSharedPlan in the old shape', async () => {
    stub(async () => res(200, doc));
    expect(await fetchShare('abc')).toEqual({ name: 'n', plan, createdAt: '' });
    stub(async () => res(404));
    expect(await fetchShare('abc')).toBe('not-found');
  });

  it('fetchSharedVersion: number on 200, not-found on 404, null otherwise', async () => {
    stub(async () => res(200, { version: 5 }));
    expect(await fetchSharedVersion('a b')).toBe(5);
    expect(calls()[0]![0]).toBe('/api/s/a%20b/version');
    stub(async () => res(200, { version: 'x' }));
    expect(await fetchSharedVersion('abc')).toBeNull();
    stub(async () => res(404));
    expect(await fetchSharedVersion('abc')).toBe('not-found');
    stub(async () => res(429, { error: 'rate_limited' }));
    expect(await fetchSharedVersion('abc')).toBeNull();
    stub(async () => { throw new TypeError('x'); });
    expect(await fetchSharedVersion('abc')).toBeNull();
  });

  it('selectSharedOption: posts the pick; version, not-found, invalid, null', async () => {
    stub(async () => res(200, { version: 4 }));
    expect(await selectSharedOption('a/b', 'c1', 'o1')).toBe(4);
    expect(calls()[0]![0]).toBe('/api/s/a%2Fb/select');
    expect(calls()[0]![1].method).toBe('POST');
    expect(JSON.parse(String(calls()[0]![1].body))).toEqual({ courseId: 'c1', optionId: 'o1' });
    stub(async () => res(404));
    expect(await selectSharedOption('abc', 'c', 'o')).toBe('not-found');
    stub(async () => res(400, { error: 'invalid_request' }));
    expect(await selectSharedOption('abc', 'c', 'o')).toBe('invalid');
    stub(async () => res(500));
    expect(await selectSharedOption('abc', 'c', 'o')).toBeNull();
    stub(async () => res(429, { error: 'rate_limited', retryAfter: 3 }));
    expect(await selectSharedOption('abc', 'c', 'o')).toBeNull();
    stub(async () => { throw new TypeError('x'); });
    expect(await selectSharedOption('abc', 'c', 'o')).toBeNull();
    stub(async () => res(200, {}));
    expect(await selectSharedOption('abc', 'c', 'o')).toBeNull();
  });

  it('listSharedPlans: the list on 200, null on failure', async () => {
    const item = { code: 'abcdefghij', url: 'https://x/s/abcdefghij', name: 'n', termKey: '2026|2', createdAt: 'a', expiresAt: 'b' };
    stub(async () => res(200, { shared: [item] }));
    expect(await listSharedPlans()).toEqual([item]);
    expect(calls()[0]![0]).toBe('/api/shared');
    stub(async () => res(200, {}));
    expect(await listSharedPlans()).toBeNull();
    stub(async () => res(401, { error: 'unauthorized' }));
    expect(await listSharedPlans()).toBeNull();
    stub(async () => { throw new TypeError('x'); });
    expect(await listSharedPlans()).toBeNull();
  });

  it('createSharedPlan: link on 200, the server error string otherwise', async () => {
    const out = { code: 'abcdefghij', url: 'https://x/s/abcdefghij', expiresAt: 'b' };
    stub(async () => res(200, out));
    expect(await createSharedPlan('n', plan)).toEqual(out);
    expect(calls()[0]![0]).toBe('/api/shared');
    expect(JSON.parse(String(calls()[0]![1].body))).toEqual({ name: 'n', plan });
    stub(async () => res(409, { error: 'too_many_shares' }));
    expect(await createSharedPlan('n', plan)).toEqual({ error: 'too_many_shares' });
    stub(async () => res(413, { error: 'doc_too_large' }));
    expect(await createSharedPlan('n', plan)).toEqual({ error: 'doc_too_large' });
    stub(async () => res(429, { error: 'rate_limited', retryAfter: 9 }));
    expect(await createSharedPlan('n', plan)).toEqual({ error: 'rate_limited' });
    stub(async () => res(401, { error: 'unauthorized' }));
    expect(await createSharedPlan('n', plan)).toEqual({ error: 'unauthorized' });
    stub(async () => res(502, 'bad gateway'));
    expect(await createSharedPlan('n', plan)).toEqual({ error: 'server' });
    stub(async () => res(200, { nope: 1 }));
    expect(await createSharedPlan('n', plan)).toEqual({ error: 'server' });
    stub(async () => { throw new TypeError('x'); });
    expect(await createSharedPlan('n', plan)).toEqual({ error: 'network' });
  });
});

describe('googleCalendarUrl', () => {
  const WEBCAL = 'webcal://tritonplan.cn/api/cal/secret.ics';

  it('opens Google add-by-URL page with the feed filled in, marked so Google fetches it afresh', () => {
    expect(googleCalendarUrl(WEBCAL, 'abc')).toBe(
      'https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Ftritonplan.cn%2Fapi%2Fcal%2Fsecret.ics%3Fv%3Dabc',
    );
  });

  it('each link is a URL Google has not seen: its cache of the feed cannot answer for it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(1_000);
      const first = googleCalendarUrl(WEBCAL);
      vi.setSystemTime(2_000);
      expect(googleCalendarUrl(WEBCAL)).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('termCalendarLinks', () => {
  it("puts one term's feed under the account's link", () => {
    expect(termCalendarLinks({ https: 'https://tritonplan.cn/api/cal/s.ics', webcal: 'webcal://tritonplan.cn/api/cal/s.ics' }, '2026|3'))
      .toEqual({ https: 'https://tritonplan.cn/api/cal/s/2026-3.ics', webcal: 'webcal://tritonplan.cn/api/cal/s/2026-3.ics' });
  });
});
