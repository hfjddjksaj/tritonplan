/**
 * `useElementHeight` against a hand-driven ResizeObserver: jsdom has none, and
 * lays nothing out, so each box's height is stubbed and the observer is fired
 * by hand — the two things a real browser does when the island grows.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useElementHeight } from './useStageSize';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const observers: (() => void)[] = [];
class FakeResizeObserver {
  constructor(private cb: () => void) {}
  observe() {
    observers.push(this.cb);
  }
  disconnect() {}
}

/** Give an element a fixed layout height, the way the browser would report it. */
function sized(el: Element, h: () => number) {
  el.getBoundingClientRect = () => ({ height: h() }) as DOMRect;
}

let seen: number[] = [];
function Probe({ discount }: { discount?: (el: HTMLElement) => number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  seen.push(useElementHeight(ref, 100, discount));
  return (
    <div ref={ref} className="island">
      <div className="extra" />
    </div>
  );
}

describe('useElementHeight', () => {
  let container: HTMLDivElement;
  let root: Root;
  let islandH = 120;
  let extraH = 0;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    observers.length = 0;
    seen = [];
    islandH = 120;
    extraH = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // Stub layout before React's layout effect measures for the first time.
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, o?: ElementCreationOptions) => {
      const el = orig(tag, o);
      queueMicrotask(() => {
        if (el.classList.contains('island')) sized(el, () => islandH);
        if (el.classList.contains('extra')) sized(el, () => extraH);
      });
      return el;
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const grow = (island: number, extra: number) => {
    islandH = island;
    extraH = extra;
    act(() => observers.forEach((fire) => fire()));
  };

  it('follows the element as it resizes', async () => {
    await act(async () => root.render(<Probe />));
    grow(120, 0);
    expect(seen.at(-1)).toBe(120);
    grow(350, 230);
    expect(seen.at(-1)).toBe(350);
  });

  it('leaves out what the discount names, read in the same measurement', async () => {
    const discount = (el: HTMLElement) => el.querySelector('.extra')!.getBoundingClientRect().height;
    await act(async () => root.render(<Probe discount={discount} />));
    grow(120, 0);
    expect(seen.at(-1)).toBe(120);
    // The island grows by exactly what the discounted part added: no render
    // sees any other value, so the map's home fit (memoised on the number)
    // never gets a new one — not even for a frame.
    const from = seen.length;
    grow(350, 230);
    expect(seen.slice(from).every((h) => h === 120)).toBe(true);
    grow(120, 0);
    expect(seen.at(-1)).toBe(120);
  });
});
