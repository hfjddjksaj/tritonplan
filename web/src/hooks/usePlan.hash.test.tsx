import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanState } from '@triton/shared';
import { usePlan } from './usePlan';
import { makeCourse, makePlan } from '../lib/fixtures';
import { encodePlan, planToMirrorHash } from '../lib/share';
import { makeGuestBoot, type CloudBoot } from '../lib/cloud/boot';
import type { NamedPlan } from '../lib/plans';
import type { TermsState } from '../lib/terms-state';
import { makeTestBoot } from '../test/boot';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof usePlan>;

function otherPlan(): PlanState {
  const course = makeCourse('MATH-18|2026|2', 'MATH-18');
  return { ...makePlan(), entries: [{ course, selectedOptionId: course.options[0]!.id, color: '120' }] };
}

/** An account holding these plans in Fall 2026, the one at `active` selected. */
function account(plans: PlanState[], active = 0): TermsState {
  const named: NamedPlan[] = plans.map((plan, i) => ({
    id: `p${i}`, name: `Plan ${i}`, plan, createdAt: 'c', updatedAt: 'u', browsed: [],
  }));
  return {
    version: 1,
    activeTermKey: '2026|2',
    terms: { '2026|2': { term: plans[0]!.term, plans: { activeId: `p${active}`, plans: named } } },
  };
}

const courseIds = (p: PlanState) => p.entries.map((e) => e.course.id);
/** A share link from before shared plans lived on the server: the whole plan in the address bar. */
const oldLink = (plan: PlanState) => `#p=${encodePlan(plan)}`;

let container: HTMLDivElement;
let root: Root | null;
let api: Api;
let boot: CloudBoot;
let onOldLink: ReturnType<typeof vi.fn>;

function Probe() {
  api = usePlan(boot, onOldLink);
  return null;
}

async function open(hash: string, terms: TermsState, guest = false) {
  window.history.replaceState(null, '', `/${hash}`);
  boot = guest ? { ...makeGuestBoot(), terms } : makeTestBoot({ terms });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Probe />));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  onOldLink = vi.fn();
  // Fall 2026 is still open (it archives on Dec 20), so the planner opens on it.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T20:00:00Z'));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  boot.engine.dispose();
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
});

/*
 * The URL is the plan. A bookmark carrying #m=<plan> opened where the account
 * holds other plans used to show the active plan and then overwrite the
 * address bar with it — the bookmarked plan was lost.
 */
describe('usePlan: opening a #m= mirror hash', () => {
  it('switches to the bookmarked plan when the account holds it but another is active', async () => {
    const a = makePlan();
    const b = otherPlan();
    await open(`#${planToMirrorHash(a)}`, account([a, b], 1));
    expect(courseIds(api.plan)).toEqual(courseIds(a));
    expect(api.viewPlan).toBe(api.plan);
    expect(onOldLink).not.toHaveBeenCalled();
  });

  it('removes a #m= that matches one of my plans from the address bar after load', async () => {
    const a = makePlan();
    const b = otherPlan();
    await open(`#${planToMirrorHash(a)}`, account([a, b], 1));
    expect(window.location.hash).toBe('');
  });

  // Nothing writes #m= any more, so one matching none of my plans is a bookmark from an older version.
  it("another device's #m= bookmark leaves my plan as it is and says the link no longer opens (iPad bookmark)", async () => {
    const ipadPlan = makePlan();
    await open(`#${planToMirrorHash(otherPlan())}`, account([ipadPlan])); // the bookmark from the laptop
    expect(courseIds(api.plan)).toEqual(courseIds(ipadPlan));
    expect(api.viewPlan).toBe(api.plan);
    expect(api.readOnly).toBe(false);
    expect(onOldLink).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
  });

  it('adding a course no longer writes #m= into the address bar', async () => {
    await open('', account([makePlan()]));
    expect(window.location.hash).toBe('');
    await act(async () => api.addCourse(makeCourse('MATH-18|2026|2', 'MATH-18')));
    expect(window.location.hash).toBe('');
  });

  it('signed out, a #m= stays in the address bar: the sign-in gate keeps it for after sign-in', async () => {
    const hash = `#${planToMirrorHash(otherPlan())}`;
    await open(hash, account([makePlan()]), true);
    expect(window.location.hash).toBe(hash);
    expect(onOldLink).not.toHaveBeenCalled();
  });
});

describe('usePlan: an old #p= share link', () => {
  it('leaves my plans as they are, clears the address bar and says the link no longer opens', async () => {
    const mine = makePlan();
    await open(oldLink(otherPlan()), account([mine]));
    expect(courseIds(api.plan)).toEqual(courseIds(mine));
    expect(api.viewPlan).toBe(api.plan);
    expect(api.plans).toHaveLength(1);
    expect(window.location.hash).toBe('');
    expect(onOldLink).toHaveBeenCalledTimes(1);
  });

  it('even one that re-encodes a plan I hold, or does not decode at all', async () => {
    const a = makePlan();
    await open(oldLink(a), account([a, otherPlan()], 1));
    expect(api.activePlanId).toBe('p1');
    expect(onOldLink).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    root = null;
    container.remove();
    boot.engine.dispose();

    await open('#p=not-a-plan', account([a]));
    expect(window.location.hash).toBe('');
    expect(onOldLink).toHaveBeenCalledTimes(2);
  });

  it('pasted into a planner tab already open', async () => {
    await open('', account([makePlan()]));
    await act(async () => {
      window.history.replaceState(null, '', `/${oldLink(otherPlan())}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(window.location.hash).toBe('');
    expect(onOldLink).toHaveBeenCalledTimes(1);
    expect(courseIds(api.plan)).toEqual(courseIds(makePlan()));
  });

  it('signed out too: the guest planner drops it', async () => {
    await open(oldLink(otherPlan()), account([makePlan()]), true);
    expect(window.location.hash).toBe('');
    expect(onOldLink).toHaveBeenCalledTimes(1);
    expect(courseIds(api.viewPlan)).toEqual(courseIds(makePlan()));
  });
});
