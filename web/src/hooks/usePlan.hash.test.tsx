import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanState } from '@triton/shared';
import { usePlan } from './usePlan';
import { makeCourse, makePlan } from '../lib/fixtures';
import { planToMirrorHash } from '../lib/share';
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

/*
 * The URL is the plan. A bookmark carrying #m=<plan> opened where the account
 * holds other plans used to show the active plan and then overwrite the
 * address bar with it — the bookmarked plan was lost.
 */
describe('usePlan: opening a #m= mirror hash', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let api: Api;
  let boot: ReturnType<typeof makeTestBoot>;

  function Probe() {
    api = usePlan(boot);
    return null;
  }

  async function open(hash: string, terms: TermsState) {
    window.history.replaceState(null, '', `/${hash}`);
    boot = makeTestBoot({ terms });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(<Probe />));
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    boot.engine.dispose();
    window.history.replaceState(null, '', '/');
  });

  it("opens another device's plan instead of the account's own (iPad bookmark repro)", async () => {
    const ipadPlan = makePlan();
    const laptopPlan = otherPlan();
    await open(`#${planToMirrorHash(laptopPlan)}`, account([ipadPlan])); // the bookmark from the laptop
    expect(api.viewing).toBe('received');
    expect(courseIds(api.viewPlan)).toEqual(courseIds(laptopPlan));
    expect(courseIds(api.plan)).toEqual(courseIds(ipadPlan)); // own plan untouched
  });

  it('switches to the bookmarked plan when the account holds it but another is active', async () => {
    const a = makePlan();
    const b = otherPlan();
    await open(`#${planToMirrorHash(a)}`, account([a, b], 1));
    expect(api.viewing).toBe('mine');
    expect(api.received).toBeNull();
    expect(courseIds(api.plan)).toEqual(courseIds(a));
  });
});
