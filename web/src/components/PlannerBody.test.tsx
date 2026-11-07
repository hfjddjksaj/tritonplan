import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { makeClashPlan } from '../lib/fixtures';
import { sharedController } from '../hooks/sharedController';
import { PlannerBody } from './PlannerBody';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PlannerBody with a shared plan', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("draws the plan's week and conflicts, and its rail switches sections", () => {
    const onSelect = vi.fn();
    act(() =>
      root.render(
        <PlannerBody ctl={sharedController(makeClashPlan(), onSelect)} campus={null} setCampus={vi.fn()} />,
      ),
    );
    expect(container.querySelectorAll('.course-card')).toHaveLength(2);
    expect(container.querySelectorAll('.cal-canvas .block').length).toBeGreaterThan(0);
    expect(container.querySelector('.toolbar__hint')?.textContent).toMatch(/conflict/);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    const cse = [...container.querySelectorAll('.course-card')].find((c) => c.textContent?.includes('CSE-8A'))!;
    act(() => cse.querySelector<HTMLButtonElement>('.picker__toggle')!.click());
    const p002 = [...cse.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.includes('P-002'))!;
    act(() => p002.click());
    expect(onSelect.mock.calls).toEqual([['CSE-8A|2026|2', 'o2']]);
  });
});
