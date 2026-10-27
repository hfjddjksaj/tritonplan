import { expect, test } from 'vitest';
import type { CourseOffering, PlanState } from '@triton/shared';
import { createApp } from '../app';
import { createSession } from '../auth/sessions';
import { createUser } from '../auth/users';
import { testDeps } from '../test-helpers';

const now = new Date('2026-01-15T12:00:00.000Z');
const T = now.toISOString();

function planFor(subject: string, id: string): PlanState {
  const course: CourseOffering = {
    id, moduleId: '1', subject, number: '100', courseCode: `${subject}-100`, title: subject,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    options: [{
      id: 'o1', code: 'A00', enrollCode: 'o1',
      components: [{
        id: 'E 1', type: 'LE', typeText: 'Lecture', sectionCode: '001', instructors: [],
        meetings: [{ days: ['Tue'], start: '09:00', end: '10:00', modality: 'In Person' }],
        unscheduled: false, beginDate: '2026-09-24', endDate: '2026-12-04', rawSched: '',
      }],
    }],
  };
  return { version: 1, term: course.term, entries: [{ course, selectedOptionId: 'o1' }] };
}

function setup() {
  const deps = testDeps();
  const app = createApp(deps);
  const mk = (email: string) => {
    const u = createUser(deps.db, { email, verified: true, passwordHash: null, googleSub: null }, now);
    return { ...u, email, token: createSession(deps.db, u.id, now) };
  };
  const send = (method: string, path: string, body: unknown, token?: string) =>
    app.request(path, {
      method,
      headers: { Origin: 'https://tritonplan.cn', 'Content-Type': 'application/json', ...(token ? { Cookie: `tp_session=${token}` } : {}) },
      body: JSON.stringify(body),
    });
  const get = (path: string, token?: string) => app.request(path, { headers: token ? { Cookie: `tp_session=${token}` } : {} });
  const putPlan = (userId: string, planId: string, termKey: string, p: PlanState) =>
    deps.db.prepare('INSERT INTO plan_docs VALUES (?, ?, ?, 1, ?, ?)').run(userId, planId, termKey, JSON.stringify(p), T);
  const link = async (token: string) => (await (await send('POST', '/api/calendar/link', {}, token)).json()) as { https: string; webcal: string };
  const path = (https: string) => new URL(https).pathname;
  return { deps, mk, send, get, putPlan, link, path };
}

test('the feed works without signing in and contains no email or user id', async () => {
  const { mk, send, get, putPlan, link, path } = setup();
  const u = mk('owner@ucsd.edu');
  putPlan(u.id, 'plan-abc', 'FA26', planFor('CSE', 'CSE 100|2026|2'));
  expect((await send('PUT', '/api/calendar', { terms: { FA26: 'plan-abc' } }, u.token)).status).toBe(200);
  const { https, webcal } = await link(u.token);
  expect(https).toMatch(/^https:\/\/tritonplan\.cn\/api\/cal\/[A-Za-z0-9_-]{43}\.ics$/);
  expect(webcal).toBe(https.replace('https://', 'webcal://'));

  const res = await get(path(https)); // no cookie, no Origin
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
  expect(res.headers.get('cache-control')).toBe('no-cache');
  const body = await res.text();
  expect(body).toContain('SUMMARY:CSE 100 Lecture');
  expect(body).not.toContain('owner@ucsd.edu');
  expect(body).not.toContain(u.id);
  expect(body).not.toContain('plan-abc');
});

test('only the selected plan per term is in the feed', async () => {
  const { mk, send, get, putPlan, link, path } = setup();
  const u = mk('a@ucsd.edu');
  putPlan(u.id, 'p1', 'FA26', planFor('CSE', 'CSE 100|2026|2'));
  putPlan(u.id, 'p2', 'FA26', planFor('MATH', 'MATH 100|2026|2'));
  await send('PUT', '/api/calendar', { terms: { FA26: 'p2' } }, u.token);
  const { https } = await link(u.token);
  const body = await (await get(path(https))).text();
  expect(body).toContain('SUMMARY:MATH 100 Lecture');
  expect(body).not.toContain('CSE 100');
  const state = await (await get('/api/calendar', u.token)).json();
  expect(state).toEqual({ https, webcal: https.replace('https://', 'webcal://'), terms: { FA26: 'p2' }, missing: [] });
});

test('a selected plan that was deleted is reported missing and left out', async () => {
  const { deps, mk, send, get, putPlan, link, path } = setup();
  const u = mk('a@ucsd.edu');
  putPlan(u.id, 'p1', 'FA26', planFor('CSE', 'CSE 100|2026|2'));
  putPlan(u.id, 'p2', 'WI27', planFor('MATH', 'MATH 100|2026|2'));
  await send('PUT', '/api/calendar', { terms: { FA26: 'p1', WI27: 'p2', SP27: 'ghost' } }, u.token);
  const { https } = await link(u.token);

  // A plan id that exists but under another term does not count either (P4).
  expect(((await (await get('/api/calendar', u.token)).json()) as { missing: string[] }).missing).toEqual(['SP27']);
  await send('PUT', '/api/calendar', { terms: { FA26: 'p2' } }, u.token);
  expect(((await (await get('/api/calendar', u.token)).json()) as { missing: string[] }).missing).toEqual(['FA26']);

  await send('PUT', '/api/calendar', { terms: { FA26: 'p1', WI27: 'p2' } }, u.token);
  deps.db.prepare('DELETE FROM plan_docs WHERE plan_id = ?').run('p1');
  const state = (await (await get('/api/calendar', u.token)).json()) as { missing: string[]; terms: object };
  expect(state.missing).toEqual(['FA26']);
  expect(state.terms).toEqual({ FA26: 'p1', WI27: 'p2' });
  const body = await (await get(path(https))).text();
  expect(body).not.toContain('CSE 100');
  expect(body).toContain('SUMMARY:MATH 100 Lecture');
});

test('reset makes the old link 404 immediately', async () => {
  const { mk, send, get, link, path } = setup();
  const u = mk('a@ucsd.edu');
  const old = await link(u.token);
  expect((await get(path(old.https))).status).toBe(200);
  const res = await send('POST', '/api/calendar/reset', {}, u.token);
  expect(res.status).toBe(200);
  const fresh = (await res.json()) as { https: string; webcal: string };
  expect(fresh.https).not.toBe(old.https);
  expect(fresh.webcal).toBe(fresh.https.replace('https://', 'webcal://'));
  expect((await get(path(old.https))).status).toBe(404);
  expect((await get(path(fresh.https))).status).toBe(200);
});

test('link creation is idempotent; deleting the account removes the feed', async () => {
  const { deps, mk, send, get, link, path } = setup();
  const u = mk('a@ucsd.edu');
  const o = mk('o@ucsd.edu');
  const first = await link(u.token);
  expect(await link(u.token)).toEqual(first);
  const other = await link(o.token);
  expect(other.https).not.toBe(first.https);
  await send('PUT', '/api/calendar', { terms: { FA26: 'p1' } }, u.token);

  const res = await send('DELETE', '/api/account', { confirmEmail: 'a@ucsd.edu' }, u.token);
  expect(res.status).toBe(200);
  expect((await get(path(first.https))).status).toBe(404);
  expect((await get(path(other.https))).status).toBe(200);
  expect(deps.db.prepare('SELECT COUNT(*) AS n FROM calendar_feeds').get()).toEqual({ n: 1 });
});

test('bad file names and unknown secrets are 404', async () => {
  const { mk, get, link } = setup();
  const u = mk('a@ucsd.edu');
  const { https } = await link(u.token);
  const secret = https.slice(https.lastIndexOf('/') + 1, -4);
  const bad = [
    `${secret}`, `${secret}.ICS`, `${secret}.ics.txt`, `${secret.slice(1)}.ics`, `${secret}x.ics`, `${'A'.repeat(43)}.ics`, '.ics', '..%2Fx.ics',
  ];
  for (const f of bad) {
    const res = await get(`/api/cal/${f}`);
    expect(res.status, f).toBe(404);
    expect(await res.text()).toBe('Not found');
  }
});

test('calendar management needs an account and passes the write guard', async () => {
  const { deps, mk, send, get } = setup();
  expect((await get('/api/calendar')).status).toBe(401);
  expect((await send('PUT', '/api/calendar', { terms: {} })).status).toBe(401);
  expect((await send('POST', '/api/calendar/link', {})).status).toBe(401);
  expect((await send('POST', '/api/calendar/reset', {})).status).toBe(401);
  const u = mk('a@ucsd.edu');
  const wrong = await createApp(deps).request('/api/calendar/link', {
    method: 'POST', headers: { Cookie: `tp_session=${u.token}`, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}',
  });
  expect(wrong.status).toBe(403);
  expect(await (await get('/api/calendar', u.token)).json()).toEqual({ https: null, webcal: null, terms: {}, missing: [] });
});

test('PUT validates the picks', async () => {
  const { mk, send, get } = setup();
  const u = mk('a@ucsd.edu');
  const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, 'p']));
  const bad: unknown[] = [
    {}, { terms: [] }, { terms: { '': 'p' } }, { terms: { k: '' } }, { terms: { k: 1 } },
    { terms: { ['k'.repeat(101)]: 'p' } }, { terms: { k: 'p'.repeat(101) } }, { terms: many },
  ];
  for (const b of bad) expect((await send('PUT', '/api/calendar', b, u.token)).status, JSON.stringify(b).slice(0, 50)).toBe(400);
  for (const k of ['__proto__', 'constructor', 'prototype']) {
    // JSON.parse makes __proto__ an own key, as it would be on the wire.
    const r = await send('PUT', '/api/calendar', JSON.parse(`{"terms":{"${k}":"p"}}`), u.token);
    expect(r.status, k).toBe(400);
  }
  expect((await send('PUT', '/api/calendar', { terms: { k: 'p'.repeat(100), [`${'k'.repeat(100)}`]: 'p' } }, u.token)).status).toBe(200);
  expect(Object.keys(((await (await get('/api/calendar', u.token)).json()) as { terms: object }).terms)).toHaveLength(2);
});

test('the feed is limited to 600 requests per 15 minutes per IP', async () => {
  const { deps } = setup();
  const app = createApp(deps);
  const h = { 'x-real-ip': '203.0.113.7' };
  const file = `/api/cal/${'A'.repeat(43)}.ics`;
  for (let i = 0; i < 600; i++) expect((await app.request(file, { headers: h })).status).toBe(404);
  const res = await app.request(file, { headers: h });
  expect(res.status).toBe(429);
  expect(((await res.json()) as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  expect((await app.request(file, { headers: { 'x-real-ip': '203.0.113.8' } })).status).toBe(404);
});
