import { expect, test } from 'vitest';
import { fetchAllTeachers } from './fetch';

const node = (id: number, over: object = {}) => ({ legacyId: id, firstName: 'A', lastName: `B${id}`, department: 'CS', avgRating: 4.2, numRatings: 3, ...over });
const body = (nodes: object[], hasNextPage: boolean, endCursor: string | null) => ({
  data: { search: { teachers: { edges: nodes.map((n) => ({ node: n })), pageInfo: { hasNextPage, endCursor } } } },
});
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

test('fetchAllTeachers pages until hasNextPage is false and sends the honest headers', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const pages = [body([node(1), node(2, { department: null, avgRating: null, numRatings: 0 })], true, 'c1'), body([node(3)], false, 'c2')];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return json(pages[calls.length - 1]);
  }) as unknown as typeof fetch;

  const rows = await fetchAllTeachers(fake);
  expect(rows.map((r) => r.legacyId)).toEqual([1, 2, 3]);
  expect(rows[1]).toMatchObject({ department: null, avgRating: null, numRatings: 0 });
  expect(calls).toHaveLength(2);
  for (const c of calls) {
    expect(c.url).toBe('https://www.ratemyprofessors.com/graphql');
    expect(c.init.method).toBe('POST');
    const h = new Headers(c.init.headers);
    expect(h.get('authorization')).toBe('Basic dGVzdDp0ZXN0');
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('user-agent')).toBe('TritonPlan/2.0 (+https://tritonplan.cn)');
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
  }
  const vars = (i: number) => JSON.parse(calls[i]!.init.body as string).variables;
  expect(vars(0)).toEqual({ count: 1000, cursor: null, query: { text: '', schoolID: 'U2Nob29sLTEwNzk=', fallback: false } });
  expect(vars(1).cursor).toBe('c1');
});

test('a bad status, a wrong shape or a never-ending roster throws instead of returning part of it', async () => {
  const run = (f: () => Response) => fetchAllTeachers((async () => f()) as unknown as typeof fetch);
  await expect(run(() => json({ errors: ['x'] }, 500))).rejects.toThrow('RMP responded 500');
  await expect(run(() => json({ data: { search: null } }))).rejects.toThrow(/unexpected shape/);
  await expect(run(() => json(body([node(1, { legacyId: '1' })], false, null)))).rejects.toThrow(/unexpected shape/);
  await expect(run(() => json(body([node(1)], true, null)))).rejects.toThrow(/no cursor/);
  let n = 0;
  const endless = (async () => json(body([node(++n)], true, `c${n}`))) as unknown as typeof fetch;
  await expect(fetchAllTeachers(endless)).rejects.toThrow(/10 pages/);
  expect(n).toBe(10);

  // A second-page failure discards the first page too.
  let k = 0;
  const flaky = (async () => (k++ === 0 ? json(body([node(1)], true, 'c')) : json({}, 502))) as unknown as typeof fetch;
  await expect(fetchAllTeachers(flaky)).rejects.toThrow('RMP responded 502');
});
