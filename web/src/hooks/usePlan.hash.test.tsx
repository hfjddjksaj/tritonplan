import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanState } from '@triton/shared';
import { usePlan } from './usePlan';
import { makeCourse, makePlan } from '../lib/fixtures';
import { planToMirrorHash } from '../lib/share';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof usePlan>;

function otherPlan(): PlanState {
  const course = makeCourse('MATH-18|2026|2', 'MATH-18');
  return { ...makePlan(), entries: [{ course, selectedOptionId: course.options[0]!.id, color: '120' }] };
}

const courseIds = (p: PlanState) => p.entries.map((e) => e.course.id);

/*
 * The URL is the plan. A bookmark carrying #m=<plan> opened on a device that
 * already holds other plans used to show the device's own active plan and then
 * overwrite the address bar with it — the bookmarked plan was lost.
 */
describe('usePlan: opening a #m= mirror hash', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let api: Api;

  function Probe() {
    api = usePlan();
    return null;
  }

  async function boot(hash: string) {
    window.history.replaceState(null, '', `/${hash}`);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(<Probe />));
  }

  function shutdown() {
    act(() => root?.unmount());
    root = null;
    container.remove();
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    if (root) shutdown();
    window.history.replaceState(null, '', '/');
  });

  it("opens another device's plan instead of this device's own (iPad bookmark repro)", async () => {
    const ipadPlan = makePlan();
    await boot(`#${planToMirrorHash(ipadPlan)}`); // this device's earlier test plan
    expect(courseIds(api.plan)).toEqual(courseIds(ipadPlan));
    shutdown();

    const laptopPlan = otherPlan();
    await boot(`#${planToMirrorHash(laptopPlan)}`); // the bookmark from the laptop
    expect(api.viewing).toBe('received');
    expect(courseIds(api.viewPlan)).toEqual(courseIds(laptopPlan));
    expect(courseIds(api.plan)).toEqual(courseIds(ipadPlan)); // own plan untouched
  });

  it('switches to the bookmarked plan when this device holds it but another is active', async () => {
    const a = makePlan();
    await boot(`#${planToMirrorHash(a)}`);
    const b = otherPlan();
    await act(async () => api.createNewPlan());
    await act(async () => api.addCourse(b.entries[0]!.course));
    expect(courseIds(api.plan)).toEqual(courseIds(b));
    shutdown();

    await boot(`#${planToMirrorHash(a)}`);
    expect(api.viewing).toBe('mine');
    expect(api.received).toBeNull();
    expect(courseIds(api.plan)).toEqual(courseIds(a));
  });
});
