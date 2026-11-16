/**
 * Driving a card drag from a test. jsdom has neither PointerEvent nor layout,
 * so pointer events go out as MouseEvents carrying the pointer fields, and the
 * rail's boxes are stubbed to a fixed geometry.
 */

/**
 * Dispatch a bubbling, cancelable pointer event of `type` at (x, y); returns it.
 * A move is made with the button held unless `buttons` says otherwise.
 */
export function fire(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  init: { pointerType?: 'mouse' | 'touch'; button?: number; buttons?: number } = {},
): MouseEvent {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: init.button ?? 0,
    buttons: init.buttons ?? (type === 'pointermove' ? 1 : 0),
  });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' });
  target.dispatchEvent(e);
  return e;
}

const box = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({ left, top, width, height }),
  }) as DOMRect;

function stub(el: Element | null, rect: () => DOMRect): void {
  if (el) el.getBoundingClientRect = rect;
}

/**
 * The rail and its scroller at 0,0 300×600; the list at left 16, top 12, 268
 * wide; card i 268×88 at top 12 + 100·i (12px gaps), its head the top 40px.
 * A card's index is read on every call, so its box follows re-ordering.
 */
export function layOut(list: HTMLElement): void {
  const whole = () => box(0, 0, 300, 600);
  stub(list.closest('.rail'), whole);
  stub(list.closest('.rail__scroll'), whole);
  stub(list, () => box(16, 12, 268, Math.max(0, 100 * list.children.length - 12)));
  for (const card of [...list.children]) {
    const at = () => box(16, 12 + 100 * [...list.children].indexOf(card), 268, 88);
    stub(card, at);
    stub(card.querySelector('.course-card__head'), () => box(16, at().top, 268, 40));
  }
}
