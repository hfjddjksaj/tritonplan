import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { makeClashPlan } from '../lib/fixtures';
import { sharedController } from '../hooks/sharedController';
import { CoursePanel } from './CoursePanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CoursePanel in a shared plan', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(onSelect = vi.fn()) {
    act(() => root.render(<CoursePanel ctl={sharedController(makeClashPlan(), onSelect)} />));
    return onSelect;
  }
  const card = (code: string) =>
    [...container.querySelectorAll('.course-card')].find((c) => c.querySelector('.course-card__code')?.textContent === code)!;
  const buttons = () => [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());

  it('has no remove button and no enrolled toggle', () => {
    render();
    expect(container.querySelectorAll('.course-card')).toHaveLength(2);
    expect(container.querySelector('.course-card__remove')).toBeNull();
    expect(buttons()).not.toContain('mark enrolled');
  });

  it('switches a section through the controller', () => {
    const onSelect = render();
    const cse = card('CSE-8A');
    act(() => cse.querySelector<HTMLButtonElement>('.picker__toggle')!.click());
    const p002 = [...cse.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.includes('P-002'))!;
    expect(p002.getAttribute('aria-disabled')).toBe('false');
    act(() => p002.click());
    expect(onSelect.mock.calls).toEqual([['CSE-8A|2026|2', 'o2']]);
  });

  it("lists only the plan's courses: no browsed list, no bookings check", () => {
    render();
    expect(container.querySelector('.rail__title')?.textContent).toBe('Courses in this plan');
    expect(container.textContent).not.toContain('Browsed — not yet added');
    expect(buttons()).not.toContain('Check bookings');
    expect(container.textContent).not.toContain('read-only');
  });
});
