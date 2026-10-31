import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SyncEngine, SyncStatus } from '../lib/cloud/engine';
import { nav } from '../lib/nav';
import { SyncBanner } from './SyncBanner';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let status: SyncStatus;
const subs = new Set<() => void>();
const engine = {
  status: () => status,
  subscribe: (fn: () => void) => {
    subs.add(fn);
    return () => subs.delete(fn);
  },
} as unknown as SyncEngine;

beforeEach(() => {
  subs.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function show(s: SyncStatus) {
  status = s;
  await act(async () => root.render(<SyncBanner engine={engine} />));
}

describe('SyncBanner', () => {
  it.each<SyncStatus>(['idle', 'saving'])('renders nothing while %s', async (s) => {
    await show(s);
    expect(container.textContent).toBe('');
  });

  it('offline: a polite status with no button', async () => {
    await show('offline');
    const el = container.querySelector('[role="status"]')!;
    expect(el.textContent).toBe("Can't reach TritonPlan. Your latest changes will save when you're back online.");
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows the conflict message with a Reload button that reloads', async () => {
    const reload = vi.spyOn(nav, 'reload').mockImplementation(() => {});
    await show('conflict');
    const el = container.querySelector('[role="alert"]')!;
    expect(el.textContent).toContain(
      "This plan changed on another device. Reload to get the latest — changes made here since then weren't saved.",
    );
    const btn = container.querySelector('button')!;
    expect(btn.textContent).toBe('Reload');
    act(() => btn.click());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('signed-out: Sign in reloads', async () => {
    const reload = vi.spyOn(nav, 'reload').mockImplementation(() => {});
    await show('signed-out');
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "You've been signed out. Sign in again to keep saving.",
    );
    const btn = container.querySelector('button')!;
    expect(btn.textContent).toBe('Sign in');
    act(() => btn.click());
    expect(reload).toHaveBeenCalled();
  });

  it('error: save failed with Reload', async () => {
    await show('error');
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("Couldn't save your latest change.");
    expect(container.querySelector('button')!.textContent).toBe('Reload');
  });

  it('follows the engine as the status changes', async () => {
    await show('idle');
    status = 'offline';
    await act(async () => subs.forEach((f) => f()));
    expect(container.textContent).toContain("Can't reach TritonPlan");
  });
});
