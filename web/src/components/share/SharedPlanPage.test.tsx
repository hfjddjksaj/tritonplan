import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanState, SyncOp, SyncVersions, Term } from '@triton/shared';
import * as api from '../../lib/cloud/api';
import type { SharedDoc } from '../../lib/cloud/api';
import { peekPendingShare, stashPendingShare } from '../../lib/cloud/boot';
import { BRIDGE_SOURCE, DEFERRED_ADDS_KEY, installBridgeHub, resetBridgeHubForTests } from '../../lib/bridge';
import { makeClashPlan, makeCourse, makePlan } from '../../lib/fixtures';
import type { NamedPlan } from '../../lib/plans';
import type { TermsState } from '../../lib/terms-state';
import { snapshotOf, TEST_ME } from '../../test/boot';
import { TIP_DELAY } from '../Tooltip';
import { SharedPlanPage } from './SharedPlanPage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/cloud/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/cloud/api')>()),
  fetchSharedPlan: vi.fn(),
  fetchSharedVersion: vi.fn(),
  selectSharedOption: vi.fn(),
  fetchMe: vi.fn(),
  fetchState: vi.fn(),
  postSync: vi.fn(),
}));
const fetchPlan = vi.mocked(api.fetchSharedPlan);
const fetchVersion = vi.mocked(api.fetchSharedVersion);
const postSelect = vi.mocked(api.selectSharedOption);
const fetchMe = vi.mocked(api.fetchMe);
const fetchState = vi.mocked(api.fetchState);
const postSync = vi.mocked(api.postSync);

const DAY = 86_400_000;
const CODE = 'Ab3dE9xQ2k';

/** The clash plan as the owner browsed it: seat counts from a TSS visit, and sections TSS can book. */
function browsedPlan(): PlanState {
  const plan = makeClashPlan();
  for (const e of plan.entries) {
    e.course.capturedAt = new Date(Date.now() - 3_600_000).toISOString();
    e.course.options = e.course.options.map((o, i) => ({ ...o, enrollCode: `EP00${i + 1}`, seatsAvailable: 5 }));
  }
  return plan;
}

const docOf = (plan: PlanState = browsedPlan()): SharedDoc => ({
  name: 'Fall draft',
  plan,
  version: 4,
  // Six days and a bit less: a link made yesterday.
  expiresAt: new Date(Date.now() + 6 * DAY - 3_600_000).toISOString(),
});

let container: HTMLDivElement;
let root: Root;
let write: ReturnType<typeof vi.fn>;

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => {});
}
async function render(path = `/s/${CODE}`) {
  window.history.replaceState(null, '', path);
  await act(async () => root.render(<SharedPlanPage code={CODE} />));
  await settle();
}
const text = () => container.textContent ?? '';
const buttonTexts = () => [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());
function button(label: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === label);
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  return b;
}
const card = (code: string) =>
  [...container.querySelectorAll('.course-card')].find((c) => c.querySelector('.course-card__code')?.textContent === code)!;
const planAdd = (id: string) => ({
  source: BRIDGE_SOURCE, type: 'plan-add', version: 1,
  payload: { course: makeCourse(id, 'MATH-20'), selectedOptionId: `${id}-opt` },
});
function post(data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: window.location.origin }));
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  resetBridgeHubForTests();
  fetchPlan.mockResolvedValue(docOf());
  fetchVersion.mockResolvedValue(4);
  postSelect.mockResolvedValue(5);
  write = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetBridgeHubForTests();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('SharedPlanPage', () => {
  it('the violet bar says what this is, its term and when it expires, with only Map, Copy link and Save', async () => {
    await render();
    expect(fetchPlan).toHaveBeenCalledWith(CODE);
    const bar = container.querySelector('.topbar--shared')!;
    expect(bar).not.toBeNull();
    expect(bar.textContent).toContain('Shared plan');
    expect(bar.textContent).toContain('Fall 2026');
    expect(bar.textContent).toContain('Live · expires in 6 days');
    expect([...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Map', 'Copy link', 'Save to my plans',
    ]);
    // Nothing of the own planner's bar: no plan or term switcher, account, Clear or calendar Share.
    expect(container.querySelectorAll('.topbar')).toHaveLength(1);
    expect(container.querySelector('.planswitch')).toBeNull();
    expect(container.querySelector('.termsw')).toBeNull();
    expect(container.querySelector('.acctbtn')).toBeNull();
    expect(container.querySelector('[aria-haspopup="dialog"]')).toBeNull();
    expect(buttonTexts()).not.toContain('Clear');
  });

  it("the rail holds the plan's courses: no remove, no booking, and a section switch goes to the server", async () => {
    await render();
    expect(container.querySelectorAll('.course-card')).toHaveLength(2);
    expect(container.querySelector('.course-card__remove')).toBeNull();
    expect(buttonTexts()).not.toContain('book section');
    expect(container.querySelector('.rail__count')?.textContent).toMatch(/^2 courses/);

    const cse = card('CSE-8A');
    await act(async () => cse.querySelector<HTMLButtonElement>('.picker__toggle')!.click());
    const p002 = [...cse.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.includes('P-002'))!;
    await act(async () => p002.click());
    await settle();
    expect(postSelect).toHaveBeenCalledWith(CODE, 'CSE-8A|2026|2', 'o2');
  });

  it('says nothing that only fits your own plan: no refreshing seats from TSS', async () => {
    await render();
    const cse = card('CSE-8A');
    await act(async () => cse.querySelector<HTMLButtonElement>('.picker__toggle')!.click());
    expect(text()).not.toMatch(/browse the\s+course again/);
    const fresh = cse.querySelector('.course-card__fresh')!;
    // jsdom has no PointerEvent; React reads only `pointerType` off the native event.
    const over = new MouseEvent('pointerover', { bubbles: true });
    Object.defineProperty(over, 'pointerType', { value: 'mouse' });
    act(() => fresh.dispatchEvent(over));
    await act(async () => { await new Promise((r) => setTimeout(r, TIP_DELAY + 50)); });
    expect(document.body.textContent).toContain('Seat counts are from when this course was last browsed in TSS');
    expect(document.body.textContent).not.toContain('to refresh them');
  });

  it("Copy link copies this page's address and says so", async () => {
    await render();
    await act(async () => button('Copy link').click());
    expect(write).toHaveBeenCalledWith(`${window.location.origin}/s/${CODE}`);
    expect(container.querySelector('.toast')?.textContent).toContain('Link copied');
  });

  it('a clipboard that refuses still leaves the link on screen', async () => {
    write.mockRejectedValue(new Error('denied'));
    await render();
    await act(async () => button('Copy link').click());
    await settle();
    expect(container.querySelector('.toast')?.textContent).toContain(`${window.location.origin}/s/${CODE}`);
  });


  it('an expired or unknown link says so, with a full page load back to TritonPlan', async () => {
    fetchPlan.mockResolvedValue('not-found');
    await render();
    expect(container.querySelector('h1')?.textContent).toBe('This shared plan has expired.');
    expect(text()).toContain('Shared plans last 7 days.');
    const home = [...container.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Go to TritonPlan');
    expect(home?.getAttribute('href')).toBe('/');
  });

  it("an unreachable server says so, and Try again opens the plan", async () => {
    fetchPlan.mockResolvedValue(null);
    await render();
    expect(text()).toContain("Can't reach TritonPlan right now.");
    fetchPlan.mockResolvedValue(docOf());
    await act(async () => button('Try again').click());
    await settle();
    expect(container.querySelector('.topbar--shared')).not.toBeNull();
  });

  it('a "+ TritonPlan" click an old extension drains here is kept for your own planner, not added', async () => {
    installBridgeHub();
    post(planAdd('EARLY|2026|2')); // queued before the page mounted
    await render();
    post(planAdd('LATE|2026|2'));
    await settle();
    const parked = (JSON.parse(localStorage.getItem(DEFERRED_ADDS_KEY) ?? '[]') as { payload: { course: { id: string } } }[])
      .map((m) => m.payload.course.id);
    expect(parked).toEqual(['EARLY|2026|2', 'LATE|2026|2']);
    expect(container.querySelectorAll('.course-card')).toHaveLength(2);
    expect(text()).not.toContain('MATH-20');
    expect(postSelect).not.toHaveBeenCalled();
  });
});

const FA: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WI: Term = { year: '2027', period: '3', label: 'Winter 2027' };
const named = (id: string, name: string, plan: PlanState): NamedPlan => ({
  id, name, plan, createdAt: 'c', updatedAt: 'u', browsed: [],
});
/** The visitor's account: Fall 2026 "Mine" (CSE-8A) and Winter 2027 "Winter plan", the term their planner opens on. */
function account(): TermsState {
  return {
    version: 1,
    activeTermKey: '2027|3',
    terms: {
      '2026|2': { term: FA, plans: { activeId: 'plan-1', plans: [named('plan-1', 'Mine', makePlan())] } },
      '2027|3': { term: WI, plans: { activeId: 'plan-w', plans: [named('plan-w', 'Winter plan', { version: 1, term: WI, entries: [] })] } },
    },
  };
}

describe('SharedPlanPage: Save to my plans', () => {
  let synced: SyncOp[][];
  beforeEach(() => {
    synced = [];
    fetchMe.mockResolvedValue(TEST_ME);
    fetchState.mockResolvedValue(snapshotOf(account()));
    let counter = 100;
    postSync.mockImplementation(async (ops) => {
      synced.push(ops);
      const versions: SyncVersions = { terms: {}, plans: {} };
      for (const op of ops) {
        if (op.op === 'putTerm') versions.terms[op.termKey] = ++counter;
        if (op.op === 'putPlan') versions.plans[op.planId] = ++counter;
      }
      return { ok: true, versions };
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  afterEach(() => {
    delete (document as unknown as { visibilityState?: string }).visibilityState;
  });

  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
  function inDialog(label: string): HTMLElement {
    const el = [...(dialog()?.querySelectorAll<HTMLElement>('button, label') ?? [])].find((b) => b.textContent?.trim() === label);
    if (!el) throw new Error(`no "${label}" in: ${dialog()?.textContent ?? '(no dialog)'}`);
    return el;
  }
  async function press(el: HTMLElement) {
    await act(async () => el.click());
    await settle();
  }
  const putPlans = () =>
    synced.flat().filter((o): o is Extract<SyncOp, { op: 'putPlan' }> => o.op === 'putPlan').map((o) => o.data as NamedPlan);

  it('signed in, a new plan of the picked courses is saved, a toast says so, and the page stays and keeps polling', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await render();
    await press(button('Save to my plans'));
    expect(dialog()?.textContent).toContain('Save as a new plan');
    await press(dialog()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!); // MATH-18 stays behind
    await press(inDialog('Save'));

    expect(dialog()).toBeNull();
    expect(container.querySelector('.toast')?.textContent).toContain('Saved to your plans as "Fall draft"');
    expect(putPlans()).toHaveLength(1);
    expect(putPlans()[0]!.name).toBe('Fall draft');
    expect(putPlans()[0]!.plan.entries.map((e) => e.course.id)).toEqual(['CSE-8A|2026|2']);
    expect(window.location.pathname).toBe(`/s/${CODE}`);
    expect(window.location.search).toBe('');
    expect(container.querySelector('.topbar--shared')).not.toBeNull();

    const polls = fetchVersion.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(fetchVersion.mock.calls.length).toBeGreaterThan(polls);
  });

  it("replace offers the visitor's plans of the shared plan's term, asks first, and says what it replaced", async () => {
    await render();
    await press(button('Save to my plans'));
    await press(inDialog('Replace a plan'));
    expect(dialog()?.textContent).toContain('Mine');
    expect(dialog()?.textContent).not.toContain('Winter plan');
    await press(inDialog('Mine'));
    await press(inDialog('Save'));
    expect(synced).toHaveLength(0);
    await press(inDialog('Replace'));
    expect(container.querySelector('.toast')?.textContent).toContain('Replaced "Mine" with the courses you picked');
    expect(putPlans().map((p) => [p.id, p.name, p.plan.entries.map((e) => e.course.id)])).toEqual([
      ['plan-1', 'Mine', ['CSE-8A|2026|2', 'MATH-18|2026|2']],
    ]);
  });

  it("a save that fails keeps the dialog open with an error, and Save tries again", async () => {
    postSync.mockResolvedValueOnce({ ok: false, kind: 'network' });
    await render();
    await press(button('Save to my plans'));
    await press(inDialog('Save'));
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe("Couldn't save. Try again.");
    expect(container.querySelector('.toast')).toBeNull();
    await press(inDialog('Save'));
    expect(dialog()).toBeNull();
    expect(container.querySelector('.toast')?.textContent).toContain('Saved to your plans as "Fall draft"');
  });

  it('signed out, the sign-in card opens over the page and comes back here with the dialog open', async () => {
    fetchMe.mockResolvedValue(null);
    await render();
    await press(button('Save to my plans'));
    expect(fetchState).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Sign in to TritonPlan');
    const google = [...document.body.querySelectorAll('a')].find((a) => a.textContent?.includes('Continue with Google'));
    expect(google?.getAttribute('href')).toBe(`/api/auth/google?returnTo=${encodeURIComponent(`/s/${CODE}?save=1`)}`);
    // The emailed confirm link opens a tab of its own at "/", which sends it back here from this.
    expect(peekPendingShare()).toBe(CODE);
    await press(dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!);
    expect(dialog()).toBeNull();
    expect(container.querySelector('.topbar--shared')).not.toBeNull();
  });

  it('a session that ended while the dialog was open asks to sign in, keeping the link', async () => {
    postSync.mockResolvedValue({ ok: false, kind: 'unauthorized' });
    await render();
    await press(button('Save to my plans'));
    await press(inDialog('Save'));
    expect(dialog()?.textContent).toContain('Sign in to TritonPlan');
    expect(peekPendingShare()).toBe(CODE);
  });

  it('?save=1 opens the dialog once the plan is in, drops the flag from the address bar and the stashed link', async () => {
    stashPendingShare(CODE);
    await render(`/s/${CODE}?save=1`);
    expect(window.location.pathname).toBe(`/s/${CODE}`);
    expect(window.location.search).toBe('');
    expect(dialog()?.textContent).toContain('Save as a new plan');
    expect(peekPendingShare()).toBeNull();
    // Once: closing it does not bring it back.
    await press(dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!);
    await settle();
    expect(dialog()).toBeNull();
    expect(fetchMe).toHaveBeenCalledTimes(1);
  });

  it('?save=1 on an unreachable link opens the dialog after Try again', async () => {
    fetchPlan.mockResolvedValueOnce(null);
    await render(`/s/${CODE}?save=1`);
    expect(text()).toContain("Can't reach TritonPlan right now.");
    expect(dialog()).toBeNull();
    await act(async () => button('Try again').click());
    await settle();
    expect(dialog()?.textContent).toContain('Save as a new plan');
  });

  it('?save=1 on an expired code shows the expired screen and saves nothing', async () => {
    fetchPlan.mockResolvedValue('not-found');
    stashPendingShare(CODE);
    await render(`/s/${CODE}?save=1`);
    expect(container.querySelector('h1')?.textContent).toBe('This shared plan has expired.');
    expect(dialog()).toBeNull();
    expect(fetchMe).not.toHaveBeenCalled();
    expect(fetchState).not.toHaveBeenCalled();
    expect(postSync).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
    expect(peekPendingShare()).toBeNull();
  });
});
