import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb } from '../db/db';
import { startRmpRefresh } from './refresh';
import { replaceTeachers, rmpFetchedAt } from './store';

const DAY = 24 * 3600_000;
const T0 = new Date('2026-06-01T00:00:00.000Z');

const okPage = (id: number) =>
  new Response(JSON.stringify({
    data: { search: { teachers: {
      edges: [{ node: { legacyId: id, firstName: 'New', lastName: 'Prof', department: 'CS', avgRating: 4, numRatings: 2 } }],
      pageInfo: { hasNextPage: false, endCursor: 'x' },
    } } },
  }));

let clock = T0.getTime();
beforeEach(() => {
  vi.useFakeTimers();
  clock = T0.getTime();
});
afterEach(() => vi.useRealTimers());

function setup(fetchImpl: () => Promise<Response>) {
  const db = openDb(':memory:');
  const fetch = vi.fn(fetchImpl) as unknown as typeof globalThis.fetch & ReturnType<typeof vi.fn>;
  const deps = { db, fetch, now: () => new Date(clock) };
  return { db, fetch, deps };
}
const ids = (db: ReturnType<typeof openDb>) => (db.prepare('SELECT legacy_id AS id FROM rmp_teachers').all() as { id: number }[]).map((r) => r.id);

test('refresh runs at boot only when the data is missing or over 30 days old', async () => {
  // Missing: fetch once.
  const a = setup(async () => okPage(1));
  const stopA = startRmpRefresh(a.deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(a.fetch).toHaveBeenCalledTimes(1);
  expect(ids(a.db)).toEqual([1]);
  expect(rmpFetchedAt(a.db)).toBe(T0.toISOString());
  stopA();

  // 29 days old: no fetch at boot.
  const b = setup(async () => okPage(2));
  replaceTeachers(b.db, [], new Date(clock - 29 * DAY).toISOString());
  const stopB = startRmpRefresh(b.deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(b.fetch).not.toHaveBeenCalled();
  stopB();

  // 31 days old: fetch.
  const c = setup(async () => okPage(3));
  replaceTeachers(c.db, [], new Date(clock - 31 * DAY).toISOString());
  const stopC = startRmpRefresh(c.deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(c.fetch).toHaveBeenCalledTimes(1);
  stopC();
});

test('a failed page throws and leaves the stored teachers untouched', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { db, deps, fetch } = setup(async () => new Response('SECRET-BODY', { status: 503 }));
  replaceTeachers(db, [{ legacyId: 7, firstName: 'Old', lastName: 'Data', department: null, avgRating: null, numRatings: 0 }], new Date(clock - 40 * DAY).toISOString());
  const before = rmpFetchedAt(db);

  const stop = startRmpRefresh(deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(ids(db)).toEqual([7]);
  expect(rmpFetchedAt(db)).toBe(before);
  expect(err).toHaveBeenCalledTimes(1);
  expect(String(err.mock.calls[0]!.join(' '))).toBe('RMP refresh failed: RMP responded 503');
  expect(err.mock.calls[0]).toHaveLength(1);
  stop();
  err.mockRestore();
});

test('after a failure the next attempt waits for the daily check, and one fetch runs at a time', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  let release!: (r: Response) => void;
  let mode: 'fail' | 'hang' | 'ok' = 'fail';
  const { db, deps, fetch } = setup(() => {
    if (mode === 'fail') return Promise.reject(new Error('network down'));
    if (mode === 'ok') return Promise.resolve(okPage(5));
    return new Promise<Response>((res) => (release = res));
  });

  const stop = startRmpRefresh(deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(err).toHaveBeenCalledTimes(1);
  expect(err.mock.calls[0]).toEqual(['RMP refresh failed: network down']);

  // No immediate retry, however long we wait short of a day.
  await vi.advanceTimersByTimeAsync(DAY - 1000);
  expect(fetch).toHaveBeenCalledTimes(1);

  // The daily tick starts a fetch that hangs; a further tick while it runs must not start another.
  mode = 'hang';
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(DAY);
  expect(fetch).toHaveBeenCalledTimes(2);

  mode = 'ok';
  release(okPage(5));
  await vi.advanceTimersByTimeAsync(0);
  expect(ids(db)).toEqual([5]);
  expect(err).toHaveBeenCalledTimes(1);

  // Fresh data now: later ticks are quiet until it is 30 days old.
  await vi.advanceTimersByTimeAsync(DAY);
  expect(fetch).toHaveBeenCalledTimes(2);
  stop();
  err.mockRestore();
});

const pageOf = (n: number, startId = 100) =>
  new Response(JSON.stringify({
    data: { search: { teachers: {
      edges: Array.from({ length: n }, (_, i) => ({ node: { legacyId: startId + i, firstName: 'F', lastName: `L${i}`, department: null, avgRating: null, numRatings: 0 } })),
      pageInfo: { hasNextPage: false, endCursor: null },
    } } },
  }));
const seed = (db: ReturnType<typeof openDb>, n: number) =>
  replaceTeachers(db, Array.from({ length: n }, (_, i) => ({ legacyId: i + 1, firstName: 'Old', lastName: `P${i}`, department: null, avgRating: null, numRatings: 0 })), new Date(clock - 40 * DAY).toISOString());

test('an empty or less-than-half roster keeps the old rows and the old timestamp', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const [n, msg] of [[0, /empty/], [4, /shrunk/]] as const) {
    err.mockClear();
    const { db, deps } = setup(async () => pageOf(n));
    seed(db, 10);
    const before = rmpFetchedAt(db);
    const stop = startRmpRefresh(deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(ids(db)).toHaveLength(10);
    expect(rmpFetchedAt(db)).toBe(before);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toMatch(msg);
    stop();
  }
  // Exactly half is allowed through.
  const { db, deps } = setup(async () => pageOf(5));
  seed(db, 10);
  const stop = startRmpRefresh(deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(ids(db)).toHaveLength(5);
  expect(rmpFetchedAt(db)).toBe(T0.toISOString());
  stop();
  err.mockRestore();
});

test('a 200 HTML page logs one fixed line with nothing from the body', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { deps } = setup(async () => new Response('<!DOCTYPE html><title>challenge</title>', { status: 200 }));
  const stop = startRmpRefresh(deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(err.mock.calls).toEqual([['RMP refresh failed: RMP response was not JSON']]);
  expect(String(err.mock.calls[0]![0])).not.toContain('<');
  stop();
  err.mockRestore();
});

test('a throwing db read ends as one log line and the next daily check still runs', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { db, deps, fetch } = setup(async () => okPage(8));
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  vi.spyOn(db, 'prepare').mockImplementationOnce(() => { throw new Error('db is locked'); });
  const stop = startRmpRefresh(deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(err.mock.calls).toEqual([['RMP refresh failed: db is locked']]);
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(DAY);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(ids(db)).toEqual([8]);
  expect(unhandled).not.toHaveBeenCalled();
  process.off('unhandledRejection', unhandled);
  stop();
  err.mockRestore();
});

test('stop cancels the daily check, and the timer does not hold the process open', async () => {
  const { deps, fetch } = setup(async () => okPage(1));
  const unref = vi.spyOn(global, 'setInterval');
  const stop = startRmpRefresh(deps);
  const timer = unref.mock.results[0]!.value as { hasRef: () => boolean };
  expect(timer.hasRef()).toBe(false);
  unref.mockRestore();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  stop();
  clock += 60 * DAY;
  await vi.advanceTimersByTimeAsync(5 * DAY);
  expect(fetch).toHaveBeenCalledTimes(1);
});
