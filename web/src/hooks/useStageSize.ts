import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

export interface StageSize {
  w: number;
  h: number;
}

/** Widest canvas worth drawing: past this the bundled roads run out at the edges. */
export const MAX_STAGE_W = 1300;
/** Narrowest canvas that still fits a chip row and the zoom buttons. */
const MIN_STAGE_W = 280;

/**
 * Height for a stage of width `w` in a window of height `vh`: as tall as the
 * overlay leaves room for, within a band that keeps the map map-shaped.
 * Portrait phones get a portrait canvas (the teaching core is ~2.4 km tall
 * and ~1.4 km wide); wide windows get a landscape one no taller than 900.
 */
export function stageHeightFor(w: number, vh: number): number {
  const room = vh - 190; // topbar, hint line, paddings, a strip of the list below
  if (w < 500) return Math.round(Math.max(420, Math.min(w * 1.55, room)));
  return Math.round(Math.max(480, Math.min(900, room)));
}

// Under jsdom nothing has layout; these are the sizes the tests were written for.
const FALLBACK: StageSize = { w: 1100, h: 760 };

/**
 * The size the map canvas should draw at: the stage element's current width
 * (capped) by a height fitted to the window. Re-measures on resize, so a
 * rotated phone or a resized window refits — and every consumer of the size
 * (viewport, on/off-canvas split, label placement) follows.
 */
export function useStageSize(ref: RefObject<HTMLElement | null>): StageSize {
  const [size, setSize] = useState<StageSize>(FALLBACK);
  const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;
  useIso(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const width = el.getBoundingClientRect().width;
      if (width <= 0) return; // not laid out yet — keep whatever we had
      // −2 for the frame's 1 px border each side, so the SVG renders at exactly 1:1.
      const w = Math.round(Math.max(MIN_STAGE_W, Math.min(MAX_STAGE_W, width - 2)));
      const h = stageHeightFor(w, window.innerHeight);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
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
