/**
 * The planner's own hover bubble, replacing the browser's native `title`.
 *
 * Native `title` was the wrong tool three ways: it renders in the OS chrome, so
 * it is the only thing on the page not set in the planner's own type; its ~1s
 * delay is not adjustable; and it never appears on touch at all. This is the
 * same information in the planner's voice.
 *
 * One layer, one bubble. `tip(text)` returns the handlers to spread where a
 * `title` used to sit — `<button {...tip('Remove CSE-008A')}>` — and a single
 * `<TooltipLayer />` mounted at the app root does the rendering. The layer is a
 * portal onto `document.body` positioned in viewport coordinates, because the
 * cards these live in are `overflow: hidden`: a bubble drawn inside one gets
 * clipped by the card that owns the button.
 *
 * Accessibility: `tip` handles the *visual* affordance only. Where a control's
 * `title` was carrying its accessible name — icon-only buttons — that name
 * belongs in an `aria-label` on the control itself, which is where screen
 * readers already look and where `title` was only ever a fallback.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FocusEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

/** How long the pointer must rest before the bubble appears. */
export const TIP_DELAY = 350;
/** After a bubble hides, the next one skips the wait — sliding along a row of
 *  buttons should read as one bubble following the cursor, not four waits. */
const WARM = 400;
/** Gap between the trigger and the bubble. */
const GAP = 6;
/** Closest the bubble may come to a viewport edge. */
const EDGE = 6;

interface Shown {
  text: string;
  /** Viewport rect of the trigger, read when the bubble was asked for. */
  rect: { top: number; bottom: number; left: number; width: number };
}

let shown: Shown | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let warmTimer: ReturnType<typeof setTimeout> | undefined;
let warm = false;
const subs = new Set<() => void>();

function emit() {
  for (const s of subs) s();
}

function open(el: Element, text: string) {
  const r = el.getBoundingClientRect();
  shown = { text, rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width } };
  emit();
}

function requestShow(el: Element, text: string) {
  clearTimeout(showTimer);
  if (warm || shown) {
    open(el, text);
    return;
  }
  showTimer = setTimeout(() => open(el, text), TIP_DELAY);
}

function hide() {
  clearTimeout(showTimer);
  if (!shown) return;
  shown = null;
  warm = true;
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    warm = false;
  }, WARM);
  emit();
}

/**
 * Where the bubble goes. Above the trigger by default and centred on it; below
 * when there is no room above, because a bubble that covers its own trigger
 * hides the thing the reader is asking about. Kept pure so the flipping and
 * clamping can be tested without a layout engine.
 */
export function tooltipPosition(
  trigger: { top: number; bottom: number; left: number; width: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number; placement: 'above' | 'below' } {
  const above = trigger.top - tip.height - GAP;
  const placement = above >= EDGE ? 'above' : 'below';
  const top = placement === 'above' ? above : trigger.bottom + GAP;
  const centred = trigger.left + trigger.width / 2 - tip.width / 2;
  const left = Math.max(EDGE, Math.min(centred, viewport.width - tip.width - EDGE));
  return { left, top, placement };
}

/** Handlers to spread onto whatever used to carry a `title`. */
export interface TipHandlers {
  onPointerEnter?: (e: ReactPointerEvent) => void;
  onPointerLeave?: () => void;
  onPointerDown?: () => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: () => void;
}

/** True when the browser thinks this focus deserves a visible affordance —
 *  i.e. the user got here by keyboard, not by clicking. */
function focusIsVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true; // no :focus-visible support: better to show than to swallow
  }
}

export function tip(text: string | undefined | null | false): TipHandlers {
  if (!text) return {};
  return {
    onPointerEnter: (e) => {
      // A finger has no hover, and a long-press bubble fights scrolling and text
      // selection over a control that is already on screen. Native `title` never
      // appeared on touch either.
      if (e.pointerType === 'touch') return;
      requestShow(e.currentTarget, text);
    },
    onPointerLeave: hide,
    // Clicking answers the question the tooltip was asking; leaving the bubble
    // hanging over whatever the click opened is just litter.
    onPointerDown: hide,
    onFocus: (e) => {
      if (focusIsVisible(e.currentTarget)) requestShow(e.currentTarget, text);
    },
    onBlur: hide,
  };
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

const snapshot = () => shown;

/** Mount once, at the app root. */
export function TooltipLayer() {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!state || !ref.current) {
      setAt(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    setAt(
      tooltipPosition(
        state.rect,
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [state]);

  // A bubble is anchored to a rect read once. Anything that moves that rect
  // without the pointer leaving — a scroll, a resize — would leave it pointing
  // at nothing, so it goes away instead of lying about what it describes.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [state]);

  if (!state) return null;
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="tip"
      style={{
        left: at ? `${at.left}px` : '0',
        top: at ? `${at.top}px` : '0',
        // Author line breaks are meaningful here — the calendar block's bubble is
        // three labelled lines — and the first paint before measuring must not
        // flash in the corner.
        whiteSpace: 'pre-line',
        opacity: at ? 1 : 0,
      }}
    >
      {state.text}
    </div>,
    document.body,
  );
}
