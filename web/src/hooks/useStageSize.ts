import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

export interface StageSize {
  w: number;
  h: number;
}

/** Narrowest / shortest canvas still worth drawing: a chip row plus the zoom buttons. */
export const MIN_STAGE_W = 280;
export const MIN_STAGE_H = 360;

/** Clamp a measured box to the smallest canvas the map can still lay out. */
export function stageSizeFor(width: number, height: number): StageSize {
  return {
    w: Math.round(Math.max(MIN_STAGE_W, width)),
    h: Math.round(Math.max(MIN_STAGE_H, height)),
  };
}

// Under jsdom nothing has layout; these are the sizes the tests were written for.
const FALLBACK: StageSize = { w: 1100, h: 760 };

// SSR-safe layout effect: measure before paint in the browser, no-op on the server.
const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The size the map canvas should draw at: the stage element's own box, edge to
 * edge — the map IS the page. Re-measures on resize, so a rotated phone or a
 * resized window refits — and every consumer of the size (viewport, on/off-canvas
 * split, label placement) follows.
 */
export function useStageSize(ref: RefObject<HTMLElement | null>): StageSize {
  const [size, setSize] = useState<StageSize>(FALLBACK);
  useIso(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return; // not laid out yet — keep whatever we had
      const next = stageSizeFor(r.width, r.height);
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);
  return size;
}

/**
 * The rendered height of an element (the floating header), for laying the map
 * out around it. `fallback` is used until it has layout — and forever under jsdom.
 *
 * `discount` takes part of the element back out — read in the SAME measurement
 * as the element itself, so the two can never be a frame apart. Measured
 * separately, one would land first and the difference would flicker through a
 * wrong value on its way to the right one. Must be a stable function.
 */
export function useElementHeight(
  ref: RefObject<HTMLElement | null>,
  fallback: number,
  discount?: (el: HTMLElement) => number,
): number {
  const [h, setH] = useState(fallback);
  useIso(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const height = el.getBoundingClientRect().height - (discount?.(el) ?? 0);
      if (height <= 0) return;
      setH((prev) => (Math.abs(prev - height) < 0.5 ? prev : Math.round(height)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, discount]);
  return h;
}
