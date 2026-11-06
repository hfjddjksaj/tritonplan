import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { lockedForGuest, usePlan } from './usePlan';
import { makePlan } from '../lib/fixtures';
import { emptyPlan } from '../lib/plan';
import type { TermsState, TermWorkspace } from '../lib/terms-state';
import { termOf } from '../lib/terms';
import { makeTestBoot } from '../test/boot';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof usePlan>;

const FALL = termOf('2026', '2');
const WINTER = termOf('2026', '3');

function named(plan: ReturnType<typeof makePlan>) {
  return { id: 'p', name: 'Plan', plan, createdAt: 'c', updatedAt: 'u', browsed: [] };
}
function fallWithCourses(): TermWorkspace {
  return { term: FALL, plans: { activeId: 'p', plans: [named(makePlan())] } };
}
function winterWithCourses(): TermWorkspace {
  const plan = { ...makePlan(), term: WINTER };
  return { term: WINTER, plans: { activeId: 'w', plans: [{ ...named(plan), id: 'w' }] } };
}
function emptyFall(): TermWorkspace {
  return { term: FALL, plans: { activeId: 'p', plans: [named(emptyPlan(FALL))] } };
}
function account(...wss: TermWorkspace[]): TermsState {
  return {
    version: 1,
    activeTermKey: '2026|2',
    terms: Object.fromEntries(wss.map((ws) => [`${ws.term.year}|${ws.term.period}`, ws])),
  };
}

describe('usePlan: default term and creating the upcoming one', () => {
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

  it('Fall with courses, no Winter: opens on Fall, upcomingTerm is Winter 2026, no Winter workspace', async () => {
    await open(account(fallWithCourses()));
    expect(api.activeTermKey).toBe('2026|2');
    expect(api.upcomingTerm).toEqual(WINTER);
    expect(Object.keys(api.termsState.terms)).toEqual(['2026|2']);
  });

  it('Fall and Winter both with courses: opens on Winter', async () => {
    await open(account(fallWithCourses(), winterWithCourses()));
    expect(api.activeTermKey).toBe('2026|3');
  });

  it('Fall without courses: Winter is created and shown; the first sent batch carries putTerm 2026|3', async () => {
    await open(account(emptyFall()));
    expect(api.activeTermKey).toBe('2026|3');
    expect(api.termsState.terms['2026|3']).toBeDefined();
    await act(async () => {
      await boot.engine.flush();
    });
    const ops = boot.sent[0] ?? [];
    expect(ops.some((o) => o.op === 'putTerm' && o.termKey === '2026|3')).toBe(true);
  });

  it('empty archived Fall only, 2027-01-10: only Winter remains', async () => {
    vi.setSystemTime(new Date('2027-01-10T20:00:00Z'));
    await open(account(emptyFall()));
    expect(Object.keys(api.termsState.terms)).toEqual(['2026|3']);
    expect(api.activeTermKey).toBe('2026|3');
  });

  it('createTerm(Winter) adds the workspace and switches to it; the default on a re-open stays Fall', async () => {
    await open(account(fallWithCourses()));
    act(() => api.createTerm(WINTER));
    expect(api.activeTermKey).toBe('2026|3');
    expect(Object.keys(api.termsState.terms).sort()).toEqual(['2026|2', '2026|3']);
    const after = api.termsState;
    close();
    await open(after);
    expect(api.activeTermKey).toBe('2026|2');
  });

  it("a guest controller's createTerm is the sign-in ask", async () => {
    await open(account(fallWithCourses()));
    const ask = vi.fn();
    const locked = lockedForGuest(api, ask);
    locked.createTerm(WINTER);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(Object.keys(api.termsState.terms)).toEqual(['2026|2']);
  });
});
