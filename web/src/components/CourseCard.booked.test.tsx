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

  describe('when TSS disagrees with the student', () => {
    function render(booked: boolean, bookedByTss: boolean) {
      act(() => {
        root.render(
          <CourseCard
            entry={fullEntry()} index={0} conflicted={false}
            booked={booked} bookedByTss={bookedByTss} onToggleBooked={vi.fn()}
            onSelect={() => {}} onRemove={() => {}} onOpenTss={() => {}}
          />,
        );
      });
    }

    it('shows the standing unmark instead of leaving it invisible', () => {
      // An unmark used to show only as an ABSENT badge, which reads as TSS losing the
      // course — the misreading that sent three rounds after the capture pipeline.
      render(false, true);
      const tag = container.querySelector('.tag--unmarked');
      expect(tag?.textContent).toBe('Unmarked');
      expect(tag?.getAttribute('title')).toMatch(/TSS reports you are enrolled/);
      expect(container.querySelector('.tag--full')).toBeNull(); // one status badge only
    });

    it('offers to restore rather than to mark, when TSS already says booked', () => {
      render(false, true);
      const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'mark booked')!;
      expect(btn.getAttribute('title')).toMatch(/Restore CHEM-43A to booked/);
    });

    it('says nothing extra once the two agree', () => {
      render(true, true);
      expect(container.querySelector('.tag--booked')?.textContent).toBe('Booked');
      expect(container.querySelector('.tag--unmarked')).toBeNull();
    });

    it('a course TSS never reported keeps the plain Full treatment', () => {
      render(false, false);
      expect(container.querySelector('.tag--unmarked')).toBeNull();
      expect(container.querySelector('.tag--full')?.textContent).toBe('Full');
    });
  });
});
