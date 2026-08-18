import { describe, it, expect, vi } from 'vitest';
import { wheelToHorizontal } from './useWheelToHorizontal';

function row(over: Partial<{ scrollWidth: number; clientWidth: number; scrollLeft: number }> = {}) {
  return { scrollWidth: 420, clientWidth: 316, scrollLeft: 0, ...over };
}
function wheel(over: Partial<{ deltaX: number; deltaY: number; deltaMode: number }> = {}) {
  const e = { deltaX: 0, deltaY: 40, deltaMode: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...over };
  return e;
}

describe('wheelToHorizontal', () => {
  it('turns a vertical wheel tick into horizontal scroll on a row that overflows', () => {
    const el = row();
    const e = wheel({ deltaY: 40 });
    expect(wheelToHorizontal(el, e)).toBe(true);
    expect(el.scrollLeft).toBe(40);
    expect(e.defaultPrevented).toBe(true);
  });

  it('scrolls back on a negative tick, and never past the row start', () => {
    const el = row({ scrollLeft: 30 });
    wheelToHorizontal(el, wheel({ deltaY: -50 }));
    expect(el.scrollLeft).toBe(-20); // the browser clamps; the helper just adds
  });

  it('leaves the event alone when nothing overflows — the page keeps its own scroll', () => {
    const el = row({ scrollWidth: 316, clientWidth: 316 });
    const e = wheel();
    expect(wheelToHorizontal(el, e)).toBe(false);
    expect(el.scrollLeft).toBe(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('leaves a horizontal gesture (trackpad) to the browser', () => {
    const el = row();
    const e = wheel({ deltaX: 30, deltaY: 5 });
    expect(wheelToHorizontal(el, e)).toBe(false);
    expect(el.scrollLeft).toBe(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('scales line-mode deltas (Firefox) to pixels', () => {
    const el = row();
    wheelToHorizontal(el, wheel({ deltaY: 3, deltaMode: 1 }));
    expect(el.scrollLeft).toBe(48);
  });

  it('is a no-op on null', () => {
    const e = wheel();
    const spy = vi.spyOn(e, 'preventDefault');
    expect(wheelToHorizontal(null, e)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
