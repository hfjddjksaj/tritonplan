import { useCallback, useRef } from 'react';

/** The bit of a scroll container this helper reads and moves. */
export interface ScrollRow {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
}

/** The bit of a WheelEvent this helper reads. */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  preventDefault(): void;
}

/**
 * Turn a vertical wheel tick into horizontal scroll on a row that overflows
 * sideways. Browsers only scroll such a row on shift+wheel or a sideways
 * trackpad gesture; with the scrollbar hidden a mouse user has no way in at all.
 * Returns whether the event was consumed. Leaves horizontal gestures and
 * non-overflowing rows to the browser.
 */
export function wheelToHorizontal(el: ScrollRow | null, e: WheelLike): boolean {
  if (!el || el.scrollWidth <= el.clientWidth) return false;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return false;
  e.preventDefault();
  el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  return true;
}

/**
 * A callback ref that makes the element scroll sideways on a vertical wheel.
 * A native, non-passive listener: React registers wheel handlers passively, so
 * preventDefault() (to stop the page taking the tick) has to go this way. Works
 * for an element that mounts and unmounts (the listener follows the node).
 */
export function useWheelToHorizontal<T extends HTMLElement>(): (el: T | null) => void {
  const detach = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    detach.current?.();
    detach.current = null;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      wheelToHorizontal(el, e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    detach.current = () => el.removeEventListener('wheel', onWheel);
  }, []);
}
