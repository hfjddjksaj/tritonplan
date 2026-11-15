import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { attachCardReorder } from './card-reorder';
import { fire, layOut } from '../test/drag';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn(); // not in jsdom
});

let detach: (() => void) | undefined;
afterEach(() => {
  detach?.();
  detach = undefined;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function mount(n = 3) {
  document.body.innerHTML = '<aside class="rail"><div class="rail__scroll"><div class="rail__cards"></div></div></aside>';
  const list = document.querySelector<HTMLElement>('.rail__cards')!;
  for (let i = 0; i < n; i++) {
    const card = document.createElement('section');
    card.className = 'course-card';
    card.dataset.courseId = `c${i}`;
    card.innerHTML =
      '<div class="course-card__head">' +
      `<span class="course-card__code">C${i}</span><button type="button" class="course-card__remove">x</button>` +
      '</div><div class="course-card__actions"></div><div class="picker"></div>';
    list.append(card);
  }
  layOut(list);
  // What React does inside flushSync: the node is in its new place when this returns.
  const onReorder = vi.fn((id: string, to: number) => {
    const card = list.querySelector(`[data-course-id="${id}"]`)!;
    const others = [...list.children].filter((c) => c !== card);
    list.insertBefore(card, others[to] ?? null);
  });
  detach = attachCardReorder(list, {
    scroller: document.querySelector<HTMLElement>('.rail__scroll')!,
    bounds: document.querySelector<HTMLElement>('.rail')!,
    onReorder,
  });
  const card = (i: number) => list.querySelector<HTMLElement>(`[data-course-id="c${i}"]`)!;
  const code = (i: number) => card(i).querySelector<HTMLElement>('.course-card__code')!;
  const remove = (i: number) => card(i).querySelector<HTMLButtonElement>('.course-card__remove')!;
  const order = () => [...list.children].map((c) => (c as HTMLElement).dataset.courseId);
  return { list, onReorder, card, code, remove, order };
}
/** Press card 0 at its head and carry it to (x, y). Card i spans 12+100i … 100+100i. */
function carry(m: ReturnType<typeof mount>, x: number, y: number, from = 0) {
  fire(m.code(from), 'pointerdown', 50, 30 + 100 * from);
  fire(window, 'pointermove', 50, 40 + 100 * from);
  fire(window, 'pointermove', x, y);
}
const ghost = () => document.querySelector('.reorder-ghost');
const scroller = () => document.querySelector<HTMLElement>('.rail__scroll')!;
const said = () => document.querySelector('.reorder-layer [aria-live]')!.textContent;
const root = document.documentElement;

describe('attachCardReorder', () => {
  it('drops a card where the pointer lets go', () => {
    const m = mount();
    carry(m, 50, 180);
    expect(ghost()).not.toBeNull();
    expect(m.card(0).dataset.reorder).toBe('slot');
    expect(root.dataset.reordering).toBe('');
    expect(said()).toBe('C0 picked up.');
    fire(window, 'pointerup', 50, 180);
    expect(m.onReorder.mock.calls).toEqual([['c0', 1]]);
    expect(m.order()).toEqual(['c1', 'c0', 'c2']);
    expect(root.dataset.reordering).toBeUndefined();
    expect(m.list.dataset.dragging).toBeUndefined();
    expect(said()).toBe('C0 moved to position 2 of 3.');
  });

  it('carries a card to the end of the list', () => {
    const m = mount();
    carry(m, 50, 500);
    fire(window, 'pointerup', 50, 500);
    expect(m.onReorder.mock.calls).toEqual([['c0', 2]]);
  });

  it('writes nothing when the card comes back to its own slot', () => {
    const m = mount();
    carry(m, 60, 135, 1);
    fire(window, 'pointerup', 60, 135);
    expect(m.onReorder).not.toHaveBeenCalled();
    expect(said()).toBe('C1 put back.');
  });

  it('puts the card back on Escape', () => {
    const m = mount();
    carry(m, 50, 180);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(root.dataset.reordering).toBeUndefined();
    fire(window, 'pointerup', 50, 180);
    expect(m.onReorder).not.toHaveBeenCalled();
  });

  it('puts the card back when let go beside the rail', () => {
    const m = mount();
    carry(m, 349, 180); // the rail ends at 300; 48px of grace
    fire(window, 'pointerup', 349, 180);
    expect(m.onReorder).not.toHaveBeenCalled();
  });

  it('ignores every button but the primary one', () => {
    const m = mount();
    fire(m.code(0), 'pointerdown', 50, 30, { button: 2 });
    fire(window, 'pointermove', 50, 180);
    expect(ghost()).toBeNull();
  });

  it('a press on a control that does not move is still a click', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = mount();
    const clicked = vi.fn();
    m.remove(0).addEventListener('click', clicked);
    fire(m.remove(0), 'pointerdown', 250, 30);
    vi.advanceTimersByTime(1000);
    expect(ghost()).toBeNull();
    fire(window, 'pointerup', 250, 30);
    m.remove(0).click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('holding still on the card picks it up', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = mount();
    fire(m.code(0), 'pointerdown', 50, 30);
    vi.advanceTimersByTime(219);
    expect(ghost()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(ghost()).not.toBeNull();
  });

  it('a finger that rests picks the card up, even on a control', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = mount();
    fire(m.remove(0), 'pointerdown', 250, 30, { pointerType: 'touch' });
    vi.advanceTimersByTime(300);
    expect(ghost()).not.toBeNull();
  });

  it('a finger that moves is scrolling', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = mount();
    fire(m.code(0), 'pointerdown', 50, 30, { pointerType: 'touch' });
    fire(window, 'pointermove', 50, 39, { pointerType: 'touch' });
    vi.advanceTimersByTime(1000);
    expect(ghost()).toBeNull();
  });

  it('the click that ends a drag reaches nobody', async () => {
    const m = mount();
    const clicked = vi.fn();
    m.remove(2).addEventListener('click', clicked);
    carry(m, 250, 230);
    fire(window, 'pointerup', 250, 230);
    m.remove(2).click();
    expect(clicked).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    m.remove(2).click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('lets go cleanly when the lifted card leaves the list', () => {
    const m = mount();
    carry(m, 50, 180);
    m.card(0).remove();
    fire(window, 'pointerup', 50, 180);
    expect(m.onReorder).not.toHaveBeenCalled();
    expect(ghost()).toBeNull();
    expect(root.dataset.reordering).toBeUndefined();
    expect(m.list.dataset.dragging).toBeUndefined();
  });

  it('detaching mid-drag leaves nothing behind', () => {
    const m = mount();
    carry(m, 50, 180);
    detach!();
    detach = undefined;
    expect(document.querySelector('.reorder-layer')).toBeNull();
    expect(root.dataset.reordering).toBeUndefined();
    expect(m.list.dataset.dragging).toBeUndefined();
    expect(m.list.dataset.reorderable).toBeUndefined();
    for (const i of [0, 1, 2]) {
      expect(m.card(i).dataset.reorder).toBeUndefined();
      expect(m.card(i).getAttribute('style') ?? '').toBe('');
    }
    expect(() => fire(window, 'pointermove', 50, 300)).not.toThrow();
    fire(window, 'pointerup', 50, 300);
    expect(m.onReorder).not.toHaveBeenCalled();
  });

  it('marks the list reorderable only while attached', () => {
    const m = mount();
    expect(m.list.dataset.reorderable).toBe('');
  });

  it('Alt+ArrowDown moves the focused card one place and keeps focus', () => {
    const m = mount();
    const btn = m.remove(0);
    btn.focus();
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    expect(m.onReorder.mock.calls).toEqual([['c0', 1]]);
    expect(document.activeElement).toBe(btn);
    expect(said()).toBe('C0 moved to position 2 of 3.');
  });

  it('Alt+Arrow refocuses and scrolls inside the move, before the card is drawn at its old place', () => {
    const m = mount();
    const btn = m.remove(0);
    btn.focus();
    const seen: unknown[] = [];
    const focus = btn.focus.bind(btn);
    vi.spyOn(btn, 'focus').mockImplementation((o) => {
      seen.push(['focus', m.order(), m.card(0).style.transform]);
      focus(o);
    });
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element, o) {
      seen.push(['scroll', m.order(), m.card(0).style.transform, o]);
    });
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    scroll.mockRestore();
    const moved = ['c1', 'c0', 'c2'];
    expect(seen).toEqual([
      ['focus', moved, ''],
      ['scroll', moved, '', { block: 'nearest', behavior: 'instant' }],
    ]);
    expect(m.card(0).style.transform).toBe('translate3d(0, -100px, 0)'); // then glides from where it was
    expect(document.activeElement).toBe(btn);
  });

  it('Alt+Arrow at either end does nothing', () => {
    const m = mount();
    m.remove(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));
    m.remove(2).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    expect(m.onReorder).not.toHaveBeenCalled();
  });
});

describe('scroll anchoring', () => {
  const frames = () => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  const altDown = (el: Element) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  /** The scroller's anchoring at the moment the order changes. */
  function anchoringAtMove(m: ReturnType<typeof mount>) {
    const seen: string[] = [];
    const move = m.onReorder.getMockImplementation()!;
    m.onReorder.mockImplementation((id, to) => {
      seen.push(scroller().style.overflowAnchor);
      move(id, to);
    });
    return seen;
  }

  it('is off while a card is held and landing, and back once everything is at rest', () => {
    frames();
    const m = mount();
    expect(scroller().style.overflowAnchor).toBe('');
    carry(m, 50, 180);
    expect(scroller().style.overflowAnchor).toBe('none');
    vi.advanceTimersByTime(500);
    fire(window, 'pointerup', 50, 180);
    vi.advanceTimersToNextFrame();
    expect(ghost()).not.toBeNull(); // still landing
    expect(scroller().style.overflowAnchor).toBe('none');
    vi.advanceTimersByTime(3000);
    expect(ghost()).toBeNull();
    expect(scroller().style.overflowAnchor).toBe('');
  });

  it('comes back when the list is detached mid-drag', () => {
    const m = mount();
    carry(m, 50, 180);
    expect(scroller().style.overflowAnchor).toBe('none');
    detach!();
    detach = undefined;
    expect(scroller().style.overflowAnchor).toBe('');
  });

  it('is off before a keyboard move changes the order, and back once the cards have glided', () => {
    frames();
    const m = mount();
    const seen = anchoringAtMove(m);
    altDown(m.remove(0));
    expect(seen).toEqual(['none']);
    vi.advanceTimersByTime(3000);
    expect(scroller().style.overflowAnchor).toBe('');
  });

  it('with reduced motion, comes back on the next frame', () => {
    frames();
    window.matchMedia = vi.fn((media: string) => ({ matches: true, media }) as unknown as MediaQueryList);
    try {
      const m = mount();
      const seen = anchoringAtMove(m);
      altDown(m.remove(0));
      expect(seen).toEqual(['none']);
      expect(m.card(0).style.transform).toBe('');
      vi.advanceTimersToNextFrame();
      expect(scroller().style.overflowAnchor).toBe('');
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});

describe('a press that ends out of sight', () => {
  const contextMenu = (target: EventTarget) => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };

  it('puts a held card back when the window loses focus', () => {
    const m = mount();
    carry(m, 50, 180);
    window.dispatchEvent(new Event('blur'));
    expect(root.dataset.reordering).toBeUndefined();
    expect(said()).toBe('C0 put back.');
    fire(window, 'pointerup', 50, 180);
    expect(m.onReorder).not.toHaveBeenCalled();
  });

  it('lifts nothing once the window has lost focus during the hold', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = mount();
    fire(m.code(0), 'pointerdown', 50, 30);
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(1000);
    fire(window, 'pointermove', 50, 180);
    expect(ghost()).toBeNull();
    expect(root.dataset.reordering).toBeUndefined();
  });

  it('puts the card back on pointercancel', () => {
    const m = mount();
    carry(m, 50, 180);
    fire(window, 'pointercancel', 50, 180);
    expect(root.dataset.reordering).toBeUndefined();
    expect(said()).toBe('C0 put back.');
    fire(window, 'pointerup', 50, 180);
    expect(m.onReorder).not.toHaveBeenCalled();
  });

  it('a context menu ends a mouse press and is left to open', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = mount();
    fire(m.code(0), 'pointerdown', 50, 30);
    expect(contextMenu(m.code(0)).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(1000);
    fire(window, 'pointermove', 50, 180);
    expect(ghost()).toBeNull();
  });

  it('a long-press menu does not end a finger’s press', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = mount();
    fire(m.code(0), 'pointerdown', 50, 30, { pointerType: 'touch' });
    vi.advanceTimersByTime(100);
    expect(contextMenu(m.code(0)).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(200);
    expect(ghost()).not.toBeNull();
  });

  it('no menu opens over a card in the hand', () => {
    const m = mount();
    carry(m, 50, 180);
    expect(contextMenu(m.list).defaultPrevented).toBe(true);
    expect(root.dataset.reordering).toBe('');
  });

  it('a mouse moving with no button down has let go: the press is dropped', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = mount();
    fire(m.code(0), 'pointerdown', 50, 30);
    fire(window, 'pointermove', 50, 40, { buttons: 0 });
    vi.advanceTimersByTime(1000);
    expect(ghost()).toBeNull();
  });

  it('a mouse moving with no button down has let go: the held card goes back', () => {
    const m = mount();
    carry(m, 50, 180);
    fire(window, 'pointermove', 50, 200, { buttons: 0 });
    expect(root.dataset.reordering).toBeUndefined();
    expect(said()).toBe('C0 put back.');
    fire(window, 'pointerup', 50, 200);
    expect(m.onReorder).not.toHaveBeenCalled();
  });

  it('the next click after a drag cancelled mid-press is an ordinary one', () => {
    const m = mount();
    const clicked = vi.fn();
    m.remove(2).addEventListener('click', clicked);
    carry(m, 50, 180);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    // The button comes up where the page cannot see it, and the mouse moves on.
    fire(window, 'pointermove', 250, 230, { buttons: 0 });
    fire(m.remove(2), 'pointerdown', 250, 230);
    fire(window, 'pointerup', 250, 230);
    m.remove(2).click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('lets go cleanly when the held card leaves the list before any pointerup', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const m = mount();
    const clicked = vi.fn();
    m.remove(1).addEventListener('click', clicked);
    carry(m, 50, 180);
    m.card(0).remove();
    vi.advanceTimersToNextFrame();
    expect(ghost()).toBeNull();
    expect(root.dataset.reordering).toBeUndefined();
    expect(m.list.dataset.dragging).toBeUndefined();
    fire(window, 'pointerup', 50, 180);
    m.remove(1).click(); // the click that ends this press
    expect(clicked).not.toHaveBeenCalled();
    expect(m.onReorder).not.toHaveBeenCalled();
  });
});
