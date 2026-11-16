import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { lockedForGuest, usePlan } from './usePlan';
import { makeCourse } from '../lib/fixtures';
import { entryHue } from '../lib/plan';
import type { TermsState } from '../lib/terms-state';
import { termOf } from '../lib/terms';
import { makeTestBoot } from '../test/boot';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof usePlan>;

const FALL = termOf('2026', '2');
const A = 'CSE-1|2026|2';
const B = 'CSE-2|2026|2';
const C = 'CSE-3|2026|2';

function account(): TermsState {
  const plan = {
    version: 1 as const,
    term: FALL,
    entries: [
      { course: makeCourse(A, 'CSE 1'), selectedOptionId: null, color: '340' },
      { course: makeCourse(B, 'CSE 2'), selectedOptionId: null },
      { course: makeCourse(C, 'CSE 3'), selectedOptionId: null },
    ],
  };
  const named = { id: 'p', name: 'Plan', plan, createdAt: 'c', updatedAt: 'u', browsed: [] };
  return {
    version: 1,
    activeTermKey: '2026|2',
    terms: { '2026|2': { term: FALL, plans: { activeId: 'p', plans: [named] } } },
  };
}

describe('usePlan: reorderCourse', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let api: Api;
  let boot: ReturnType<typeof makeTestBoot>;

  function Probe() {
    api = usePlan(boot);
    return null;
  }

  async function open(terms: TermsState) {
    boot = makeTestBoot({ terms });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(<Probe />));
  }
  function close() {
    act(() => root?.unmount());
    root = null;
    container.remove();
    boot.engine.dispose();
  }

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T20:00:00Z'));
  });
  afterEach(() => {
    if (root) close();
    vi.useRealTimers();
  });

  it('moves a course and keeps every course on its hue', async () => {
    await open(account());
    const before = new Map(api.viewPlan.entries.map((e) => [e.course.id, entryHue(api.viewPlan, e)]));
    act(() => api.reorderCourse(C, 0));
    expect(api.viewPlan.entries.map((e) => e.course.id)).toEqual([C, A, B]);
    for (const e of api.viewPlan.entries) expect(entryHue(api.viewPlan, e)).toBe(before.get(e.course.id));
  });

  it('asks a signed-out visitor to sign in instead', async () => {
    await open(account());
    const ask = vi.fn();
    lockedForGuest(api, ask).reorderCourse(C, 0);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(api.viewPlan.entries.map((e) => e.course.id)).toEqual([A, B, C]);
  });
});
