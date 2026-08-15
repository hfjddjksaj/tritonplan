import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanState } from '@triton/shared';
import { makePlan } from '../lib/fixtures';
import { CampusMap } from './CampusMap';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Let the dynamic geo import and its promise settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('CampusMap', () => {
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

  function render(over: Partial<Parameters<typeof CampusMap>[0]> = {}) {
    const plan: PlanState = makePlan();
    const onClose = vi.fn();
    act(() => {
      root.render(
        <CampusMap
          plan={plan} booked={new Set()} hasBookedData={true}
          readOnly={false} onClose={onClose} {...over}
        />,
      );
    });
    return onClose;
  }

  it('renders a titled dialog with a close button', async () => {
    const onClose = render();
    await settle();
    expect(container.querySelector('.campusmap')).not.toBeNull();
    const close = container.querySelector('.campusmap__close') as HTMLButtonElement;
    expect(close).not.toBeNull();
    act(() => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const onClose = render();
    await settle();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the booked-only toggle for your own plan', async () => {
    render();
    await settle();
    expect(container.querySelector('.campusmap__bookedtoggle')).not.toBeNull();
  });

  it('HIDES the booked-only toggle on someone else’s plan', async () => {
    render({ readOnly: true });
    await settle();
    expect(container.querySelector('.campusmap__bookedtoggle')).toBeNull();
  });

  it('hides the toggle when no booked data has ever been captured', async () => {
    render({ hasBookedData: false });
    await settle();
    expect(container.querySelector('.campusmap__bookedtoggle')).toBeNull();
    expect(container.textContent).toContain('Booked Courses');
  });

  it('shows an empty state for a plan with no locatable classes', async () => {
    render();
    await settle();
    // makePlan()'s course has no components, so nothing can be placed.
    expect(container.querySelector('.campusmap__empty')).not.toBeNull();
  });
});
