// Drag to reorder the course cards of a list. A pressed card is lifted into a
// layer over the page, where it closes down to its head and follows the
// pointer while the slot it left folds shut and a line marks where it will
// land; let go, it flies into its slot and opens back out. Every motion is a
// spring stepped once per animation frame, so any of it can be taken over
// midway: a second card can be lifted while the first is still landing.
//
// The engine reads and writes layout but never the order: a move is a call to
// `onReorder`, and the cards animate from wherever the DOM then puts them.

import { clamp01, lerp, settled, snap, spring, step, tune, type Spring } from './spring';
import { edgePull, gapY, GAP, releaseVelocity, slotIndex, type Span, type TrailPoint } from './reorder-geometry';
import {
  buildLine,
  INSERTION_LINE,
  LINE_GUTTER,
  LINE_HEIGHT,
  LINE_PART,
  poseLine,
  type LineDrawing,
  type LineStyle,
} from './insertion-line';

export interface CardReorderOptions {
  /** Scrolls the list: autoscroll at its edges, and landings are clipped to it. */
  scroller: HTMLElement;
  /** Letting go more than 48px left or right of this box puts the card back. */
  bounds: HTMLElement;
  /** Must have re-ordered the DOM by the time it returns. `toIndex` is the card's index in the new order. */
  onReorder(courseId: string, toIndex: number): void;
  line?: LineStyle; // defaults to INSERTION_LINE
}

/** How far each moving part overshoots: enough to feel alive, not enough to notice. */
const BOUNCE = { lift: 0.1, land: 0.2, line: 0.18, part: 0.12 };
/** Opacity of the white ground under a card in the hand; the rest is backdrop blur. */
const GLASS = 0.3;
/** Letting go further than this beside the bounds is letting go nowhere. */
const OUTSIDE = 48;
/** Autoscroll speed at the very edge of the scroller, px/s. */
const SCROLL_SPEED = 780;
/** Held still this long, a press lifts the card. */
const HOLD_MOUSE_MS = 220;
const HOLD_TOUCH_MS = 300;
/** A landing that has not settled by now is put down where it is. */
const LANDING_MAX_MS = 1600;
const CONTROL = 'button, a, input, select, textarea';

/** The pointer is down on a card, not yet a drag. */
interface Press {
  card: HTMLElement;
  pid: number;
  x: number;
  y: number;
  touch: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** A card out of the list: its copy in the air and the slot it left. */
interface Lifted {
  card: HTMLElement;
  ghost: HTMLElement;
  /** The card's box as it lies in the list. */
  W: number;
  H: number;
  /** Its height in the hand, closed down to its head. */
  Hc: number;
  /** Where it was grabbed, from its top left. */
  ox: number;
  oy: number;
  /** The vertical grab point once in the hand. */
  oyT: number;
  /** 0 = the card as it lies, 1 = its head in the hand. */
  morph: Spring;
  /** How open the slot it left still is. */
  slot: Spring;
}

interface Drag extends Lifted {
  pid: number;
  /** The slot it would land in, among `others`. */
  to: number;
  others: HTMLElement[];
  /** The pointer. */
  x: number;
  y: number;
  /** The copy's top left. */
  left: number;
  top: number;
  trail: TrailPoint[];
  outside: boolean;
}

interface Landing extends Lifted {
  px: Spring;
  py: Spring;
  born: number;
}

interface Place extends Span {
  left: number;
}

/** A card's offset spring, and the offset last written to its transform. */
interface Nudge {
  spring: Spring;
  drawn: number;
}

/** Makes the `.course-card` children of `list` reorderable; returns the function that undoes it. */
export function attachCardReorder(list: HTMLElement, opts: CardReorderOptions): () => void {
  const { scroller, bounds } = opts;
  const style = opts.line ?? INSERTION_LINE;
  const part = LINE_PART[style];
  const root = document.documentElement;
  const motion =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => motion?.matches === true;

  const layer = document.createElement('div');
  layer.className = 'reorder-layer';
  const lineHost = document.createElement('div');
  lineHost.className = 'reorder-line';
  const live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  layer.append(lineHost, live);
  document.body.append(layer);
  list.dataset.reorderable = '';

  const cardEls = () =>
    [...list.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('course-card'),
    );
  const nameOf = (card: HTMLElement) => card.querySelector('.course-card__code')?.textContent ?? '';
  const announce = (msg: string) => {
    live.textContent = msg;
  };
  // The plan can change under a lifted card: a sync or another tab can take it away.
  const gone = (card: HTMLElement) => card.parentNode !== list;

  let press: Press | null = null;
  let drag: Drag | null = null;
  const landings = new Set<Landing>();
  const lineY = spring(0, 0.3, BOUNCE.line);
  const lineOn = spring(0, 0.24, 0);
  let raf = 0;
  let last = 0;

  // Each card can be nudged off its place by a spring: to step back from the
  // line, and to glide rather than jump when the list re-flows under it.
  const nudges = new WeakMap<HTMLElement, Nudge>();
  const nudgeOf = (el: HTMLElement) => {
    let n = nudges.get(el);
    if (!n) nudges.set(el, (n = { spring: spring(0, 0.38, BOUNCE.part), drawn: 0 }));
    return n;
  };
  /** Where a card sits in the layout, without the nudge currently drawn on it. */
  function natural(el: HTMLElement): Place {
    const r = el.getBoundingClientRect();
    const dy = nudges.get(el)?.drawn ?? 0;
    return { left: r.left, top: r.top - dy, bottom: r.bottom - dy };
  }
  const measure = (cards: HTMLElement[]) => new Map(cards.map((c) => [c, natural(c)]));

  /** Change the list's order or size; every card starts from where it was drawn. */
  function reflow(mutate: () => void, except?: HTMLElement) {
    const before = new Map(cardEls().map((el) => [el, natural(el).top]));
    mutate();
    if (reduced()) return;
    for (const el of cardEls()) {
      const was = before.get(el);
      if (el === except || was === undefined) continue;
      const delta = was - natural(el).top;
      if (!delta) continue;
      const n = nudgeOf(el);
      n.spring.x += delta;
      n.drawn = n.spring.x;
      el.style.transform = `translate3d(0, ${n.spring.x}px, 0)`;
    }
    kick();
  }

  function kick() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function bind() {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }
  function unbind() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }
  function dropPress() {
    if (press) clearTimeout(press.timer);
    press = null;
    unbind();
  }
  const stopClick = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  /** The click that follows a drag's pointerup belongs to nobody. */
  function swallowClick() {
    window.addEventListener('click', stopClick, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stopClick, { capture: true }), 0);
  }
  /** The drag ended with the pointer still down: the click its pointerup brings is not for the list. */
  function swallowLateClick() {
    window.addEventListener('pointerup', swallowClick, { once: true });
    // A pointerup that never came must not take the next press's click instead.
    window.addEventListener('pointerdown', disarmLateClick, { capture: true, once: true });
  }
  function disarmLateClick() {
    window.removeEventListener('pointerup', swallowClick);
  }

  function onDown(e: PointerEvent) {
    if (press || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    const card = target?.closest<HTMLElement>('.course-card');
    if (!target || !card || card.parentNode !== list) return;
    const touch = e.pointerType !== 'mouse';
    const p: Press = { card, pid: e.pointerId, x: e.clientX, y: e.clientY, touch, timer: undefined };
    press = p;
    // Resting on the card picks it up. A finger rests a little longer, since a
    // finger that moves is scrolling; a mouse held on a control is a slow click,
    // so there only movement lifts.
    if (touch || !target.closest(CONTROL)) {
      p.timer = setTimeout(
        () => {
          if (press === p) lift(p, p.x, p.y);
        },
        touch ? HOLD_TOUCH_MS : HOLD_MOUSE_MS,
      );
    }
    bind();
  }
  const onDragStart = (e: Event) => e.preventDefault();
  // A menu that opens over a mouse press takes the button's release with it
  // (macOS opens one on Ctrl+mousedown), so the press ends here. A finger's long
  // press brings a menu too, about when it lifts the card, and the card wins.
  const onContextMenu = (e: Event) => {
    if (drag || press?.touch) e.preventDefault();
    else dropPress();
  };
  // Once a card is up, the finger moves the card, not the list.
  const onTouchMove = (e: Event) => {
    if (drag) e.preventDefault();
  };

  function onMove(e: PointerEvent) {
    // A mouse moving with no button down was let go where the page could not see.
    const unseenUp = e.pointerType === 'mouse' && e.buttons === 0;
    if (drag) {
      if (e.pointerId !== drag.pid) return;
      if (unseenUp) release(false);
      else pointerAt(e.clientX, e.clientY);
      return;
    }
    if (!press || e.pointerId !== press.pid) return;
    if (unseenUp) {
      dropPress();
      return;
    }
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (press.touch) {
      if (moved > 8) dropPress();
    } else if (moved >= 5) {
      lift(press, e.clientX, e.clientY);
    }
  }
  function onUp(e: PointerEvent) {
    if (drag) {
      if (e.pointerId !== drag.pid) return;
      swallowClick();
      release(true);
    } else {
      dropPress();
    }
  }
  function onCancel(e: PointerEvent) {
    if (drag) {
      if (e.pointerId === drag.pid) release(false);
    } else {
      dropPress();
    }
  }
  function onEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !drag) return;
    e.preventDefault();
    swallowLateClick();
    release(false);
  }
  function onBlur() {
    if (drag) release(false);
    else dropPress();
  }

  /** The pointer, and a short memory of it: the release velocity comes from here. */
  function pointerAt(x: number, y: number) {
    const d = drag;
    if (!d) return;
    d.x = x;
    d.y = y;
    const t = performance.now();
    d.trail.push({ t, x, y });
    while (d.trail.length > 2 && t - d.trail[0].t > 90) d.trail.shift();
  }

  function lift(p: Press, x: number, y: number) {
    clearTimeout(p.timer);
    press = null;
    const card = p.card;
    const r = card.getBoundingClientRect();
    const W = r.width;
    const H = r.height;

    // In the hand the card keeps its width and closes down to its head.
    const head = card.querySelector('.course-card__head');
    const Hc = head ? Math.min(H, head.getBoundingClientRect().bottom - r.top + 11) : H;

    const ghost = document.createElement('div');
    ghost.className = 'reorder-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    for (const v of ['--c-spine', '--c-border', '--c-text']) {
      ghost.style.setProperty(v, card.style.getPropertyValue(v));
    }
    // A conflicted card keeps its red hairline in the air.
    ghost.style.borderColor = getComputedStyle(card).borderColor;
    const clone = card.cloneNode(true) as HTMLElement;
    delete clone.dataset.reorder;
    clone.style.transform = '';
    clone.style.marginBottom = '';
    clone.style.width = `${W - 2}px`;
    clone.style.height = `${H - 2}px`;
    for (const el of clone.querySelectorAll('.course-card__actions, .picker')) {
      el.classList.add('reorder-ghost__fade');
    }
    ghost.append(clone);
    layer.append(ghost);

    const ox = p.x - r.left;
    const oy = p.y - r.top;
    const d: Drag = {
      card,
      ghost,
      W,
      H,
      Hc,
      // The grab point is kept. Grabbed lower than the head reaches, the head
      // slides down under the pointer instead of leaving it behind.
      ox,
      oy,
      oyT: Math.min(oy, Hc - 12),
      morph: spring(0, 0.44, BOUNCE.lift),
      slot: spring(1, 0.44, 0),
      pid: p.pid,
      to: cardEls().indexOf(card),
      others: [],
      x,
      y,
      left: r.left,
      top: r.top,
      trail: [],
      outside: false,
    };
    d.morph.to = 1;
    d.slot.to = 0;
    drag = d;

    card.dataset.reorder = 'slot';
    card.style.height = `${H}px`;
    lineHost.style.color = card.style.getPropertyValue('--c-spine');
    list.dataset.dragging = '';
    root.dataset.reordering = '';
    window.getSelection?.()?.removeAllRanges();

    paint(d, 0, r.left, r.top);
    kick();
    announce(`${nameOf(card)} picked up.`);
  }

  /** The card leaves the hand; returns the drag that held it. */
  function letGo(): Drag | null {
    const d = drag;
    if (!d) return null;
    drag = null;
    unbind();
    delete list.dataset.dragging;
    delete root.dataset.reordering;
    return d;
  }

  /** The copy goes and the card shows in its slot again. */
  function restore(it: Lifted) {
    it.ghost.remove();
    delete it.card.dataset.reorder;
    it.card.style.height = '';
    it.card.style.marginBottom = '';
  }

  function release(commit: boolean) {
    const d = letGo();
    if (!d) return;
    if (gone(d.card)) {
      restore(d);
      return;
    }

    // Decided from where the pointer is now, not from the last frame drawn: a
    // quick flick can lift and let go between two frames.
    const cards = cardEls();
    locate(d, cards, measure(cards), list.getBoundingClientRect());
    const from = cards.indexOf(d.card);
    const to = commit && !d.outside ? d.to : from;
    const moved = to !== from;
    if (moved) reflow(() => opts.onReorder(d.card.dataset.courseId!, to), d.card);

    // From here the copy is no longer held: two springs carry it to its slot,
    // starting at the speed the pointer had when it let go.
    const v = releaseVelocity(d.trail, performance.now());
    const px = spring(d.left, 0.46, BOUNCE.land);
    const py = spring(d.top, 0.46, BOUNCE.land);
    px.v = v.vx;
    py.v = v.vy;
    tune(d.morph, 0.5, BOUNCE.land * 0.5).to = 0;
    tune(d.slot, 0.46, 0).to = 1;
    landings.add({ ...d, px, py, born: performance.now() });
    kick();

    const name = nameOf(d.card);
    announce(moved ? `${name} moved to position ${to + 1} of ${d.others.length + 1}.` : `${name} put back.`);
  }

  /** Step the two springs a lifted card owns and resize the slot it left. */
  function advance(it: Lifted, dt: number, still: boolean) {
    step(it.morph, dt);
    step(it.slot, dt);
    if (still) {
      snap(it.morph);
      snap(it.slot);
    }
    const open = clamp01(it.slot.x);
    it.card.style.height = `${it.H * open}px`;
    it.card.style.marginBottom = `${GAP * open}px`;
  }

  /** Draw the box at morph `p`: 0 is the card exactly as it lies in the list. */
  function paint(it: Lifted, p: number, left: number, top: number, clip?: Span) {
    const pc = clamp01(p);
    const g = it.ghost.style;
    const h = lerp(it.H, it.Hc, p);
    g.width = `${it.W}px`;
    g.height = `${h}px`;
    g.transform = `translate3d(${left}px, ${top}px, 0)`;
    g.boxShadow =
      `0 ${1 + 19 * pc}px ${3 + 41 * pc}px rgba(11, 31, 58, ${0.06 + 0.16 * pc}), ` +
      `0 ${1 + 2 * pc}px ${2 + 6 * pc}px rgba(11, 31, 58, ${0.05 + 0.04 * pc})`;
    g.setProperty('--glass', String(lerp(1, GLASS, pc)));
    // The rest of the card thins out as the box closes over it and is gone a
    // little before the box stops; on the way back it returns as room opens.
    const f = clamp01(p * 1.35);
    g.setProperty('--fade', String(1 - f * f * (3 - 2 * f)));
    const blur = 16 * pc;
    const backdrop = blur > 0.3 ? `blur(${blur}px) saturate(${1 + 0.6 * pc})` : '';
    g.setProperty('backdrop-filter', backdrop);
    g.setProperty('-webkit-backdrop-filter', backdrop);
    // A card landing half out of view is trimmed to the scroller as it opens, so
    // the hand-over to the real card (which the scroller clips) shows no seam.
    if (clip) {
      const k = 1 - pc;
      const t = Math.max(0, clip.top - top) * k;
      const b = Math.max(0, top + h - clip.bottom) * k;
      g.clipPath = t > 0.5 || b > 0.5 ? `inset(${t}px -80px ${b}px -80px)` : '';
    }
  }

  /** Where the copy is and which gap it is over; returns the line's place in the list. */
  function locate(d: Drag, cards: HTMLElement[], nat: Map<HTMLElement, Place>, lr: DOMRect): number {
    d.left = d.x - d.ox;
    d.top = d.y - lerp(d.oy, d.oyT, d.morph.x);
    // Beside the rail there is nowhere to land: no line, and letting go puts it back.
    const rr = bounds.getBoundingClientRect();
    d.outside = d.x < rr.left - OUTSIDE || d.x > rr.right + OUTSIDE;
    // The copy's title line decides the slot.
    d.others = cards.filter((c) => c !== d.card);
    const spans = d.others.map((c) => nat.get(c)!);
    d.to = slotIndex(d.top + 20, spans.map((s) => (s.top + s.bottom) / 2), d.to);
    return gapY(d.to, spans, lr.top) - lr.top;
  }

  let drawing: LineDrawing | null = null;
  let drawingWidth = -1;
  /** The line as built for the list's current width. */
  function liveLine(width: number): LineDrawing {
    if (!drawing || drawingWidth !== Math.round(width)) {
      drawing = buildLine(lineHost, style, width);
      drawingWidth = Math.round(width);
    }
    return drawing;
  }

  function frame(now: number) {
    raf = 0;
    const dt = Math.min(0.034, Math.max(0.001, (now - last) / 1000));
    last = now;
    const still = reduced();

    if (drag && gone(drag.card)) {
      swallowLateClick();
      const d = letGo();
      if (d) restore(d);
    }
    for (const it of landings) {
      if (gone(it.card)) {
        restore(it);
        landings.delete(it);
      }
    }

    if (drag) {
      // Near the top or bottom edge of the scroller, the list scrolls under the copy.
      const edge = scroller.getBoundingClientRect();
      const pull = edgePull(drag.y, edge.top, edge.bottom);
      if (pull && !drag.outside) scroller.scrollTop += pull * SCROLL_SPEED * dt;
      advance(drag, dt, still);
    }
    for (const it of landings) advance(it, dt, still);

    // ---- read the list once, after the slots have been resized
    const cards = cardEls();
    const lr = list.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const nat = measure(cards);

    const lineAt = drag ? locate(drag, cards, nat, lr) : 0;
    // The line waits until the gap the card left has all but closed: before that
    // the list is still moving under it and there is no settled place to mark.
    const showLine = !!drag && !drag.outside && drag.slot.x < 0.35;

    // ---- the cards either side of the line step back from it
    let busy = false;
    for (const c of cards) {
      const n = nudgeOf(c);
      const s = n.spring;
      s.to = showLine && drag && c !== drag.card ? (drag.others.indexOf(c) < drag.to ? -part : part) : 0;
      step(s, dt);
      if (still) snap(s);
      const home = s.to === 0 && settled(s, 0.05, 1);
      if (home) snap(s);
      else busy = true;
      const y = home ? 0 : s.x;
      if (y !== n.drawn) {
        c.style.transform = y ? `translate3d(0, ${y}px, 0)` : '';
        n.drawn = y;
      }
    }

    // ---- the line glides in the list's own coordinates, so a scrolling list
    // carries it along
    if (showLine) {
      lineY.to = lineAt;
      if (lineOn.to === 0 && lineOn.x < 0.02) snap(lineY); // appears in place
      lineOn.to = 1;
    } else {
      lineOn.to = 0;
    }
    step(lineY, dt);
    step(lineOn, dt);
    if (still) {
      snap(lineY);
      snap(lineOn);
    }
    const on = clamp01(lineOn.x);
    const lineTop = lr.top + lineY.x;
    const bead = Math.min(1, Math.abs(lineY.v) / 1500);
    lineHost.style.opacity =
      lineTop > sr.top + 1 && lineTop < sr.bottom - 1 ? String(Math.min(1, on * 1.4)) : '0';
    lineHost.style.transform = `translate3d(${lr.left - LINE_GUTTER}px, ${lineTop - LINE_HEIGHT / 2}px, 0)`;
    poseLine(liveLine(lr.width), on, bead);
    if (lineOn.to !== 0 || on > 0.004 || !settled(lineY, 0.2, 4)) busy = true;

    // ---- the boxes in the air
    if (drag) paint(drag, drag.morph.x, drag.left, drag.top);
    for (const it of landings) {
      const r = nat.get(it.card)!;
      it.px.to = r.left;
      it.py.to = r.top;
      step(it.px, dt);
      step(it.py, dt);
      if (still) {
        snap(it.px);
        snap(it.py);
      }
      paint(it, it.morph.x, it.px.x, it.py.x, sr);
      const home =
        settled(it.morph, 0.008, 0.08) &&
        settled(it.slot, 0.008, 0.08) &&
        settled(it.px, 0.5, 12) &&
        settled(it.py, 0.5, 12);
      if (home || still || now - it.born > LANDING_MAX_MS) {
        restore(it);
        landings.delete(it);
      }
    }

    if (drag || landings.size || busy) raf = requestAnimationFrame(frame);
  }

  /** Alt+Arrow moves the card that holds focus one place. */
  function onListKey(e: KeyboardEvent) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || drag) return;
    const card = e.target instanceof Element ? e.target.closest<HTMLElement>('.course-card') : null;
    if (!card || card.parentNode !== list) return;
    e.preventDefault();
    const cards = cardEls();
    const i = cards.indexOf(card);
    const j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= cards.length) return;
    const focused = document.activeElement;
    // Inside the move, before the card is drawn back where it was: scrolled to
    // after that, it would be found at its old place and glide out of view.
    reflow(() => {
      opts.onReorder(card.dataset.courseId!, j);
      if (focused instanceof HTMLElement && card.contains(focused)) focused.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
    announce(`${nameOf(card)} moved to position ${j + 1} of ${cards.length}.`);
  }

  list.addEventListener('pointerdown', onDown);
  list.addEventListener('dragstart', onDragStart);
  list.addEventListener('contextmenu', onContextMenu);
  list.addEventListener('touchmove', onTouchMove, { passive: false });
  list.addEventListener('keydown', onListKey);
  window.addEventListener('keydown', onEscape);
  window.addEventListener('blur', onBlur);

  return function detach() {
    cancelAnimationFrame(raf);
    raf = 0;
    dropPress();
    const d = letGo();
    if (d) restore(d);
    for (const it of landings) restore(it);
    landings.clear();
    list.removeEventListener('pointerdown', onDown);
    list.removeEventListener('dragstart', onDragStart);
    list.removeEventListener('contextmenu', onContextMenu);
    list.removeEventListener('touchmove', onTouchMove);
    list.removeEventListener('keydown', onListKey);
    window.removeEventListener('keydown', onEscape);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pointerup', swallowClick);
    window.removeEventListener('pointerdown', disarmLateClick, { capture: true });
    window.removeEventListener('click', stopClick, { capture: true });
    for (const c of cardEls()) c.style.transform = '';
    delete list.dataset.reorderable;
    delete list.dataset.dragging;
    delete root.dataset.reordering;
    layer.remove();
  };
}
