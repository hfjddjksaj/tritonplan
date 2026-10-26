import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiDelete, apiPost, fetchMe, fetchState, postSync, UnauthorizedError } from './api';

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

describe('postSync', () => {
  it.each([[409, 'conflict'], [401, 'unauthorized'], [400, 'rejected'], [413, 'rejected'], [500, 'network'], [503, 'network']])(
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
