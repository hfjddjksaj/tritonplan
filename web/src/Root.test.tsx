import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root as ReactRoot } from 'react-dom/client';
import type { ApptTimes, PlanState, SyncOp, SyncVersions, Term } from '@triton/shared';
import Root from './Root';
import { usePlan } from './hooks/usePlan';
import { useApptTimes } from './hooks/useApptTimes';
import { nav } from './lib/nav';
import { PENDING_HASH_KEY, type CloudBoot } from './lib/cloud/boot';
import type { TermMeta, WebSnapshot } from './lib/cloud/records';
import { BRIDGE_SOURCE, installBridgeHub, resetBridgeHubForTests } from './lib/bridge';
import { makeCourse, makePlan } from './lib/fixtures';
import type { NamedPlan } from './lib/plans';
import { planToHash, planToMirrorHash } from './lib/share';
import { loadReceived, saveReceived } from './lib/storage';
import { OLD_SITE_ORIGIN } from './lib/site';
import { loadPendingMigration, savePendingMigration, type MigrationPayload } from './lib/migration';
import type { TermsState } from './lib/terms-state';
import { makeTestBoot, snapshotOf, TEST_ME } from './test/boot';

// Every boot Root makes, so tests can see how many engines exist and which were disposed.
const { boots } = vi.hoisted(() => ({ boots: [] as CloudBoot[] }));
vi.mock('./lib/cloud/boot', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./lib/cloud/boot')>();
  return {
    ...mod,
    makeBoot: (...args: Parameters<typeof mod.makeBoot>) => {
      const boot = mod.makeBoot(...args);
      boots.push(boot);
      return boot;
    },
  };
});

/** A stopped engine takes edits but never has anything to send. */
function disposed(boot: CloudBoot): boolean {
  boot.engine.setPool([...boot.pool, makeCourse('PROBE|2026|2')]);
  return !boot.engine.hasPending();
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FA: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const LINK_EXPIRED = 'That link has expired or was already used. Sign in, or request a new one.';

function mine(name = 'Mine', plan: PlanState = makePlan()): TermsState {
  const p: NamedPlan = { id: 'plan-1', name, plan, createdAt: 'c', updatedAt: 'u', browsed: [] };
  return { version: 1, activeTermKey: '2026|2', terms: { '2026|2': { term: FA, plans: { activeId: 'plan-1', plans: [p] } } } };
}

function otherPlan(): PlanState {
  const course = makeCourse('MATH-18|2026|2', 'MATH-18');
  return { ...makePlan(), entries: [{ course, selectedOptionId: course.options[0]!.id, color: '120' }] };
}

/** An old #m= mirror still in the address bar (nothing writes one any more): a tab from before the upgrade. */
function leaveStaleMirror(plan: PlanState = makePlan()) {
  window.history.replaceState(null, '', `/#${planToMirrorHash(plan)}`);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** An in-memory TritonPlan server behind a mocked fetch: sessions, GET /api/state, POST /api/sync, and canned auth answers. */
function startServer() {
  const srv = {
    me: 'out' as 'in' | 'out' | 'down',
    state: snapshotOf() as WebSnapshot,
    auth: {} as Record<string, (body: unknown) => Response>,
    calls: [] as { method: string; url: string; body: unknown }[],
    counter: 500,
    /** While set, GET /api/state answers with what the server held when the request arrived, once this settles. */
    holdState: null as Promise<void> | null,
    /** GET /api/me and /api/state never answer; only the request's own timeout ends them. */
    hang: false,
    /** POST /api/sync fails as a network error, so edits stay unsaved. */
    syncDown: false,
  };
  const sync = (ops: SyncOp[]): Response => {
    const versions: SyncVersions = { terms: {}, plans: {} };
    const s = srv.state;
    for (const op of ops) {
      switch (op.op) {
        case 'putTerm': s.terms[op.termKey] = { version: versions.terms[op.termKey] = ++srv.counter, data: op.data as TermMeta }; break;
        case 'putPlan': s.plans[op.planId] = { version: versions.plans[op.planId] = ++srv.counter, termKey: op.termKey, data: op.data as NamedPlan }; break;
        case 'deleteTerm': delete s.terms[op.termKey]; break;
        case 'deletePlan': delete s.plans[op.planId]; break;
        case 'putCourses': s.pool = [...s.pool.filter((c) => !op.courses.some((n) => n.id === c.id)), ...op.courses]; break;
        case 'deleteCourses': s.pool = s.pool.filter((c) => !op.ids.includes(c.id)); break;
        case 'putAppt': s.appt = op.data; break;
      }
    }
    return json(200, { ok: true, versions });
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    srv.calls.push({ method, url, body });
    const route = `${method} ${url}`;
    if (route === 'GET /api/me' || route === 'GET /api/state') {
      if (srv.hang) {
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          signal?.addEventListener('abort', () => reject(signal.reason));
        });
      }
      if (srv.me === 'down') throw new TypeError('Failed to fetch');
      if (srv.me === 'out') return json(401, { error: 'unauthorized' });
      if (route === 'GET /api/me') return json(200, TEST_ME);
      const answer = json(200, srv.state);
      if (srv.holdState) await srv.holdState;
      return answer;
    }
    if (route === 'POST /api/sync') {
      if (srv.syncDown) throw new TypeError('Failed to fetch');
      return sync((body as { ops: SyncOp[] }).ops);
    }
    const answer = srv.auth[route];
    return answer ? answer(body) : json(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return srv;
}

let container: HTMLDivElement;
let root: ReactRoot | null = null;
let srv: ReturnType<typeof startServer>;
let navSpy: ReturnType<typeof vi.spyOn>;

/** Let fetches, JSON bodies and the renders they trigger finish (timers stay fake). */
async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setImmediate(r));
    });
  }
}

async function mount(path: string) {
  window.history.replaceState(null, '', path);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Root />));
  await settle();
}

function unmount() {
  act(() => root?.unmount());
  root = null;
  container.remove();
}

/** What a full page load does: the old document's hub and listeners are gone. */
function reload() {
  unmount();
  resetBridgeHubForTests();
}

const text = () => container.textContent ?? '';
const input = (type: 'email' | 'password') => container.querySelector<HTMLInputElement>(`input[type="${type}"]`);
function type(el: HTMLInputElement | null, value: string) {
  if (!el) throw new Error('no such input');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string) {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!el) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => el.click());
  await settle();
}
const callsTo = (method: string, url: string) => srv.calls.filter((c) => c.method === method && c.url === url);

async function becomeVisible() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle();
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

/** Run the engine's debounce so the planner's first save reaches the fake server. */
const letSyncRun = () => advance(1000);

/** Past the 30 s a refocus refresh waits after the last boot or refresh. */
const waitOutThrottle = () => advance(31_000);

const courseCodes = () => [...container.querySelectorAll('.course-card__code')].map((e) => e.textContent);

/** Another device adds MATH-18 to plan-1 (the server bumps its version). */
function addCourseElsewhere() {
  const doc = srv.state.plans['plan-1']!;
  const named = doc.data as NamedPlan;
  const course = makeCourse('MATH-18|2026|2', 'MATH-18');
  const entry = { course, selectedOptionId: course.options[0]!.id, color: '120' };
  srv.state.plans['plan-1'] = {
    ...doc,
    version: doc.version + 100,
    data: { ...named, plan: { ...named.plan, entries: [...named.plan.entries, entry] } },
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetBridgeHubForTests();
  boots.length = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  // Every request timeout on the fake clock (the GETs' own timer already is; this covers postSync's).
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
    return c.signal;
  });
  srv = startServer();
  navSpy = vi.spyOn(nav, 'assign').mockImplementation(() => {});
});

afterEach(() => {
  if (root) unmount();
  resetBridgeHubForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as unknown as { visibilityState?: string }).visibilityState;
  window.history.replaceState(null, '', '/');
});

describe('Root: signed out', () => {
  it('signed out shows the email form and a Google link carrying returnTo', async () => {
    await mount('/');
    expect(input('email')).not.toBeNull();
    expect(input('password')).not.toBeNull();
    expect(text()).toContain('TritonPlan now saves your plans to your account, so they follow you to any device.');
    const google = [...container.querySelectorAll('a')].find((a) => a.textContent?.includes('Continue with Google'));
    expect(google?.getAttribute('href')).toBe('/api/auth/google?returnTo=%2F');
    expect(container.querySelector('.app')).toBeNull();
    expect(callsTo('GET', '/api/state')).toHaveLength(0);
  });

  it.each([
    ['link-expired', LINK_EXPIRED],
    ['google-failed', "Google sign-in didn't finish. Please try again."],
    ['google-unverified', "Your Google account's email isn't verified, so it can't be used to sign in."],
    ['google-unsupported', "Google can't confirm this email address for us. Sign in with your email and password instead."],
  ])('?auth=%s shows the notice and is removed from the URL', async (code, notice) => {
    await mount(`/?auth=${code}&keep=1`);
    expect(text()).toContain(notice);
    expect(window.location.search).toBe('?keep=1');
  });

  it("can't reach the server → says so, and Try again signs in once it is back", async () => {
    srv.me = 'down';
    await mount('/');
    expect(text()).toContain("Can't reach TritonPlan right now.");
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await click('Try again');
    expect(container.querySelector('.app')).not.toBeNull();
  });

  it('a server that never answers is given up on after 15 s, with Try again', async () => {
    srv.hang = true;
    await mount('/');
    expect(text()).not.toContain("Can't reach TritonPlan right now.");
    await advance(15_000);
    expect(text()).toContain("Can't reach TritonPlan right now.");
    srv.hang = false;
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await click('Try again');
    expect(container.querySelector('.app')).not.toBeNull();
  });

  it('a hostile path never becomes the sign-in returnTo', async () => {
    await mount(`${window.location.origin}//evil.com/x`); // https://tritonplan.cn//evil.com/x
    expect(window.location.pathname).toBe('//evil.com/x');
    const google = [...container.querySelectorAll('a')].find((a) => a.textContent?.includes('Continue with Google'));
    expect(google?.getAttribute('href')).toBe('/api/auth/google?returnTo=%2F');
  });
});

describe('Root: signed in', () => {
  it('under StrictMode the account loads once and one engine is made', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    window.history.replaceState(null, '', '/');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
        <StrictMode>
          <Root />
        </StrictMode>,
      ),
    );
    await settle();
    expect(container.querySelector('.app')).not.toBeNull();
    expect(callsTo('GET', '/api/me')).toHaveLength(1);
    expect(boots).toHaveLength(1);
    await letSyncRun();
    expect(callsTo('POST', '/api/sync').length).toBeGreaterThan(0); // StrictMode's effect replay did not stop it
  });

  it('signed in loads /api/state and renders the planner', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine('Fall schedule'));
    await mount('/');
    expect(container.querySelector('.topbar .brand')?.textContent).toContain('TritonPlan');
    expect(container.querySelector('.planswitch__name')?.textContent).toBe('Fall schedule');
    expect(callsTo('GET', '/api/state')).toHaveLength(1);
  });

  it('a #p= link opened while signed in opens as a received plan', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount(`/#${planToHash(otherPlan())}`);
    expect(loadReceived()?.plan.entries.map((e) => e.course.id)).toEqual(['MATH-18|2026|2']);
    expect(container.querySelector('.received')).not.toBeNull();
  });

  it('a #p= link opened while signed out is restored after signing in', async () => {
    const shared = otherPlan();
    const hash = `#${planToHash(shared)}`;
    srv.auth['POST /api/auth/login'] = () => json(200, { ok: true });
    await mount(`/${hash}`);
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBe(hash);

    type(input('email'), 'student@ucsd.edu');
    type(input('password'), 'correct horse');
    await click('Sign in');
    expect(callsTo('POST', '/api/auth/login')[0]?.body).toEqual({ email: 'student@ucsd.edu', password: 'correct horse' });
    expect(navSpy).toHaveBeenCalledWith('/');

    // The navigation to returnTo: a fresh load of "/" with no hash, now signed in.
    reload();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBeNull();
    expect(loadReceived()?.plan.entries.map((e) => e.course.id)).toEqual(['MATH-18|2026|2']);
    expect(container.querySelector('.received')).not.toBeNull();
    expect(container.querySelector('.planswitch__name')?.textContent).toBe('Mine'); // own plan untouched
  });

  it('a "+ TritonPlan" click queued before sign-in lands in the plan after it', async () => {
    installBridgeHub();
    await mount('/');
    const course = makeCourse('CSE-100|2026|2', 'CSE-100');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: BRIDGE_SOURCE, type: 'plan-add', version: 1, payload: { course, selectedOptionId: course.options[0]!.id } },
        source: window,
        origin: window.location.origin,
      }),
    );
    // Signed in from another tab (the verify link); coming back to this one enters the planner.
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await becomeVisible();
    expect(container.querySelector('.app')).not.toBeNull();
    await letSyncRun();
    const saved = Object.values(srv.state.plans).map((p) => p.data as NamedPlan);
    expect(saved.flatMap((p) => p.plan.entries.map((e) => e.course.id))).toContain('CSE-100|2026|2');
  });
});

describe('Root: coming back to the tab', () => {
  it('a 401 on refresh shows the sign-in screen; signing back in does not misread the old mirror', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    await letSyncRun();
    leaveStaleMirror();
    await waitOutThrottle();
    srv.me = 'out';
    await becomeVisible();
    expect(container.querySelector('.app')).toBeNull();
    expect(input('email')).not.toBeNull();
    const google = [...container.querySelectorAll('a')].find((a) => a.textContent?.includes('Continue with Google'));
    expect(google?.getAttribute('href')).toBe('/api/auth/google?returnTo=%2F');
    expect(boots).toHaveLength(1);
    expect(disposed(boots[0]!)).toBe(true);
    expect(window.location.hash).toBe('');

    // Meanwhile another device added a course; the student signs in again in another tab.
    addCourseElsewhere();
    srv.me = 'in';
    await becomeVisible();
    expect(container.querySelector('.app')).not.toBeNull();
    expect(loadReceived()).toBeNull();
    expect(container.querySelector('.received')).toBeNull();
    expect(courseCodes()).toContain('MATH-18');
  });

  it('a network error or a 500 on refresh keeps the planner as it is', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    await letSyncRun();
    const app = container.querySelector('.app');
    await waitOutThrottle();
    srv.me = 'down';
    await becomeVisible();
    expect(container.querySelector('.app')).toBe(app);
    expect(boots).toHaveLength(1);
  });

  it('a refresh that never answers times out and frees the next one', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    await letSyncRun();
    const app = container.querySelector('.app');
    await waitOutThrottle();
    srv.hang = true;
    await becomeVisible();
    const gets = callsTo('GET', '/api/state').length;
    await advance(15_000);
    expect(container.querySelector('.app')).toBe(app);
    srv.hang = false;
    await becomeVisible();
    expect(callsTo('GET', '/api/state')).toHaveLength(gets + 1);
  });

  it('refreshes at most once per 30 s', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    await letSyncRun();
    const gets = callsTo('GET', '/api/state').length;
    await becomeVisible(); // seconds after the boot
    expect(callsTo('GET', '/api/state')).toHaveLength(gets);
    await waitOutThrottle();
    await becomeVisible();
    expect(callsTo('GET', '/api/state')).toHaveLength(gets + 1);
    await becomeVisible(); // right after that refresh
    expect(callsTo('GET', '/api/state')).toHaveLength(gets + 1);
  });

  it('nothing changed elsewhere → the planner stays mounted', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    await letSyncRun();
    const app = container.querySelector('.app');
    await waitOutThrottle();
    const gets = callsTo('GET', '/api/state').length;
    await becomeVisible();
    expect(callsTo('GET', '/api/state')).toHaveLength(gets + 1);
    expect(container.querySelector('.app')).toBe(app);
    expect(boots).toHaveLength(1);
  });

  it('another device changed a plan → the planner remounts on the latest state', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine('Mine'));
    await mount('/');
    await letSyncRun();
    const app = container.querySelector('.app');
    const doc = srv.state.plans['plan-1']!;
    srv.state.plans['plan-1'] = { ...doc, version: doc.version + 100, data: { ...(doc.data as NamedPlan), name: 'Renamed on phone' } };
    await waitOutThrottle();
    await becomeVisible();
    expect(container.querySelector('.app')).not.toBe(app);
    expect(container.querySelector('.planswitch__name')?.textContent).toBe('Renamed on phone');
    // One live engine: the new App's. The old one can no longer save over the newer state.
    expect(boots).toHaveLength(2);
    expect(disposed(boots[0]!)).toBe(true);
    await letSyncRun();
    expect(srv.state.plans['plan-1']!.data).toMatchObject({ name: 'Renamed on phone' });
  });

  it('a save that lands while the refresh is out does not remount on the older answer', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    await letSyncRun();
    const app = container.querySelector('.app');
    await waitOutThrottle();
    let release!: () => void;
    srv.holdState = new Promise<void>((r) => {
      release = r;
    });
    await becomeVisible(); // the GET is out, holding the state from before the push below
    const course = makeCourse('CSE-100|2026|2', 'CSE-100');
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: BRIDGE_SOURCE, type: 'courses', version: 1, payload: [course] },
          source: window,
          origin: window.location.origin,
        }),
      );
    });
    await letSyncRun();
    expect(srv.state.pool.map((c) => c.id)).toContain('CSE-100|2026|2');
    srv.holdState = null;
    release();
    await settle();
    expect(container.querySelector('.app')).toBe(app);
  });

  it('unsaved edits skip the refresh', async () => {
    srv.me = 'in'; // an empty account: the planner's first "My plan" is waiting to be saved
    srv.syncDown = true; // ...and cannot be, so it stays unsaved
    await mount('/');
    await waitOutThrottle();
    const gets = callsTo('GET', '/api/state').length;
    await becomeVisible();
    expect(callsTo('GET', '/api/state')).toHaveLength(gets);
  });

  it('another device added a course → it shows, and our old #m= mirror is not taken for a received plan', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    await letSyncRun();
    leaveStaleMirror();
    addCourseElsewhere();
    await waitOutThrottle();
    await becomeVisible();
    expect(boots).toHaveLength(2);
    expect(courseCodes()).toContain('MATH-18');
    expect(container.querySelector('.received')).toBeNull();
    expect(loadReceived()).toBeNull();
  });

  it('a plan someone sent stays in the received slot across that remount', async () => {
    const sent = { plan: otherPlan(), source: 'link' as const, receivedAt: '2026-10-01T00:00:00.000Z' };
    saveReceived(sent);
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    await letSyncRun();
    addCourseElsewhere();
    await waitOutThrottle();
    await becomeVisible();
    expect(boots).toHaveLength(2);
    expect(loadReceived()).toEqual(sent);
  });

  it('another device switching its active plan is not switched back by this tab', async () => {
    const terms = mine();
    terms.terms['2026|2']!.plans.plans.push({
      id: 'plan-2', name: 'Second', plan: otherPlan(), createdAt: 'c', updatedAt: 'u', browsed: [],
    });
    srv.me = 'in';
    srv.state = snapshotOf(terms);
    await mount('/');
    await letSyncRun();
    leaveStaleMirror(); // plan-1, the one this tab had active
    const t = srv.state.terms['2026|2']!;
    srv.state.terms['2026|2'] = { ...t, version: t.version + 100, data: { ...t.data, activeId: 'plan-2' } };
    const syncs = callsTo('POST', '/api/sync').length;
    await waitOutThrottle();
    await becomeVisible();
    await letSyncRun();
    expect(boots).toHaveLength(2);
    expect(container.querySelector('.planswitch__name')?.textContent).toBe('Second');
    expect(callsTo('POST', '/api/sync')).toHaveLength(syncs);
    expect(srv.state.terms['2026|2']!.data.activeId).toBe('plan-2');
  });
});

describe('Root: email links', () => {
  it('/reset#token=abc posts the token and new password to /api/auth/reset', async () => {
    srv.auth['POST /api/auth/reset'] = () => json(200, { ok: true });
    await mount('/reset#token=abc');
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/reset');
    expect(text()).toContain('Choose a new password');
    expect(input('password')?.getAttribute('minlength')).toBe('8');
    type(input('password'), 'new password 1');
    await click('Save password');
    expect(callsTo('POST', '/api/auth/reset')[0]?.body).toEqual({ token: 'abc', password: 'new password 1' });
    expect(navSpy).toHaveBeenCalledWith('/');
    expect(callsTo('GET', '/api/me')).toHaveLength(0);
  });

  it.each([
    [{ error: 'link_expired' }, LINK_EXPIRED],
    [{ error: 'weak_password' }, 'Use at least 8 characters.'],
  ])('a reset answered 400 %j says so', async (answer, copy) => {
    srv.auth['POST /api/auth/reset'] = () => json(400, answer);
    await mount('/reset#token=abc');
    type(input('password'), 'short');
    await click('Save password');
    expect(text()).toContain(copy);
    expect(navSpy).not.toHaveBeenCalled();
  });

  it('/verify#token=… confirms with the password and signs in', async () => {
    srv.auth['POST /api/auth/verify'] = () => json(200, { ok: true });
    await mount('/verify#token=tok');
    expect(window.location.hash).toBe('');
    expect(text()).toContain('Confirm your email');
    expect(text()).toContain('Enter the password you chose when you signed up.');
    expect(input('password')?.getAttribute('minlength')).toBeNull(); // an existing password: no new rule
    type(input('password'), 'correct horse');
    await click('Confirm and sign in');
    expect(callsTo('POST', '/api/auth/verify')[0]?.body).toEqual({ token: 'tok', password: 'correct horse' });
    expect(navSpy).toHaveBeenCalledWith('/');
    expect(callsTo('GET', '/api/me')).toHaveLength(0);
  });

  it.each([
    [401, { error: 'invalid_credentials' }, "That password doesn't match this sign-up. If you didn't sign up for TritonPlan, you can ignore the email."],
    [400, { error: 'link_expired' }, LINK_EXPIRED],
    [429, { error: 'rate_limited', retryAfter: 600 }, 'Too many attempts. Try again in 10 minutes.'],
  ])('a verify answered %i says so', async (status, answer, copy) => {
    srv.auth['POST /api/auth/verify'] = () => json(status, answer);
    await mount('/verify#token=tok');
    type(input('password'), 'wrong password');
    await click('Confirm and sign in');
    expect(text()).toContain(copy);
    expect(navSpy).not.toHaveBeenCalled();
  });
});

describe('usePlan on a cloud boot', () => {
  it('usePlan writes edits through the engine, not localStorage', async () => {
    const boot = makeTestBoot({ terms: mine() });
    let api!: ReturnType<typeof usePlan>;
    function Probe() {
      api = usePlan(boot);
      return null;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(<Probe />));
    act(() => api.addCourse(makeCourse('CSE-100|2026|2', 'CSE-100')));
    await act(() => boot.engine.flush());
    const puts = boot.sent.flat().filter((o): o is Extract<SyncOp, { op: 'putPlan' }> => o.op === 'putPlan');
    expect(puts.some((o) => (o.data as NamedPlan).plan.entries.some((e) => e.course.id === 'CSE-100|2026|2'))).toBe(true);
    expect(localStorage.getItem('triton-planner:terms:v1')).toBeNull();
    expect(localStorage.getItem('triton-planner:pool:v1')).toBeNull();
    boot.engine.dispose();
  });

  it('appointment times pushed by the extension save through the engine', async () => {
    const boot = makeTestBoot({ terms: mine() });
    let appt: ApptTimes[] = [];
    function Probe() {
      appt = useApptTimes(boot);
      return null;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(<Probe />));
    const incoming = [{
      academicYear: '2026', academicSession: '2', yearText: '2026/2027', sessionText: 'Fall Quarter',
      capturedAt: '2026-10-01T00:00:00Z', windows: [],
    }];
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { source: BRIDGE_SOURCE, type: 'appt-times', version: 1, payload: incoming },
        source: window,
        origin: window.location.origin,
      }));
    });
    expect(appt).toEqual(incoming);
    await act(() => boot.engine.flush());
    expect(boot.sent.flat()).toContainEqual({ op: 'putAppt', data: incoming });
    expect(localStorage.getItem('triton-planner:appt:v1')).toBeNull();
    boot.engine.dispose();
  });
});

describe('Root: moving plans from the old site', () => {
  const pending = (): MigrationPayload => ({
    kind: 'tritonplan-migration', version: 1, exportedAt: '2026-10-01T00:00:00.000Z',
    terms: mine('Old plan', otherPlan()), plans: null, plan: null, pool: [], appt: null, received: null, hashPlan: null,
  });

  it('a signed-out visit to /migrate with a pending payload asks to sign in with returnTo=/migrate', async () => {
    savePendingMigration(pending());
    await mount('/migrate');
    expect(text()).toContain('Sign in to finish moving your plans');
    const google = [...container.querySelectorAll('a')].find((a) => a.textContent?.includes('Continue with Google'));
    expect(google?.getAttribute('href')).toBe('/api/auth/google?returnTo=%2Fmigrate');
    expect(container.querySelector('.app')).toBeNull();
    expect(loadPendingMigration()).not.toBeNull();
  });

  it('/migrate without a pending payload waits for the old site, even signed out', async () => {
    await mount('/migrate');
    expect(text()).toContain('Moving your plans from the old TritonPlan…');
    expect(input('email')).toBeNull();
  });

  it('signed in with a pending payload: confirm first, then the planner with a flash and a clean URL', async () => {
    srv.me = 'in';
    srv.state = snapshotOf();
    savePendingMigration(pending());
    await mount('/migrate');
    expect(text()).toContain('We found 1 plan in 1 term from the old TritonPlan.');
    expect(container.querySelector('.app')).toBeNull();
    await click('Add to my account');
    expect(container.querySelector('.app')).not.toBeNull();
    expect(text()).toContain('Moved 1 plan to your account.');
    expect(loadPendingMigration()).toBeNull();
    expect(window.location.pathname).toBe('/');
    expect(Object.keys(srv.state.plans)).toEqual(['plan-1']);
  });

  it('Not now enters the planner and keeps the payload for the next load', async () => {
    srv.me = 'in';
    srv.state = snapshotOf();
    savePendingMigration(pending());
    await mount('/');
    await click('Not now');
    expect(container.querySelector('.app')).not.toBeNull();
    expect(loadPendingMigration()).not.toBeNull();
  });

  it('after a successful import no confirm button is clickable while the fresh state loads', async () => {
    srv.me = 'in';
    srv.state = snapshotOf();
    savePendingMigration(pending());
    await mount('/migrate');
    const realFetch = globalThis.fetch;
    let gets = 0;
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      // Counted from here: #1 is the import's own refresh, #2 is the planner's boot (held).
      if (String(input) === '/api/state' && ++gets === 2) await held;
      return realFetch(input, init);
    }));
    await click('Add to my account');
    expect(gets).toBe(2);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    await act(async () => release());
    await settle();
    expect(container.querySelector('.app')).not.toBeNull();
  });

  it('Not now after a half-applied import boots from the server state, first batch included', async () => {
    srv.me = 'in';
    srv.state = snapshotOf();
    savePendingMigration(pending());
    await mount('/migrate');
    const realFetch = globalThis.fetch;
    let failed = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = await realFetch(input, init);
      // The server commits, but the answer is lost: the student sees a failure.
      if (String(input) === '/api/sync' && !failed) { failed = true; return json(500, { error: 'boom' }); }
      return r;
    }));
    await click('Add to my account');
    expect(text()).toContain("Couldn't add your plans. Please try again.");
    await click('Not now');
    expect(container.querySelector('.app')).not.toBeNull();
    expect(text()).toContain('Old plan');
    expect(loadPendingMigration()).not.toBeNull();
  });

  it('a sign-in notice survives while a migration is pending', async () => {
    savePendingMigration(pending());
    await mount('/?auth=google-failed');
    expect(text()).toContain('Sign in to finish moving your plans');
    expect(text()).toContain("Google sign-in didn't finish. Please try again.");
  });

  it('?handoff=1 with an opener replaces a stale pending payload and is stripped from the URL', async () => {
    savePendingMigration(pending());
    const frame = document.body.appendChild(document.createElement('iframe'));
    const opener = frame.contentWindow!;
    (opener as unknown as { postMessage: unknown }).postMessage = vi.fn();
    Object.defineProperty(window, 'opener', { configurable: true, value: opener });
    try {
      await mount('/migrate?handoff=1');
      expect(text()).toContain('Moving your plans from the old TritonPlan…');
      expect(window.location.search).toBe('');
      const fresh: MigrationPayload = { ...pending(), exportedAt: '2026-11-01T00:00:00.000Z' };
      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'tp-migrate-payload', payload: fresh }, origin: OLD_SITE_ORIGIN, source: opener }));
      });
      await settle();
      expect(loadPendingMigration()?.exportedAt).toBe('2026-11-01T00:00:00.000Z');
      expect(text()).toContain('Sign in to finish moving your plans');
    } finally {
      Object.defineProperty(window, 'opener', { configurable: true, value: null });
      frame.remove();
    }
  });
});
