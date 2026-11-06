import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanState } from '@triton/shared';
import { useSharedPlan, type SharedPlan } from './useSharedPlan';
import * as api from '../lib/cloud/api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/cloud/api', () => ({
  fetchSharedPlan: vi.fn(),
  fetchSharedVersion: vi.fn(),
  selectSharedOption: vi.fn(),
}));
const fetchPlan = vi.mocked(api.fetchSharedPlan);
const fetchVersion = vi.mocked(api.fetchSharedVersion);
const postSelect = vi.mocked(api.selectSharedOption);

const planWith = (sel: string): PlanState => ({
  version: 1,
  term: { year: 2026, session: 'FA' },
  entries: [{ course: { id: 'c1', options: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, selectedOptionId: sel }],
} as unknown as PlanState);
const doc = (sel: string, version: number) => ({ name: 'P', plan: planWith(sel), version, expiresAt: '2026-11-13T00:00:00Z' });
const selected = (h: SharedPlan) => (h.status.kind === 'ready' ? h.status.plan.entries[0].selectedOptionId : h.status.kind);

describe('useSharedPlan', () => {
  let container: HTMLDivElement;
  let root: Root;
  let hook: SharedPlan;
  let code = 'abc';

  function Probe() {
    hook = useSharedPlan(code, { pollMs: 1000 });
    return null;
  }
  const mount = () => act(async () => root.render(<Probe />));
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const setVisibility = (v: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    code = 'abc';
    setVisibility('visible');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('loads loading -> ready', async () => {
    fetchPlan.mockResolvedValue(doc('a', 1));
    await mount();
    expect(selected(hook)).toBe('a');
    expect(hook.status).toMatchObject({ kind: 'ready', version: 1, name: 'P' });
  });

  it('does not refetch when the polled version is unchanged', async () => {
    fetchPlan.mockResolvedValue(doc('a', 1));
    fetchVersion.mockResolvedValue(1);
    await mount();
    await tick(3000);
    expect(fetchVersion).toHaveBeenCalledTimes(3);
    expect(fetchPlan).toHaveBeenCalledTimes(1);
  });

  it('refetches when a poll sees a higher version', async () => {
    fetchPlan.mockResolvedValueOnce(doc('a', 1)).mockResolvedValueOnce(doc('c', 2));
    fetchVersion.mockResolvedValue(2);
    await mount();
    await tick(1000);
    expect(selected(hook)).toBe('c');
  });

  it('adopts server state after a newer version', async () => {
    fetchPlan.mockResolvedValueOnce(doc('a', 1)).mockResolvedValueOnce(doc('c', 3));
    fetchVersion.mockResolvedValue(3);
    postSelect.mockResolvedValue(3); // someone else wrote version 2 in between
    await mount();
    await act(async () => hook.select('c1', 'b'));
    await tick(1000);
    expect(selected(hook)).toBe('c');
    expect(hook.status).toMatchObject({ version: 3 });
  });

  it('keeps an optimistic select while its POST is in flight, then adopts the returned version', async () => {
    fetchPlan.mockResolvedValue(doc('a', 1));
    fetchVersion.mockResolvedValue(1);
    let answer: (v: number) => void = () => {};
    postSelect.mockReturnValue(new Promise((r) => { answer = r; }));
    await mount();
    await act(async () => hook.select('c1', 'b'));
    expect(selected(hook)).toBe('b');
    await tick(2000);
    expect(selected(hook)).toBe('b');
    await act(async () => answer(2));
    expect(selected(hook)).toBe('b');
    expect(hook.status).toMatchObject({ version: 2 });
    expect(fetchPlan).toHaveBeenCalledTimes(1);
  });

  it('switches to gone on 404 from poll', async () => {
    fetchPlan.mockResolvedValue(doc('a', 1));
    fetchVersion.mockResolvedValue('not-found');
    await mount();
    await tick(1000);
    expect(hook.status.kind).toBe('gone');
    fetchVersion.mockClear();
    await tick(3000);
    expect(fetchVersion).not.toHaveBeenCalled();
  });

  it('switches to gone on 404 from select', async () => {
    fetchPlan.mockResolvedValue(doc('a', 1));
    postSelect.mockResolvedValue('not-found');
    await mount();
    await act(async () => hook.select('c1', 'b'));
    expect(hook.status.kind).toBe('gone');
  });

  it('does not poll while hidden and polls at once when visible again', async () => {
    fetchPlan.mockResolvedValue(doc('a', 1));
    fetchVersion.mockResolvedValue(1);
    await mount();
    setVisibility('hidden');
    await tick(3000);
    expect(fetchVersion).not.toHaveBeenCalled();
    setVisibility('visible');
    await tick(0);
    expect(fetchVersion).toHaveBeenCalledTimes(1);
  });

  it('reverts a failed select to the server plan', async () => {
    fetchPlan.mockResolvedValue(doc('a', 1));
    fetchVersion.mockResolvedValue(1);
    postSelect.mockResolvedValue(null);
    await mount();
    await act(async () => hook.select('c1', 'b'));
    expect(selected(hook)).toBe('a');
    expect(fetchPlan).toHaveBeenCalledTimes(2);
  });

  it('ignores a transient null poll and keeps polling', async () => {
    fetchPlan.mockResolvedValue(doc('a', 1));
    fetchVersion.mockResolvedValueOnce(null).mockResolvedValue(1);
    await mount();
    await tick(2000);
    expect(hook.status.kind).toBe('ready');
    expect(fetchVersion).toHaveBeenCalledTimes(2);
  });

  it('is offline when the first load fails, and retry reloads', async () => {
    fetchPlan.mockResolvedValueOnce(null).mockResolvedValue(doc('a', 1));
    await mount();
    expect(hook.status.kind).toBe('offline');
    await act(async () => hook.retry());
    expect(selected(hook)).toBe('a');
  });

  it('skips a poll while the previous one is still in flight', async () => {
    fetchPlan.mockResolvedValue(doc('a', 1));
    fetchVersion.mockReturnValue(new Promise(() => {}));
    await mount();
    await tick(5000);
    expect(fetchVersion).toHaveBeenCalledTimes(1);
  });

  it('ignores a load that lands after the code changed', async () => {
    let late: (d: ReturnType<typeof doc>) => void = () => {};
    fetchPlan
      .mockReturnValueOnce(new Promise((r) => { late = r; }))
      .mockResolvedValueOnce(doc('c', 1));
    await mount();
    code = 'xyz';
    await mount();
    expect(selected(hook)).toBe('c');
    await act(async () => late(doc('a', 9)));
    expect(selected(hook)).toBe('c');
  });

  it('ignores a poll that lands after unmount', async () => {
    fetchPlan.mockResolvedValue(doc('a', 1));
    let late: (v: number) => void = () => {};
    fetchVersion.mockReturnValue(new Promise((r) => { late = r; }));
    await mount();
    await tick(1000);
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => late(5));
    expect(fetchPlan).toHaveBeenCalledTimes(1);
  });
});
