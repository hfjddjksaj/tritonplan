/** Rendered with createRoot + act (see DistanceBar.test.tsx). Only `Date` is
 *  faked so React's act keeps working. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Term } from '@triton/shared';
import { TermSwitcher } from './TermSwitcher';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FALL_2026: Term = { year: '2026', period: '2', label: 'Fall 2026' };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T20:00:00Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('TermSwitcher creatable cells', () => {
  it('turns the missing Winter cell into a create button and leaves Spring inert', () => {
    const onCreate = vi.fn();
    act(() =>
      root.render(
        <TermSwitcher
          terms={[FALL_2026]}
          activeKey="2026|2"
          activeLabel="Fall 2026"
          archived={false}
          onSwitch={() => {}}
          onCreate={onCreate}
        />,
      ),
    );
    act(() => container.querySelector<HTMLButtonElement>('.termsw__trigger')!.click());

    const spring = [...container.querySelectorAll('.termsw__cell--placeholder')].find(
      (el) => el.tagName === 'SPAN',
    );
    expect(spring).toBeTruthy();

    const winter = container.querySelector<HTMLButtonElement>(
      'button.termsw__cell--placeholder[title="Create Winter 2026"]',
    );
    expect(winter).toBeTruthy();
    act(() => winter!.click());

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({ year: '2026', period: '3', label: 'Winter 2026' });
    expect(container.querySelector('.termsw__panel')).toBeNull();
  });
});
