import { expect, test } from 'vitest';
import type { CourseOffering, PlanState, StoredPlanDoc, SyncOp, SyncVersions } from '@triton/shared';
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

/** A plan doc as the web app's NamedPlan stores it: the PlanState sits under `plan`. */
function namedPlan(id: string, plan: PlanState): StoredPlanDoc & { browsed: string[] } {
  const doc: StoredPlanDoc = { id, name: 'My plan', plan, createdAt: T, updatedAt: T };
  return { ...doc, browsed: [] };
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

  // Plans reach the server only through /api/sync, as the web app sends them; versions are whatever the server last handed out.
  const versions = new Map<string, number>();
  const base = (token: string, kind: 'term' | 'plan', id: string) => versions.get(`${token} ${kind} ${id}`) ?? 0;
  const sync = async (token: string, ops: SyncOp[]) => {
    const res = await send('POST', '/api/sync', { ops }, token);
    expect(res.status).toBe(200);
    const v = ((await res.json()) as { versions: SyncVersions }).versions;
    for (const [k, n] of Object.entries(v.terms)) versions.set(`${token} term ${k}`, n);
    for (const [k, n] of Object.entries(v.plans)) versions.set(`${token} plan ${k}`, n);
  };
  /** One plan saved the way the web app saves it: a TermMeta for its term, then the NamedPlan itself. */
  const savePlan = (token: string, planId: string, termKey: string, p: PlanState) =>
    sync(token, [
      { op: 'putTerm', termKey, baseVersion: base(token, 'term', termKey), data: { term: p.term, activeId: planId, planOrder: [planId] } },
      { op: 'putPlan', planId, termKey, baseVersion: base(token, 'plan', planId), data: namedPlan(planId, p) },
    ]);
  const deletePlan = (token: string, planId: string) =>
    sync(token, [{ op: 'deletePlan', planId, baseVersion: base(token, 'plan', planId) }]);

  const link = async (token: string) => (await (await send('POST', '/api/calendar/link', {}, token)).json()) as { https: string; webcal: string };
  const path = (https: string) => new URL(https).pathname;
  const missing = async (token: string) => ((await (await get('/api/calendar', token)).json()) as { missing: string[] }).missing;
  return { deps, mk, send, get, savePlan, deletePlan, link, path, missing };
}
const events = (ics: string) => ics.split('BEGIN:VEVENT\r\n').slice(1).map((e) => e.split('END:VEVENT')[0]!);

test('the feed works without signing in and contains no email or user id', async () => {
  const { mk, send, get, savePlan, link, path, missing } = setup();
  const u = mk('owner@ucsd.edu');
  await savePlan(u.token, 'plan-abc', 'FA26', planFor('CSE', 'CSE 100|2026|2'));
  expect((await send('PUT', '/api/calendar', { terms: { FA26: 'plan-abc' } }, u.token)).status).toBe(200);
  expect(await missing(u.token)).toEqual([]);
  const { https, webcal } = await link(u.token);
  expect(https).toMatch(/^https:\/\/tritonplan\.cn\/api\/cal\/[A-Za-z0-9_-]{43}\.ics$/);
  expect(webcal).toBe(https.replace('https://', 'webcal://'));

  const res = await get(path(https)); // no cookie, no Origin
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
  expect(res.headers.get('cache-control')).toBe('no-cache');
  const body = await res.text();
  const evs = events(body);
  expect(evs).toHaveLength(1);
  expect(evs[0]).toContain('SUMMARY:CSE 100 Lecture');
  expect(evs[0]).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU;');
  expect(body).not.toContain('owner@ucsd.edu');
  expect(body).not.toContain(u.id);
  expect(body).not.toContain('plan-abc');
  expect(body).not.toContain('My plan');
});

test('only the selected plan per term is in the feed', async () => {
  const { mk, send, get, savePlan, link, path } = setup();
  const u = mk('a@ucsd.edu');
  await savePlan(u.token, 'p1', 'FA26', planFor('CSE', 'CSE 100|2026|2'));
  await savePlan(u.token, 'p2', 'FA26', planFor('MATH', 'MATH 100|2026|2'));
  await send('PUT', '/api/calendar', { terms: { FA26: 'p2' } }, u.token);
  const { https } = await link(u.token);
  const body = await (await get(path(https))).text();
  expect(events(body)).toHaveLength(1);
  expect(body).toContain('SUMMARY:MATH 100 Lecture');
  expect(body).not.toContain('CSE 100');
  const state = await (await get('/api/calendar', u.token)).json();
  expect(state).toEqual({ https, webcal: https.replace('https://', 'webcal://'), terms: { FA26: 'p2' }, missing: [] });
});

test('a Fall 2026 meeting captured from the live TSS feed, which has no section dates, still recurs in the feed', async () => {
  const { mk, send, get, savePlan, link, path } = setup();
  const u = mk('a@ucsd.edu');
  const p = planFor('CSE', 'CSE 100|2026|2');
  const comp = p.entries[0]!.course.options[0]!.components[0]!;
  delete comp.beginDate;
  delete comp.endDate;
  await savePlan(u.token, 'p1', 'FA26', p);
  await send('PUT', '/api/calendar', { terms: { FA26: 'p1' } }, u.token);
  const { https } = await link(u.token);
  const [e] = events(await (await get(path(https))).text());
  expect(e).toContain('SUMMARY:CSE 100 Lecture');
  expect(e).toContain('DTSTART;TZID=America/Los_Angeles:20260929T090000'); // the first Tuesday of instruction
  expect(e).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261205T075959Z');
});

test('a query on the feed URL is ignored: the web app adds one so Google fetches afresh', async () => {
  const { mk, send, get, savePlan, link, path } = setup();
  const u = mk('a@ucsd.edu');
  await savePlan(u.token, 'p1', 'FA26', planFor('CSE', 'CSE 100|2026|2'));
  await send('PUT', '/api/calendar', { terms: { FA26: 'p1' } }, u.token);
  const { https } = await link(u.token);
  const res = await get(`${path(https)}?v=abc123`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('SUMMARY:CSE 100 Lecture');
});

test('a selected plan that was deleted or moved to another term is reported missing and left out', async () => {
  const { mk, send, get, savePlan, deletePlan, link, path, missing } = setup();
  const u = mk('a@ucsd.edu');
  await savePlan(u.token, 'p1', 'FA26', planFor('CSE', 'CSE 100|2026|2'));
  await savePlan(u.token, 'p2', 'WI27', planFor('MATH', 'MATH 100|2026|2'));
  await send('PUT', '/api/calendar', { terms: { FA26: 'p1', WI27: 'p2', SP27: 'ghost' } }, u.token);
  const { https } = await link(u.token);

  expect(await missing(u.token)).toEqual(['SP27']);
  // A plan id that exists but under another term does not count either (P4).
  await send('PUT', '/api/calendar', { terms: { FA26: 'p2' } }, u.token);
  expect(await missing(u.token)).toEqual(['FA26']);

  await send('PUT', '/api/calendar', { terms: { FA26: 'p1', WI27: 'p2' } }, u.token);
  expect(await missing(u.token)).toEqual([]);
  let body = await (await get(path(https))).text();
  expect(body).toContain('SUMMARY:CSE 100 Lecture');
  expect(body).toContain('SUMMARY:MATH 100 Lecture');

  await deletePlan(u.token, 'p1');
  const state = (await (await get('/api/calendar', u.token)).json()) as { missing: string[]; terms: object };
  expect(state.missing).toEqual(['FA26']);
  expect(state.terms).toEqual({ FA26: 'p1', WI27: 'p2' });
  body = await (await get(path(https))).text();
  expect(body).not.toContain('CSE 100');
  expect(body).toContain('SUMMARY:MATH 100 Lecture');

  // The picked plan is saved again under another term: the old term's pick no longer counts.
  await savePlan(u.token, 'p2', 'SP27', planFor('MATH', 'MATH 100|2026|2'));
  expect(await missing(u.token)).toEqual(['FA26', 'WI27']);
  expect(events(await (await get(path(https))).text())).toEqual([]);
});

test('a stored plan doc without a usable PlanState counts as missing', async () => {
  const { mk, send, savePlan, missing } = setup();
  const u = mk('a@ucsd.edu');
  const res = await send('POST', '/api/sync', { ops: [
    { op: 'putPlan', planId: 'flat', termKey: 'FA26', baseVersion: 0, data: planFor('CSE', 'CSE 100|2026|2') },
    { op: 'putPlan', planId: 'none', termKey: 'WI27', baseVersion: 0, data: { id: 'none', name: 'x', plan: { entries: 'nope' } } },
    { op: 'putPlan', planId: 'str', termKey: 'SP27', baseVersion: 0, data: 'just text' },
  ] }, u.token);
  expect(res.status).toBe(200);
  await savePlan(u.token, 'ok', 'FA27', planFor('MATH', 'MATH 100|2027|2'));
  await send('PUT', '/api/calendar', { terms: { FA26: 'flat', WI27: 'none', SP27: 'str', FA27: 'ok' } }, u.token);
  expect(await missing(u.token)).toEqual(['FA26', 'WI27', 'SP27']);
});

test('a malformed synced plan never breaks the feed or writes raw values into it', async () => {
  const { mk, send, get, savePlan, link, path } = setup();
  const u = mk('a@ucsd.edu');
  // As a crafted share would arrive after "Save as a new plan": /api/sync stores whatever the client sends.
  const bad = planFor('BAD', 'BAD 100|2026|2');
  const opt = bad.entries[0]!.course.options[0]!;
  const comp = opt.components[0]!;
  const meeting = comp.meetings[0]!;
  opt.components = [
    { ...comp, id: 'crlf', meetings: [{ ...meeting, start: '09:00\r\nBEGIN:VEVENT\r\nSUMMARY:INJECTED' }] },
    { ...comp, id: 'crlf-end', meetings: [{ ...meeting, end: '10:00\nX-INJECTED:1' }] },
    { ...comp, id: 'date', beginDate: 'garbage' },
    { ...comp, id: 'feb30', endDate: '2026-02-30' },
    { ...comp, id: 'day', meetings: [{ ...meeting, days: ['Tue', 'Funday'] as never }] },
    { ...comp, id: 'proto', meetings: [{ ...meeting, days: ['toString'] as never }] },
    { ...comp, id: 'nomeet', meetings: undefined as never },
    { ...comp, id: 'noinst', instructors: undefined as never },
  ];
  opt.final = { date: '2026-12-08\r\nX-INJECTED:2', start: '11:30', end: '14:29' };
  opt.midterms = [
    { date: '2026-10-31', start: '25:00', end: '26:00' },
    { date: '2026-11-02', start: '10:00', end: '10:50' },
  ];

  // A plan whose shape throws outright (entries hold null; components is not a list) drops out on its own.
  const broken = planFor('BRK', 'BRK 100|2026|2');
  broken.entries.push(null as never);
  const brokenEnd = planFor('BRE', 'BRE 100|2026|2');
  brokenEnd.entries[0]!.course.options[0]!.components = 'x' as never;

  await savePlan(u.token, 'bad', 'FA26', bad);
  await savePlan(u.token, 'broken', 'WI27', broken);
  await savePlan(u.token, 'broken-end', 'SP27', brokenEnd);
  await savePlan(u.token, 'good', 'FA27', planFor('GOOD', 'GOOD 100|2027|2'));
  await send('PUT', '/api/calendar', { terms: { FA26: 'bad', WI27: 'broken', SP27: 'broken-end', FA27: 'good' } }, u.token);
  const { https } = await link(u.token);

  const res = await get(path(https));
  expect(res.status).toBe(200);
  const body = await res.text();
  const lines = body.split('\r\n');
  expect(body).toContain('SUMMARY:GOOD 100 Lecture');
  expect(body).not.toContain('INJECTED');
  expect(body).not.toContain('undefined');
  expect(body).not.toContain('NaN');
  expect(body).not.toContain('BRK');
  expect(body).not.toContain('BRE');
  expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(lines.filter((l) => l === 'END:VEVENT').length);
  // From the bad plan only what is fully valid is left: the component with no instructors list, and the one sound midterm.
  const uids = events(body).map((e) => /UID:(.*)@/.exec(e)![1]);
  expect(uids.sort()).toEqual(['BAD_100_2026_2-noinst-0', 'GOOD_100_2027_2-E_1-0', 'midterm-BAD_100_2026_2-20261102-1']);
  expect(await (await get('/api/calendar', u.token)).json()).toMatchObject({ missing: [] });
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

test('PUT refuses a body over 16 KB before reading it', async () => {
  const { mk, send, get } = setup();
  const u = mk('a@ucsd.edu');
  // The largest valid body (40 picks of 100-character keys and ids) is about 8 KB.
  const full = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`${i}`.padStart(100, 'k'), 'p'.repeat(100)]));
  expect((await send('PUT', '/api/calendar', { terms: full }, u.token)).status).toBe(200);
  const res = await send('PUT', '/api/calendar', { terms: { k: 'p' }, pad: 'x'.repeat(16 * 1024) }, u.token);
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: 'too_large' });
  expect(Object.keys(((await (await get('/api/calendar', u.token)).json()) as { terms: object }).terms)).toHaveLength(40);
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
