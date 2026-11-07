import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanState } from '@triton/shared';
import * as api from '../../lib/cloud/api';
import type { SharedDoc } from '../../lib/cloud/api';
import { BRIDGE_SOURCE, DEFERRED_ADDS_KEY, installBridgeHub, resetBridgeHubForTests } from '../../lib/bridge';
import { makeClashPlan, makeCourse } from '../../lib/fixtures';
import { TIP_DELAY } from '../Tooltip';
import { SharedPlanPage } from './SharedPlanPage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/cloud/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/cloud/api')>()),
  fetchSharedPlan: vi.fn(),
  fetchSharedVersion: vi.fn(),
  selectSharedOption: vi.fn(),
}));
const fetchPlan = vi.mocked(api.fetchSharedPlan);
const fetchVersion = vi.mocked(api.fetchSharedVersion);
const postSelect = vi.mocked(api.selectSharedOption);

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
const onSave = vi.fn();

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => {});
}
async function render() {
  await act(async () => root.render(<SharedPlanPage code={CODE} onSave={onSave} />));
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

  it('Save to my plans hands over the plan on show', async () => {
    const doc = docOf();
    fetchPlan.mockResolvedValue(doc);
    await render();
    await act(async () => button('Save to my plans').click());
    expect(onSave).toHaveBeenCalledWith(doc);
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
