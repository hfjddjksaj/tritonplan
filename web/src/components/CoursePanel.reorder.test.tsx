import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { makeClashPlan, makePlan } from '../lib/fixtures';
import { sharedController } from '../hooks/sharedController';
import type { PlanController } from '../hooks/usePlan';
import { fire, layOut } from '../test/drag';
import { CoursePanel } from './CoursePanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function own(over: Partial<PlanController> = {}): PlanController {
  return { ...sharedController(makeClashPlan(), vi.fn()), readOnly: false, shared: false, guest: false, ...over };
}

describe('CoursePanel card reordering', () => {
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

  function render(ctl: PlanController) {
    act(() => root.render(<CoursePanel ctl={ctl} />));
  }
  const list = () => container.querySelector<HTMLElement>('.rail__cards')!;

  it('makes the cards of an editable plan reorderable', () => {
    render(own());
    expect(list().dataset.reorderable).toBe('');
    expect([...list().children].map((c) => (c as HTMLElement).dataset.courseId)).toEqual(['CSE-8A|2026|2', 'MATH-18|2026|2']);
  });

  it.each([
    ['a shared plan', () => sharedController(makeClashPlan(), vi.fn())],
    ['an archived term', () => own({ readOnly: true })],
    ['a signed-out visitor', () => own({ guest: true })],
    ['a single course', () => own({ viewPlan: makePlan() })],
  ])('leaves %s alone', (_name, ctl) => {
    render(ctl());
    expect(list().dataset.reorderable).toBeUndefined();
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
