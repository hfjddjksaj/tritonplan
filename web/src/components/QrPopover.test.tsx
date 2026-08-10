/**
 * Guards the sizing invariant `QrPopover.tsx` exists for: `sizePx` must scale
 * `viewBoxSize` (code + 4-module quiet zone on each side), not the bare
 * `moduleCount` — that's the exact line the feature originally got wrong, and
 * no pure-helper unit test catches a regression back to the wrong variable.
 * This mounts the real component and reads both numbers off the live DOM.
 */
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QrPopover } from './QrPopover';
import { qrShareForPlan, qrSvg } from '../lib/qr';
import { makePlan } from '../lib/fixtures';

// react-dom/client's createRoot requires this flag outside a testing-library-style
// harness, or `act` warns that the environment isn't configured for it.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

describe('QrPopover sizing (render)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    setViewport(originalInnerWidth, originalInnerHeight);
  });

  it('renders the code at a whole multiple of the viewBox extent, with an 8-module quiet zone', () => {
    setViewport(1440, 900);
    const plan = makePlan();

    act(() => {
      root.render(<QrPopover plan={plan} format="full" onClose={() => {}} />);
    });

    const codeEl = document.querySelector('.qrpop__code') as HTMLElement | null;
    expect(codeEl).not.toBeNull();
    const width = parseFloat(codeEl!.style.width);
    expect(width).toBeGreaterThan(0);

    const svg = codeEl!.querySelector('svg');
    expect(svg).not.toBeNull();
    const viewBox = svg!.getAttribute('viewBox')!;
    const extent = Number(viewBox.trim().split(/\s+/)[2]);
    expect(Number.isFinite(extent)).toBe(true);

    // Independently computed (not derived from `extent`): the same pure
    // helpers the component calls internally, run fresh on the same input.
    const expected = qrSvg(qrShareForPlan(plan, 'full')!.url);

    // The bug this guards against: sizing by moduleCount instead of
    // viewBoxSize. If that regresses, width stops dividing evenly by extent.
    expect(width % extent).toBe(0);
    expect(extent - expected.moduleCount).toBe(8);
  });
});
