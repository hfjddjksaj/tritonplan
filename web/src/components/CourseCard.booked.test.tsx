import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanEntry } from '@triton/shared';
import { makeCourse } from '../lib/fixtures';
import { CourseCard } from './CourseCard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Entry whose EVERY option has zero seats — courseFull(course) === true. */
function fullEntry(): PlanEntry {
  const course = makeCourse('CHEM-43A');
  course.options = course.options.map((o) => ({ ...o, seatsAvailable: 0, limit: 23 }));
  return { course, selectedOptionId: course.options[0]!.id, color: '10' };
}

describe('CourseCard booked state', () => {
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

  function renderCard(booked: boolean, onToggleBooked = vi.fn()) {
    act(() => {
      root.render(
        <CourseCard
          entry={fullEntry()} index={0} conflicted={false}
          booked={booked} onToggleBooked={onToggleBooked}
          onSelect={() => {}} onRemove={() => {}} onOpenTss={() => {}}
        />,
      );
    });
    return onToggleBooked;
  }

  it('booked replaces Full: green badge, no gray card, selected code not grayed', () => {
    renderCard(true);
    expect(container.querySelector('.tag--booked')?.textContent).toBe('Booked');
    expect(container.querySelector('.tag--full')).toBeNull();
    expect(container.querySelector('.course-card')!.classList.contains('course-card--full')).toBe(false);
    expect(container.querySelector('.picker__selected--full')).toBeNull(); // collapsed by default
  });

  it('not booked + all sections 0 seats keeps today\'s Full treatment', () => {
    renderCard(false);
    expect(container.querySelector('.tag--full')?.textContent).toBe('Full');
    expect(container.querySelector('.tag--booked')).toBeNull();
    expect(container.querySelector('.course-card')!.classList.contains('course-card--full')).toBe(true);
    expect(container.querySelector('.picker__selected--full')).not.toBeNull();
  });

  it('the action-row toggle reads "mark booked" / "unmark" and fires the callback', () => {
    const spy = renderCard(false);
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'mark booked')!;
    act(() => btn.click());
    expect(spy).toHaveBeenCalledTimes(1);
    renderCard(true);
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'unmark')).toBe(true);
  });
});
