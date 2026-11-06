import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TermOpenBanner } from './TermOpenBanner';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('TermOpenBanner', () => {
  it('says the term is open and creates it on click', () => {
    const onCreate = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <TermOpenBanner
          term={{ year: '2026', period: '3', label: '' }}
          activeLabel="Fall 2026"
          onCreate={onCreate}
        />,
      );
    });
    expect(container.querySelector('.received__label')?.textContent).toContain('Winter 2026 enrollment is open');
    expect(container.querySelector('.received__text')?.textContent).toBe(
      'Start a Winter plan to add classes from TSS. Your Fall 2026 plan stays as it is.',
    );
    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('Create Winter 2026');
    act(() => button.click());
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
