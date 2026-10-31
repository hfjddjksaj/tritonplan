import { expect, test } from 'vitest';
import { createApp } from '../app';
import { createSession } from '../auth/sessions';
import { createUser } from '../auth/users';
import { testDeps } from '../test-helpers';
import { replaceTeachers } from './store';

const now = new Date('2026-01-15T12:00:00.000Z');

function setup() {
  const deps = testDeps();
  const app = createApp(deps);
  const u = createUser(deps.db, { email: 'a@ucsd.edu', verified: true, passwordHash: null, googleSub: null }, now);
  const token = createSession(deps.db, u.id, now);
  replaceTeachers(deps.db, [
    { legacyId: 11, firstName: 'Leo', lastName: 'Porter', department: 'CS', avgRating: 4.6, numRatings: 40 },
    { legacyId: 12, firstName: 'Joe', lastName: 'Politz', department: 'CS', avgRating: 4, numRatings: 5 },
    { legacyId: 13, firstName: 'Joe', lastName: 'Politz', department: 'Math', avgRating: 3, numRatings: 6 },
  ], now.toISOString());
  const get = (qs: string, signedIn = true) => app.request(`/api/rmp${qs}`, { headers: signedIn ? { Cookie: `tp_session=${token}` } : {} });
  return { get };
}

test('/api/rmp requires sign-in and validates the name list', async () => {
  const { get } = setup();
  expect((await get('?name=Leo%20Porter', false)).status).toBe(401);

  const bad = ['', '?name=', '?name=%20%20', '?other=x', `?name=${'a'.repeat(101)}`, '?name=ok&name=', '?' + Array.from({ length: 21 }, (_, i) => `name=n${i}`).join('&')];
  for (const qs of bad) {
    const res = await get(qs);
    expect(res.status, qs.slice(0, 40)).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  }

  expect((await get(`?name=${'a'.repeat(100)}`)).status).toBe(200);
  expect((await get('?' + Array.from({ length: 20 }, (_, i) => `name=n${i}`).join('&'))).status).toBe(200);
});

test('results come back in request order, trimmed names echoed, unsafe names unmatched', async () => {
  const { get } = setup();
  const res = await get('?name=Joe%20Politz&name=%20leo%20%20porter%20&name=Zed%20Nobody');
  expect(res.status).toBe(200);
  const { results } = (await res.json()) as { results: { name: string; match: { legacyId: number } | null; searchUrl: string }[] };
  expect(results.map((r) => r.name)).toEqual(['Joe Politz', 'leo  porter', 'Zed Nobody']);
  expect(results.map((r) => r.match?.legacyId ?? null)).toEqual([null, 11, null]);
  expect(results[0]!.searchUrl).toBe('https://www.ratemyprofessors.com/search/professors/1079?q=Joe%20Politz');
});
