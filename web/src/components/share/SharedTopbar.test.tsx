import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Term } from '@triton/shared';
import { SharedTopbar } from './SharedTopbar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
const FA: Term = { year: '2026', period: '2', label: 'Fall 2026' };

let container: HTMLDivElement;
let root: Root;
const onOpenMap = vi.fn();
const onCopyLink = vi.fn();
const onSave = vi.fn();

function render(expiresInMs: number, units = 16) {
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  act(() =>
    root.render(
      <SharedTopbar term={FA} units={units} expiresAt={expiresAt} onOpenMap={onOpenMap} onCopyLink={onCopyLink} onSave={onSave} />,
    ),
  );
}
const labelled = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

beforeEach(() => {
  vi.resetAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SharedTopbar', () => {
  it('reads "⇄ Shared plan", the term, how long it stays live, and the units', () => {
    render(6 * DAY - 60_000);
    const bar = container.querySelector('header.topbar--shared')!;
    expect(bar.querySelector('.sharedbar__brand svg')).not.toBeNull();
    expect(bar.querySelector('.sharedbar__brand')?.textContent).toBe('Shared plan');
    expect(bar.textContent).toContain('Fall 2026');
    expect(bar.textContent).toContain('Live · expires in 6 days');
    expect(bar.querySelector('.unit-pill')?.textContent).toBe('16units');
  });

  it('rounds part of a day up, and under a day says today', () => {
    render(DAY + 60_000);
    expect(container.textContent).toContain('expires in 2 days');
    render(DAY - 60_000);
    expect(container.textContent).toContain('Live · expires today');
  });

  it('each button keeps its name when a phone shows only its icon, and does its one thing', () => {
    render(6 * DAY);
    act(() => labelled('Map')!.click());
    act(() => labelled('Copy link')!.click());
    act(() => labelled('Save to my plans')!.click());
    expect(onOpenMap).toHaveBeenCalledTimes(1);
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
