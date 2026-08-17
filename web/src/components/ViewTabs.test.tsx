import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ViewTabs } from './ViewTabs';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ViewTabs', () => {
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

  function render(props: Partial<Parameters<typeof ViewTabs>[0]> = {}) {
    const onChange = vi.fn();
    act(() => {
      root.render(<ViewTabs value="calendar" onChange={onChange} {...props} />);
    });
    return onChange;
  }
  const tabs = () => [...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];

  it('renders the three planner views as tabs and reports a click', () => {
    const onChange = render();
    expect(tabs().map((t) => t.textContent)).toEqual(['Calendar', 'Midterms', 'Finals']);
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    act(() => tabs()[2]!.click());
    expect(onChange).toHaveBeenCalledWith('finals');
  });

  it('marks the current view active', () => {
    render({ value: 'midterms' });
    expect(tabs()[1]!.classList.contains('tab--active')).toBe(true);
    expect(tabs()[0]!.classList.contains('tab--active')).toBe(false);
  });

  it('lets the first tab be called something else — the map says Classes', () => {
    render({ calendarLabel: 'Classes' });
    expect(tabs()[0]!.textContent).toBe('Classes');
  });

  it('renders views that are not available yet as disabled, and ignores clicks on them', () => {
    const onChange = render({ disabled: ['midterms', 'finals'] });
    expect(tabs()[1]!.disabled).toBe(true);
    expect(tabs()[2]!.disabled).toBe(true);
    expect(tabs()[0]!.disabled).toBe(false);
    act(() => tabs()[1]!.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the finals conflict badge only when there is something to count', () => {
    render({ finalsBadge: 2 });
    expect(container.querySelector('.tab__badge')!.textContent).toBe('2');
    render({ finalsBadge: 0 });
    expect(container.querySelector('.tab__badge')).toBeNull();
  });
});
