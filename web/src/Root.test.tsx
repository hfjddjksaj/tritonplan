import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root as ReactRoot } from 'react-dom/client';
import type { ApptTimes, PlanState, SyncOp, SyncVersions, Term } from '@triton/shared';
import Root from './Root';
import { usePlan } from './hooks/usePlan';
import { useApptTimes } from './hooks/useApptTimes';
import { nav } from './lib/nav';
import { PENDING_HASH_KEY, PENDING_SAVE_KEY, PENDING_SHARE_KEY, stashPendingShare, type CloudBoot } from './lib/cloud/boot';
import type { TermMeta, WebSnapshot } from './lib/cloud/records';
import { BRIDGE_SOURCE, installBridgeHub, resetBridgeHubForTests } from './lib/bridge';
import { makeCourse, makePlan } from './lib/fixtures';
import type { NamedPlan } from './lib/plans';
import { planToHash, planToMirrorHash } from './lib/share';
import { loadReceived, saveReceived } from './lib/storage';
import { OLD_SITE_ORIGIN } from './lib/site';
import { TSS_HOME_URL } from './lib/tss';
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

function planWith(code: string): PlanState {
  const course = makeCourse(`${code}|2026|2`, code);
  return { ...makePlan(), entries: [{ course, selectedOptionId: course.options[0]!.id, color: '120' }] };
}

const otherPlan = () => planWith('MATH-18');

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
    /** Whose session the cookie carries while `me` is 'in'. */
    who: TEST_ME as typeof TEST_ME,
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
      if (route === 'GET /api/me') return json(200, srv.who);
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
const confirmInput = () => container.querySelector<HTMLInputElement>('input[name="confirm"]');
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
const googleHref = () =>
  [...container.querySelectorAll('a')].find((a) => a.textContent?.includes('Continue with Google'))?.getAttribute('href');
const receivedIds = () => loadReceived()?.plan.entries.map((e) => e.course.id);

/** Every plan the fake server holds: name → course ids. */
function savedPlans(): Record<string, string[]> {
  return Object.fromEntries(
    Object.values(srv.state.plans).map((p) => {
      const named = p.data as NamedPlan;
      return [named.name, named.plan.entries.map((e) => e.course.id)];
    }),
  );
}

/**
 * The shared MATH-18 plan was kept as a new plan called `name`, without a second click: shown, announced,
 * and saved to the account beside "Mine", which is untouched. Nothing sits in the received slot.
 */
async function expectSavedAsNewPlan(name: string) {
  expect(container.querySelector('.app')).not.toBeNull();
  expect(container.querySelector('.received')).toBeNull();
  expect(loadReceived()).toBeNull();
  expect(container.querySelector('.planswitch__name')?.textContent).toBe(name);
  expect(courseCodes()).toEqual(['MATH-18']);
  expect(text()).toContain('Saved the shared plan to your account — you can edit it now');
  expect(localStorage.getItem(PENDING_SHARE_KEY)).toBeNull();
  expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
  await letSyncRun();
  expect(savedPlans()).toEqual({ Mine: ['CSE-8A|2026|2'], [name]: ['MATH-18|2026|2'] });
}

/** One course of `code` in `term`. */
function planIn(term: Term, code: string): PlanState {
  const course = { ...makeCourse(`${code}|${term.year}|${term.period}`, code), term };
  return { version: 1, term, entries: [{ course, selectedOptionId: course.options[0]!.id, color: '120' }] };
}

/** Plans the old site handed over, waiting for the import screen: "Old plan" (MATH-18). */
const migrationPayload = (): MigrationPayload => ({
  kind: 'tritonplan-migration', version: 1, exportedAt: '2026-10-01T00:00:00.000Z',
  terms: mine('Old plan', otherPlan()), plans: null, plan: null, pool: [], appt: null, received: null, hashPlan: null,
});

const CODE = 'AbCdEfGh12';
/** What GET /api/s/<code> answers for a live link: MATH-18, named "Fall draft". */
function serveShare(code = CODE, plan: PlanState = otherPlan(), name = 'Fall draft') {
  srv.auth[`GET /api/s/${code}`] = () => json(200, { name, plan, createdAt: '2026-10-20T00:00:00.000Z' });
}

async function signInWithEmail() {
  srv.auth['POST /api/auth/login'] = () => json(200, { ok: true });
  type(input('email'), 'student@ucsd.edu');
  type(input('password'), 'correct horse');
  await click('Sign in');
}

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
  it('signed out shows the planner page with the sign-in card over it: email form and a Google link carrying returnTo', async () => {
    await mount('/');
    expect(container.querySelector('h1')?.textContent).toBe('Plan your quarter');
    expect(text()).toContain('Your week is open');
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Sign in to TritonPlan');
    expect(input('email')).not.toBeNull();
    expect(input('password')).not.toBeNull();
    expect(text()).toContain('Your plans are saved to your account, so they follow you to any device.');
    const google = [...container.querySelectorAll('a')].find((a) => a.textContent?.includes('Continue with Google'));
    expect(google?.getAttribute('href')).toBe('/api/auth/google?returnTo=%2F');
    expect(container.querySelector('.app')).toBeNull();
    expect(callsTo('GET', '/api/state')).toHaveLength(0);
  });

  it('what the extension brought shows under the card; signing in keeps every click for the planner', async () => {
    installBridgeHub();
    await mount('/');
    const cse = makeCourse('CSE-100|2026|2', 'CSE-100');
    const math = makeCourse('MATH-18|2026|2', 'MATH-18');
    await act(async () => {
      for (const data of [
        { source: BRIDGE_SOURCE, type: 'courses', version: 1, payload: [cse, math] },
        { source: BRIDGE_SOURCE, type: 'plan-add', version: 1, payload: { course: cse, selectedOptionId: cse.options[0]!.id } },
      ]) {
        window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: window.location.origin }));
      }
    });
    expect(container.querySelector('h1')?.textContent).toBe('Your plan');
    expect(text()).toContain('Fall 2026 · not saved yet');
    expect([...container.querySelectorAll('.shared__layout > .shared__side > .shared__courses .shared__code')].map((e) => e.textContent)).toEqual(['CSE-100']);
    expect([...container.querySelectorAll('.preview__browsed .shared__code')].map((e) => e.textContent)).toEqual(['MATH-18']);
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe('Sign in to save your plan');
    expect(text()).toContain('Your courses from TSS are here.');

    // Signed in from another tab (the verify link); coming back to this one enters the planner with the click.
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await becomeVisible();
    expect(container.querySelector('.app')).not.toBeNull();
    await letSyncRun();
    const saved = Object.values(srv.state.plans).map((p) => p.data as NamedPlan);
    expect(saved.flatMap((p) => p.plan.entries.map((e) => e.course.id))).toContain('CSE-100|2026|2');
  });

  it('the card closes (×, Escape) to the preview, and the page button opens it again', async () => {
    await mount('/');
    const dialog = () => container.querySelector('[role="dialog"]');
    expect(dialog()!.parentElement!.className).toContain('authdlg--delayed'); // first, the page
    await act(async () => container.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!.click());
    expect(dialog()).toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Plan your quarter');
    await click('Sign in');
    expect(dialog()).not.toBeNull();
    expect(dialog()!.parentElement!.className).not.toContain('authdlg--delayed'); // asked for: no waiting
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(dialog()).toBeNull();
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

  it('with nothing browsed, the extension that has spoken gets "Go to TSS", not the store link', async () => {
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    const cta = () => container.querySelector<HTMLAnchorElement>('.browse-empty__cta');
    expect(cta()?.textContent).toBe('Get the extension');

    // A freshly installed extension: an empty pool and no bookings captured yet.
    await act(async () => {
      for (const data of [
        { source: BRIDGE_SOURCE, type: 'courses', version: 1, payload: [] },
        { source: BRIDGE_SOURCE, type: 'booked', version: 1, payload: [], captured: false },
      ]) {
        window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: window.location.origin }));
      }
    });
    expect(cta()?.textContent).toBe('Go to TSS');
    expect(cta()?.getAttribute('href')).toBe(TSS_HOME_URL);
    expect(cta()?.getAttribute('target')).toBe('_blank');
    expect(text()).not.toContain('Get the extension');
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

describe('Root: opening a shared plan', () => {
  it('a signed-out visitor sees a shared plan read-only, with no sign-in wall', async () => {
    serveShare();
    await mount(`/s/${CODE}`);
    expect(container.querySelector('h1')?.textContent).toBe('Fall draft');
    expect(text()).toContain('Fall 2026 · shared with you · read-only');
    expect(text()).toContain('MATH-18');
    expect(input('email')).toBeNull();
    expect(container.querySelector('.app')).toBeNull();
    expect(srv.calls[0]?.url).toBe(`/api/s/${CODE}`); // asked for before who this is
    expect(callsTo('GET', '/api/state')).toHaveLength(0);
    expect(window.location.pathname).toBe(`/s/${CODE}`); // a reload shows it again
    expect(localStorage.getItem(PENDING_SHARE_KEY)).toBeNull(); // nothing kept until they ask to save
  });

  it('a turned-off or unknown code shows the "no longer works" page', async () => {
    await mount(`/s/${CODE}`); // the fake server answers 404 for any code it does not hold
    expect(text()).toContain('This link no longer works. The person who shared it may have turned it off.');
    const home = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Go to TritonPlan');
    expect(home?.getAttribute('href')).toBe('/');
    expect(input('email')).toBeNull();
    expect(callsTo('GET', '/api/me')).toHaveLength(0);
  });

  it('a short link the server cannot answer shows the offline screen, and Try again opens it', async () => {
    srv.auth[`GET /api/s/${CODE}`] = () => json(503, { error: 'unavailable' });
    await mount(`/s/${CODE}`);
    expect(text()).toContain("Can't reach TritonPlan right now.");
    serveShare();
    await click('Try again');
    expect(container.querySelector('h1')?.textContent).toBe('Fall draft');
  });

  it('Save to my account → sign in → the plan is saved as a new plan, no second click', async () => {
    serveShare();
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    expect(text()).toContain('Sign in to save this plan');
    expect(googleHref()).toBe(`/api/auth/google?returnTo=%2Fs%2F${CODE}`);
    await signInWithEmail();
    expect(navSpy).toHaveBeenCalledWith(`/s/${CODE}`);

    // The navigation to returnTo (Google's comes back the same way): the short link again, now signed in.
    reload();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount(`/s/${CODE}`);
    expect(window.location.pathname).toBe('/');
    await expectSavedAsNewPlan('Fall draft');

    // A reload neither fetches the link again nor saves it twice.
    reload();
    await mount('/');
    expect(callsTo('GET', `/api/s/${CODE}`)).toHaveLength(2); // the signed-out visit and the save
    expect(Object.keys(srv.state.plans)).toHaveLength(2);
  });

  it('a shared plan named like one of theirs is saved under a name of its own', async () => {
    serveShare(CODE, otherPlan(), 'Mine');
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    reload();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount(`/s/${CODE}`);
    await expectSavedAsNewPlan('Mine (shared)');
  });

  it('a new account starts with just the plan it saved, under its shared name', async () => {
    serveShare(CODE, otherPlan(), 'My plan');
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    reload();
    srv.me = 'in';
    srv.state = snapshotOf(); // signed up just now: nothing in the account
    await mount(`/s/${CODE}`);
    expect(container.querySelector('.planswitch__name')?.textContent).toBe('My plan');
    await letSyncRun();
    expect(savedPlans()).toEqual({ 'My plan': ['MATH-18|2026|2'] }); // no empty "My plan" beside it
  });

  it('a new account whose only Save is from a term that is over still gets a plan it can edit', async () => {
    serveShare(CODE, planIn({ year: '2025', period: '2', label: 'Fall 2025' }, 'CSE-12'), 'Last year');
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    reload();
    srv.me = 'in';
    srv.state = snapshotOf();
    await mount(`/s/${CODE}`);
    await letSyncRun();
    expect(savedPlans()).toEqual({ 'My plan': [], 'Last year': ['CSE-12|2025|2'] });
  });

  it('a plan from a term that is over is saved, and the planner says it is read-only', async () => {
    const FA25: Term = { year: '2025', period: '2', label: 'Fall 2025' };
    serveShare(CODE, planIn(FA25, 'CSE-12'), 'Last year');
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    reload();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount(`/s/${CODE}`);
    expect(text()).toContain('Saved the shared plan to your account — Fall 2025 is over, so it is read-only');
    expect(container.querySelector('.planswitch__name')?.textContent).toBe('Last year');
    await letSyncRun();
    expect(savedPlans()).toEqual({ Mine: ['CSE-8A|2026|2'], 'Last year': ['CSE-12|2025|2'] });
  });

  it('a signed-in visitor goes straight to the planner with the plan received', async () => {
    serveShare();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount(`/s/${CODE}`);
    expect(container.querySelector('.app')).not.toBeNull();
    expect(container.querySelector('.received--active')).not.toBeNull();
    expect(receivedIds()).toEqual(['MATH-18|2026|2']);
    expect(text()).not.toContain('Save to my account');
    expect(window.location.pathname).toBe('/');

    // A reload opens "/", so the link is not fetched again; the plan stays in the received slot.
    const here = window.location.pathname + window.location.search + window.location.hash;
    reload();
    await mount(here);
    expect(callsTo('GET', `/api/s/${CODE}`)).toHaveLength(1);
    expect(container.querySelector('.received--active')).not.toBeNull();
  });

  it('a #p= stashed earlier in this tab does not override a short link opened since', async () => {
    const hash = `#${planToHash(planWith('CSE-11'))}`;
    await mount(`/${hash}`); // signed out: the hash waits in this tab's sessionStorage
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBe(hash);

    reload(); // same tab, so the stash is still there
    serveShare();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount(`/s/${CODE}`);
    expect(receivedIds()).toEqual(['MATH-18|2026|2']);
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('a signed-out #p= link shows the read-only view and survives sign-in', async () => {
    const hash = `#${planToHash(otherPlan())}`;
    await mount(`/${hash}`);
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBe(hash);
    expect(container.querySelector('h1')?.textContent).toBe('Shared plan');
    expect(text()).toContain('MATH-18');
    expect(input('email')).toBeNull();

    await click('Save to my account');
    expect(text()).toContain('Sign in to save this plan');
    expect(googleHref()).toBe('/api/auth/google?returnTo=%2F');
    await signInWithEmail();
    expect(callsTo('POST', '/api/auth/login')[0]?.body).toEqual({ email: 'student@ucsd.edu', password: 'correct horse' });
    expect(navSpy).toHaveBeenCalledWith('/');

    // The navigation to returnTo: a fresh load of "/" with no hash, now signed in.
    reload();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBeNull();
    await expectSavedAsNewPlan('Shared plan');
  });

  it('a #p= link Save was clicked on is saved when this tab sees the sign-in from another tab', async () => {
    const hash = `#${planToHash(otherPlan())}`;
    await mount(`/${hash}`);
    await click('Save to my account');
    // Signed in from the confirm mail's tab; back in this one, the link is still in the address bar.
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await becomeVisible();
    expect(window.location.hash).toBe(''); // or it would open again, as a received plan
    await expectSavedAsNewPlan('Shared plan');
  });

  it('a #p= Save keeps the plan on show, even when the address bar changed under it', async () => {
    await mount(`/#${planToHash(otherPlan())}`);
    window.history.replaceState(null, '', `/#${planToHash(planWith('CSE-11'))}`); // pasted over, no reload
    await click('Save to my account');
    await signInWithEmail();
    reload();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    await expectSavedAsNewPlan('Shared plan');
  });

  it('a #p= link merely opened signed out still waits for its own Save after signing in', async () => {
    await mount(`/#${planToHash(otherPlan())}`);
    reload(); // no Save click: the visitor went to sign in some other way
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    expect(receivedIds()).toEqual(['MATH-18|2026|2']);
    expect(container.querySelector('.received')).not.toBeNull();
    expect(container.querySelector('.planswitch__name')?.textContent).toBe('Mine');
  });

  it('a #p= that does not decode goes straight to the sign-in form', async () => {
    await mount('/#p=not-a-plan');
    expect(input('email')).not.toBeNull();
    expect(text()).not.toContain('Save to my account');
  });
});

describe('Root: a short link saved before signing in', () => {
  it('opens after the confirm mail signs in from another tab', async () => {
    serveShare();
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    expect(JSON.parse(localStorage.getItem(PENDING_SHARE_KEY)!)).toMatchObject({ code: CODE });
    // Coming back to this tab while waiting for the mail fetches the link again: its own stash stays.
    await becomeVisible();
    expect(callsTo('GET', `/api/s/${CODE}`)).toHaveLength(2);
    expect(text()).toContain('Sign in to save this plan');
    expect(JSON.parse(localStorage.getItem(PENDING_SHARE_KEY)!)).toMatchObject({ code: CODE });

    // The confirm mail opens a new tab (its own sessionStorage), and /verify sends it to "/", not to the link.
    reload();
    sessionStorage.clear();
    srv.auth['POST /api/auth/verify'] = () => json(200, { ok: true });
    await mount('/verify#token=tok');
    type(input('password'), 'correct horse');
    await click('Confirm and sign in');
    expect(navSpy).toHaveBeenCalledWith('/');

    reload();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    await expectSavedAsNewPlan('Fall draft');
  });

  it('is ignored after 24 h', async () => {
    serveShare();
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    reload();
    vi.setSystemTime(Date.now() + 24 * 3_600_000 + 60_000);
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    expect(container.querySelector('.app')).not.toBeNull();
    expect(container.querySelector('.received')).toBeNull();
    expect(loadReceived()).toBeNull();
    expect(callsTo('GET', `/api/s/${CODE}`)).toHaveLength(1); // only the visit itself
    expect(localStorage.getItem(PENDING_SHARE_KEY)).toBeNull();
  });

  it.each([
    ['a short link', () => {
      serveShare('ZyXwVuTs98', otherPlan(), 'Newer');
      return '/s/ZyXwVuTs98';
    }],
    ['a #p= link', () => `/#${planToHash(otherPlan())}`],
  ])('is still saved beside %s in the address bar, which opens as received', async (_, path) => {
    serveShare(CODE, planWith('CSE-11'), 'Older save');
    stashPendingShare(CODE);
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount(path());
    expect(receivedIds()).toEqual(['MATH-18|2026|2']); // the link being opened now is what shows
    expect(container.querySelector('.received--active')).not.toBeNull();
    expect(text()).toContain('Saved the shared plan to your account');
    expect(localStorage.getItem(PENDING_SHARE_KEY)).toBeNull();
    await letSyncRun();
    expect(savedPlans()).toEqual({ Mine: ['CSE-8A|2026|2'], 'Older save': ['CSE-11|2026|2'] });
  });

  it.each([
    ['is turned off', 404, 'This link no longer works. The person who shared it may have turned it off.'],
    ['cannot be reached', 503, "Can't reach TritonPlan right now."],
  ])('survives a short link in the address bar that %s, and is saved at the next signed-in load', async (_, status, screen) => {
    serveShare(CODE, planWith('CSE-11'), 'Older save');
    stashPendingShare(CODE);
    srv.auth['GET /api/s/DeadDead00'] = () => json(status, { error: 'x' });
    await mount('/s/DeadDead00');
    expect(text()).toContain(screen);
    expect(JSON.parse(localStorage.getItem(PENDING_SHARE_KEY)!)).toMatchObject({ code: CODE });

    // "Go to TritonPlan" (or any later visit), signed in.
    reload();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    expect(container.querySelector('.planswitch__name')?.textContent).toBe('Older save');
    expect(loadReceived()).toBeNull();
    await letSyncRun();
    expect(savedPlans()).toEqual({ Mine: ['CSE-8A|2026|2'], 'Older save': ['CSE-11|2026|2'] });
  });

  it('is not cancelled by looking at another link in another tab', async () => {
    serveShare();
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    const tabA = sessionStorage.getItem(PENDING_SAVE_KEY);

    // Another tab, signed out, only looks at a second link.
    reload();
    sessionStorage.clear();
    serveShare('ZyXwVuTs98', planWith('CSE-11'), 'Just looking');
    await mount('/s/ZyXwVuTs98');
    expect(container.querySelector('h1')?.textContent).toBe('Just looking');

    // Back in the first tab, Google sends it to its link, signed in.
    reload();
    sessionStorage.clear();
    sessionStorage.setItem(PENDING_SAVE_KEY, tabA!);
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount(`/s/${CODE}`);
    await expectSavedAsNewPlan('Fall draft');
  });

  it('the first tab, back after the confirm mail\'s tab saved it, neither saves nor offers it again — edited there or not', async () => {
    serveShare();
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    const tabA = sessionStorage.getItem(PENDING_SAVE_KEY);

    // The confirm mail's tab (its own sessionStorage) signs in and saves "Fall draft"...
    reload();
    sessionStorage.clear();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    await expectSavedAsNewPlan('Fall draft');
    // ...which the student then changes there.
    const [id, doc] = Object.entries(srv.state.plans).find(([, p]) => (p.data as NamedPlan).name === 'Fall draft')!;
    const named = doc.data as NamedPlan;
    const edited = { ...named, plan: { ...named.plan, entries: named.plan.entries.map((e) => ({ ...e, selectedOptionId: null })) } };
    srv.state.plans[id] = { ...doc, version: doc.version + 100, data: edited };

    // Back in the first tab, which Google (or a refocus) brings to its link signed in.
    reload();
    sessionStorage.clear();
    sessionStorage.setItem(PENDING_SAVE_KEY, tabA!);
    await mount(`/s/${CODE}`);
    expect(container.querySelector('.app')).not.toBeNull();
    expect(container.querySelector('.received')).toBeNull();
    expect(loadReceived()).toBeNull();
    expect(text()).toContain('That shared plan is already in your account');
    expect(text()).not.toContain('Saved the shared plan');
    expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
    expect(window.location.pathname).toBe('/');
    await letSyncRun();
    expect(Object.keys(savedPlans()).sort()).toEqual(['Fall draft', 'Mine']);
  });

  it('a #p= link and then a short link, both saved in one tab before signing in, are both kept', async () => {
    await mount(`/#${planToHash(otherPlan())}`);
    await click('Save to my account');
    reload(); // same tab
    serveShare(CODE, planWith('CSE-11'), 'Short save');
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    await signInWithEmail();

    reload();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount(`/s/${CODE}`);
    expect(text()).toContain('Saved 2 shared plans to your account');
    await letSyncRun();
    expect(savedPlans()).toEqual({
      Mine: ['CSE-8A|2026|2'], 'Short save': ['CSE-11|2026|2'], 'Shared plan': ['MATH-18|2026|2'],
    });
  });

  it('a Save whose link was turned off meanwhile does not hide the live link being opened', async () => {
    stashPendingShare('DeadDead00');
    serveShare();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount(`/s/${CODE}`);
    expect(container.querySelector('.received--active')).not.toBeNull();
    expect(receivedIds()).toEqual(['MATH-18|2026|2']);
    expect(text()).toContain('A plan you chose to save is no longer shared');
    expect(localStorage.getItem(PENDING_SHARE_KEY)).toBeNull();
  });

  it('a short link and then a #p= link, both saved in one tab before signing in, are both kept', async () => {
    serveShare(CODE, planWith('CSE-11'), 'Short save');
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    reload(); // same tab
    await mount(`/#${planToHash(otherPlan())}`);
    await click('Save to my account');
    await signInWithEmail();

    reload();
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    expect(text()).toContain('Saved 2 shared plans to your account');
    expect(loadReceived()).toBeNull();
    expect(localStorage.getItem(PENDING_SHARE_KEY)).toBeNull();
    expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
    await letSyncRun();
    expect(savedPlans()).toEqual({
      Mine: ['CSE-8A|2026|2'], 'Short save': ['CSE-11|2026|2'], 'Shared plan': ['MATH-18|2026|2'],
    });
  });

  it('waits out the old-site import screen, and a reload there does not lose it', async () => {
    serveShare();
    await mount(`/s/${CODE}`);
    await click('Save to my account');
    reload();
    savePendingMigration(migrationPayload());
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount(`/s/${CODE}`);
    expect(text()).toContain('Move your plans');
    expect(container.querySelector('.app')).toBeNull();

    reload(); // on the import screen
    await mount('/');
    await click('OK'); // the old site's plan is plan-1, which the account already holds
    await expectSavedAsNewPlan('Fall draft');
  });

  it('one the server cannot answer yet stays stashed, first time and all, for the next load', async () => {
    stashPendingShare(CODE);
    const stashed = localStorage.getItem(PENDING_SHARE_KEY);
    srv.auth[`GET /api/s/${CODE}`] = () => json(500, { error: 'boom' });
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    expect(text()).toContain("Can't reach TritonPlan right now.");
    expect(localStorage.getItem(PENDING_SHARE_KEY)).toBe(stashed);

    // A reload rather than Try again: the link is still there to save.
    reload();
    serveShare();
    await mount('/');
    await expectSavedAsNewPlan('Fall draft');
  });

  it('one the server cannot answer yet shows the offline screen, and Try again opens it', async () => {
    stashPendingShare(CODE);
    srv.auth[`GET /api/s/${CODE}`] = () => json(500, { error: 'boom' });
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    expect(text()).toContain("Can't reach TritonPlan right now.");
    serveShare();
    await click('Try again');
    await expectSavedAsNewPlan('Fall draft');
  });

  it('one turned off meanwhile is dropped, and the planner says so', async () => {
    stashPendingShare(CODE);
    srv.me = 'in';
    srv.state = snapshotOf(mine());
    await mount('/');
    expect(container.querySelector('.app')).not.toBeNull();
    expect(text()).toContain('A plan you chose to save is no longer shared');
    expect(localStorage.getItem(PENDING_SHARE_KEY)).toBeNull();
    await letSyncRun();
    expect(savedPlans()).toEqual({ Mine: ['CSE-8A|2026|2'] });
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

  it('a remount keeps what the extension already said: "Go to TSS" stays', async () => {
    installBridgeHub();
    srv.me = 'in';
    srv.state = snapshotOf(mine('Mine'));
    await mount('/');
    await letSyncRun();
    // The extension speaks once per page load (and again only when TSS captures something new).
    await act(async () => {
      for (const data of [
        { source: BRIDGE_SOURCE, type: 'courses', version: 1, payload: [] },
        { source: BRIDGE_SOURCE, type: 'booked', version: 1, payload: [], captured: false },
      ]) {
        window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: window.location.origin }));
      }
    });
    const cta = () => container.querySelector<HTMLAnchorElement>('.browse-empty__cta');
    expect(cta()?.textContent).toBe('Go to TSS');
    const doc = srv.state.plans['plan-1']!;
    srv.state.plans['plan-1'] = { ...doc, version: doc.version + 100, data: { ...(doc.data as NamedPlan), name: 'Renamed on phone' } };
    await waitOutThrottle();
    await becomeVisible();
    expect(boots).toHaveLength(2);
    expect(container.querySelector('.planswitch__name')?.textContent).toBe('Renamed on phone');
    expect(cta()?.textContent).toBe('Go to TSS');
  });

  it('signed in as someone else in another tab → the page reloads, never showing their plans under this name', async () => {
    const reloadSpy = vi.spyOn(nav, 'reload').mockImplementation(() => {});
    srv.me = 'in';
    srv.state = snapshotOf(mine('Mine'));
    await mount('/');
    await letSyncRun();
    srv.who = { ...TEST_ME, email: 'someone.else@ucsd.edu' };
    srv.state = snapshotOf(mine('Theirs'));
    await waitOutThrottle();
    await becomeVisible();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(boots).toHaveLength(1);
    expect(disposed(boots[0]!)).toBe(true); // this tab's leftovers must not save into their account
    expect(container.querySelector('.planswitch__name')?.textContent).toBe('Mine');
  });

  it('the same account with a password set elsewhere remounts with the fresh account details', async () => {
    srv.me = 'in';
    srv.who = { ...TEST_ME, hasPassword: false, hasGoogle: true };
    srv.state = snapshotOf(mine('Mine'));
    await mount('/');
    await letSyncRun();
    srv.who = { ...TEST_ME, hasPassword: true, hasGoogle: true };
    addCourseElsewhere();
    await waitOutThrottle();
    await becomeVisible();
    expect(boots).toHaveLength(2);
    expect(boots[1]!.me).toEqual({ ...TEST_ME, hasPassword: true, hasGoogle: true });
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
    type(confirmInput(), 'new password 1');
    await click('Save password');
    expect(callsTo('POST', '/api/auth/reset')[0]?.body).toEqual({ token: 'abc', password: 'new password 1' });
    expect(navSpy).toHaveBeenCalledWith('/');
    expect(callsTo('GET', '/api/me')).toHaveLength(0);
  });

  it('a new password typed differently twice is caught before the reset is sent', async () => {
    srv.auth['POST /api/auth/reset'] = () => json(200, { ok: true });
    await mount('/reset#token=abc');
    type(input('password'), 'new password 1');
    type(confirmInput(), 'new password 2');
    await click('Save password');
    expect(text()).toContain("The passwords don't match.");
    expect(callsTo('POST', '/api/auth/reset')).toHaveLength(0);
    expect(navSpy).not.toHaveBeenCalled();
  });

  it.each([
    [{ error: 'link_expired' }, LINK_EXPIRED],
    [{ error: 'weak_password' }, 'Use at least 8 characters.'],
  ])('a reset answered 400 %j says so', async (answer, copy) => {
    srv.auth['POST /api/auth/reset'] = () => json(400, answer);
    await mount('/reset#token=abc');
    type(input('password'), 'short');
    type(confirmInput(), 'short');
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
    expect(confirmInput()).toBeNull(); // nor a second box
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

  describe('extension course pushes', () => {
    const C = { ...makeCourse('CSE-100|2026|2', 'CSE-100'), capturedAt: '2026-10-01T00:00:00.000Z' };
    const D = { ...makeCourse('MATH-18|2026|2', 'MATH-18'), capturedAt: '2026-10-01T00:00:00.000Z' };
    const entry = (c: typeof C) => ({ course: c, selectedOptionId: c.options[0]!.id, color: '120' });
    const terms = (): TermsState => ({
      version: 1,
      activeTermKey: '2026|2',
      terms: {
        '2026|2': {
          term: FA,
          plans: {
            activeId: 'plan-1',
            plans: [
              { id: 'plan-1', name: 'One', plan: { ...makePlan(), entries: [entry(C)] }, createdAt: 'c', updatedAt: 'u', browsed: [C.id, D.id] },
              { id: 'plan-2', name: 'Two', plan: { ...makePlan(), entries: [entry(D)] }, createdAt: 'c', updatedAt: 'u', browsed: [D.id] },
            ],
          },
        },
      },
    });
    const push = (payload: unknown[]) =>
      act(async () => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { source: BRIDGE_SOURCE, type: 'courses', version: 1, payload },
          source: window,
          origin: window.location.origin,
        }));
      });

    async function start() {
      const boot = makeTestBoot({ terms: terms(), pool: [C, D] });
      let api!: ReturnType<typeof usePlan>;
      function Probe() {
        api = usePlan(boot);
        return null;
      }
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => root!.render(<Probe />));
      await act(() => boot.engine.flush()); // whatever the first render had to save (the dev sample pool)
      const setTerms = vi.spyOn(boot.engine, 'setTerms');
      return { boot, setTerms, api: () => api, sentBefore: boot.sent.length };
    }

    it('an identical push (every planner load re-sends the capture) changes no state and sends nothing', async () => {
      const t = await start();
      const plansBefore = t.api().plans;
      await push([structuredClone(C), structuredClone(D)]);
      await act(() => t.boot.engine.flush());
      expect(t.setTerms).not.toHaveBeenCalled(); // the terms state kept its reference
      expect(t.api().plans).toBe(plansBefore);
      expect(t.boot.sent.length).toBe(t.sentBefore);
      t.boot.engine.dispose();
    });

    it('a real seat change updates exactly the plan holding that course', async () => {
      const t = await start();
      const fresh = { ...structuredClone(C), options: C.options.map((o) => ({ ...o, seatsAvailable: 5, limit: 100 })) };
      await push([fresh, structuredClone(D)]);
      await act(() => t.boot.engine.flush());
      const ops = t.boot.sent.slice(t.sentBefore).flat();
      const puts = ops.filter((o): o is Extract<SyncOp, { op: 'putPlan' }> => o.op === 'putPlan');
      expect(puts.map((o) => o.planId)).toEqual(['plan-1']);
      expect((puts[0]!.data as NamedPlan).plan.entries[0]!.course.options[0]!.seatsAvailable).toBe(5);
      expect(ops.some((o) => o.op === 'putCourses' && o.courses.length === 1 && o.courses[0]!.id === C.id)).toBe(true);
      t.boot.engine.dispose();
    });
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
  const pending = migrationPayload;

  it('a signed-out visit to /migrate with a pending payload asks to sign in and returns to /', async () => {
    savePendingMigration(pending());
    await mount('/migrate');
    expect(text()).toContain('Sign in to finish moving your plans');
    // Not /migrate: if the payload is gone by then (imported in another tab), /migrate would wait for the
    // old site forever. Any path picks up a payload that is still pending.
    const google = [...container.querySelectorAll('a')].find((a) => a.textContent?.includes('Continue with Google'));
    expect(google?.getAttribute('href')).toBe('/api/auth/google?returnTo=%2F');
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
