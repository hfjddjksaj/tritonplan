import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { usePlan } from './usePlan';
import { makePlan } from '../lib/fixtures';
import type { TermsState, TermWorkspace } from '../lib/terms-state';
import { makeTestBoot } from '../test/boot';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof usePlan>;

const CSE = 'CSE-8A|2026|2';

function account(booked: Partial<TermWorkspace>): TermsState {
  const plan = makePlan();
  return {
    version: 1,
    activeTermKey: '2026|2',
    terms: {
      '2026|2': {
        term: plan.term,
        plans: { activeId: 'p', plans: [{ id: 'p', name: 'Plan', plan, createdAt: 'c', updatedAt: 'u', browsed: [] }] },
        ...booked,
      },
    },
  };
}

/*
 * The enrolled toggle hides once TSS has reported a course. That report is saved
 * with the term (`bookedAuto`), so it must count before — or without — a push from
 * the extension in this session: on a phone, with the extension switched off after
 * an update, or right after moving from the old site.
 */
describe('usePlan: what TSS reported as enrolled', () => {
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

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    boot.engine.dispose();
  });

  it("counts the term's saved TSS report with no push this session", async () => {
    await open(account({ bookedAuto: [CSE] }));
    expect(api.bookedIds.has(CSE)).toBe(true);
    expect(api.tssBookedIds.has(CSE)).toBe(true);
  });

  it('does not count a course the student only marked by hand', async () => {
    await open(account({ bookedOn: [CSE] }));
    expect(api.bookedIds.has(CSE)).toBe(true);
    expect(api.tssBookedIds.has(CSE)).toBe(false);
  });
});
