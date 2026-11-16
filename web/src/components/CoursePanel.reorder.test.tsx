import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { makeClashPlan, makePlan } from '../lib/fixtures';
import { moveEntry } from '../lib/plan';
import { sharedController } from '../hooks/sharedController';
import type { PlanController } from '../hooks/usePlan';
import { fire, layOut } from '../test/drag';
import { CoursePanel } from './CoursePanel';
import { TooltipLayer, TIP_DELAY } from './Tooltip';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function own(over: Partial<PlanController> = {}): PlanController {
  return { ...sharedController(makeClashPlan(), vi.fn()), readOnly: false, shared: false, guest: false, ...over };
}

describe('CoursePanel card reordering', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn(); // not in jsdom
  });
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(ctl: PlanController, hidden = false) {
    act(() => root.render(<CoursePanel ctl={ctl} hidden={hidden} />));
  }
  const list = () => container.querySelector<HTMLElement>('.rail__cards')!;

  it('makes the cards of an editable plan reorderable', () => {
    render(own());
    expect(list().dataset.reorderable).toBe('');
    expect([...list().children].map((c) => (c as HTMLElement).dataset.courseId)).toEqual(['CSE-8A|2026|2', 'MATH-18|2026|2']);
  });

  it.each<[string, () => PlanController, boolean?]>([
    ['a shared plan', () => sharedController(makeClashPlan(), vi.fn())],
    ['an archived term', () => own({ readOnly: true })],
    ['a signed-out visitor', () => own({ guest: true })],
    ['a single course', () => own({ viewPlan: makePlan() })],
    ['a pane hidden behind another tab', () => own(), true],
  ])('leaves %s alone', (_name, ctl, hidden) => {
    render(ctl(), hidden);
    expect(list().dataset.reorderable).toBeUndefined();
  });

  it('stays attached while the panel re-renders', () => {
    render(own({ reorderCourse: vi.fn() }));
    const layer = document.querySelector('.reorder-layer');
    expect(layer).not.toBeNull();
    render(own({ reorderCourse: vi.fn() }));
    expect(document.querySelectorAll('.reorder-layer')).toHaveLength(1);
    expect(document.querySelector('.reorder-layer')).toBe(layer);
  });

  it('turns reordering off when the plan stops being editable', () => {
    render(own());
    render(own({ readOnly: true }));
    expect(list().dataset.reorderable).toBeUndefined();
    expect(document.querySelector('.reorder-layer')).toBeNull();
  });

  it('hands a drop to the controller', () => {
    const reorderCourse = vi.fn();
    render(own({ reorderCourse }));
    layOut(list());
    const first = list().querySelector<HTMLElement>('.course-card__code')!;
    fire(first, 'pointerdown', 50, 30);
    fire(window, 'pointermove', 50, 40);
    fire(window, 'pointermove', 50, 180);
    fire(window, 'pointerup', 50, 180);
    expect(reorderCourse.mock.calls).toEqual([['CSE-8A|2026|2', 1]]);
  });

  /** The panel over a plan it can really reorder. */
  function Owned() {
    const [plan, setPlan] = useState(makeClashPlan);
    return <CoursePanel ctl={own({ viewPlan: plan, reorderCourse: (id, to) => setPlan((p) => moveEntry(p, id, to)) })} />;
  }
  const order = () => [...list().children].map((c) => (c as HTMLElement).dataset.courseId);

  it('the new order is in the DOM by the time a drop returns', () => {
    act(() => root.render(<Owned />));
    layOut(list());
    const first = list().querySelector<HTMLElement>('.course-card__code')!;
    // Inside act the commit would wait for act to end; the engine measures straight away.
    const env = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    env.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      fire(first, 'pointerdown', 50, 30);
      fire(window, 'pointermove', 50, 40);
      fire(window, 'pointermove', 50, 180);
      fire(window, 'pointerup', 50, 180);
      expect(order()).toEqual(['MATH-18|2026|2', 'CSE-8A|2026|2']);
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });

  it('a keyboard move takes down the bubble of the button it moves', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      act(() => root.render(<><Owned /><TooltipLayer /></>));
      const remove = list().querySelectorAll<HTMLButtonElement>('.course-card__remove')[1];
      act(() => remove.focus());
      act(() => void vi.advanceTimersByTime(TIP_DELAY));
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Remove MATH-18');
      // Moving up, the card keeps its node and focus never leaves the button.
      act(() => {
        remove.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }));
      });
      expect(order()).toEqual(['MATH-18|2026|2', 'CSE-8A|2026|2']);
      expect(document.activeElement).toBe(remove);
      act(() => void vi.advanceTimersByTime(TIP_DELAY * 3));
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('plays a card’s entry animation once', () => {
    render(own());
    const card = list().querySelector<HTMLElement>('.course-card')!;
    const end = (name: string, target: Element = card) => {
      const ev = new Event('animationend', { bubbles: true });
      Object.defineProperty(ev, 'animationName', { value: name });
      act(() => void target.dispatchEvent(ev));
    };
    end('card-in', card.querySelector('.course-card__code')!); // a child's animation is not the card's
    end('card-flash');
    expect(card.classList.contains('course-card--entered')).toBe(false);
    end('card-in');
    expect(card.classList.contains('course-card--entered')).toBe(true);
  });
});
