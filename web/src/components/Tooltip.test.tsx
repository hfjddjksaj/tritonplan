import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { tip, TooltipLayer, tooltipPosition, TIP_DELAY } from './Tooltip';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('tooltipPosition', () => {
  const size = { width: 100, height: 30 };
  const viewport = { width: 1000, height: 800 };

  it('sits above the trigger, centred on it', () => {
    const at = tooltipPosition({ top: 400, bottom: 420, left: 300, width: 40 }, size, viewport);
    expect(at.placement).toBe('above');
    expect(at.top).toBe(400 - 30 - 6);
    expect(at.left).toBe(300 + 20 - 50);
  });

  it('flips below when there is no room above', () => {
    const at = tooltipPosition({ top: 10, bottom: 30, left: 300, width: 40 }, size, viewport);
    expect(at.placement).toBe('below');
    expect(at.top).toBe(30 + 6);
  });

  it('clamps to the viewport rather than running off the edge', () => {
    expect(tooltipPosition({ top: 400, bottom: 420, left: 2, width: 20 }, size, viewport).left).toBe(6);
    expect(tooltipPosition({ top: 400, bottom: 420, left: 990, width: 20 }, size, viewport).left).toBe(
      1000 - 100 - 6,
    );
  });

  it('would rather overflow the bottom than cover a trigger at the very top', () => {
    // Nothing fits: a 700px-tall viewport with the trigger at y=2. Below still
    // leaves the trigger readable, which is the whole point of a tooltip.
    const at = tooltipPosition({ top: 2, bottom: 20, left: 300, width: 40 }, size, { width: 1000, height: 40 });
    expect(at.placement).toBe('below');
  });
});

describe('tip()', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<TooltipLayer />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const shown = () => document.querySelector('[role="tooltip"]');

  /** jsdom ships no PointerEvent; React reads `pointerType` off the native event,
   *  so a MouseEvent carrying that one field is indistinguishable to the code. */
  function pointer(type: string, pointerType: string) {
    const e = new MouseEvent(type, { bubbles: true });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    return e;
  }

  /** A trigger carrying tip() handlers, plus the fake pointer events to drive it. */
  function trigger(text: string | undefined) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    act(() => r.render(<button {...tip(text)}>hover me</button>));
    const btn = host.querySelector('button')!;
    return {
      btn,
      enter: (pointerType = 'mouse') =>
        act(() => {
          btn.dispatchEvent(pointer('pointerover', pointerType));
        }),
      leave: () =>
        act(() => {
          btn.dispatchEvent(pointer('pointerout', 'mouse'));
        }),
      cleanup: () => {
        act(() => r.unmount());
        host.remove();
      },
    };
  }

  it('nothing to say, nothing attached', () => {
    expect(tip(undefined)).toEqual({});
    expect(tip('')).toEqual({});
  });

  it('waits before showing, the way a tooltip should', () => {
    const t = trigger('Remove CHEM-043A');
    t.enter();
    expect(shown()).toBeNull();
    act(() => void vi.advanceTimersByTime(TIP_DELAY - 1));
    expect(shown()).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(shown()?.textContent).toBe('Remove CHEM-043A');
    t.cleanup();
  });

  it('leaves instantly, with no lingering timer to fire later', () => {
    const t = trigger('Remove CHEM-043A');
    t.enter();
    t.leave();
    act(() => void vi.advanceTimersByTime(TIP_DELAY * 3));
    expect(shown()).toBeNull();
    t.cleanup();
  });

  it('says nothing to a finger', () => {
    // Native `title` never appeared on touch either, and a long-press tooltip
    // fights scrolling and text selection for a control that is already visible.
    const t = trigger('Remove CHEM-043A');
    t.enter('touch');
    act(() => void vi.advanceTimersByTime(TIP_DELAY * 3));
    expect(shown()).toBeNull();
    t.cleanup();
  });

  it('Escape dismisses it', () => {
    const t = trigger('Remove CHEM-043A');
    t.enter();
    act(() => void vi.advanceTimersByTime(TIP_DELAY));
    expect(shown()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(shown()).toBeNull();
    t.cleanup();
  });

  it('a second trigger takes over without waiting again', () => {
    // Once one tooltip is up, sliding along a row of buttons should read as one
    // tooltip following the cursor, not four separate waits.
    const a = trigger('first');
    const b = trigger('second');
    a.enter();
    act(() => void vi.advanceTimersByTime(TIP_DELAY));
    expect(shown()?.textContent).toBe('first');
    a.leave();
    b.enter();
    expect(shown()?.textContent).toBe('second');
    a.cleanup();
    b.cleanup();
  });

  it('keeps line breaks the caller wrote', () => {
    const t = trigger('CSE-008A · Lecture\nMon 10:00');
    t.enter();
    act(() => void vi.advanceTimersByTime(TIP_DELAY));
    expect(shown()?.textContent).toBe('CSE-008A · Lecture\nMon 10:00');
    expect(getComputedStyle(shown() as Element).whiteSpace).toBe('pre-line');
    t.cleanup();
  });

  it('never leaves a native bubble behind to double up', () => {
    const t = trigger('Remove CHEM-043A');
    expect(t.btn.getAttribute('title')).toBeNull();
    t.cleanup();
  });
});
