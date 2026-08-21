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

  describe('a course TSS itself reports as booked', () => {
    function render(bookedByTss: boolean) {
      act(() => {
        root.render(
          <CourseCard
            entry={fullEntry()} index={0} conflicted={false}
            booked={true} bookedByTss={bookedByTss} onToggleBooked={vi.fn()}
            onSelect={() => {}} onRemove={() => {}} onOpenTss={() => {}}
          />,
        );
      });
    }

    it('drops the toggle — enrolment is TSS\'s fact, not a preference', () => {
      render(true);
      expect(container.querySelector('.tag--booked')?.textContent).toBe('Booked');
      expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'unmark')).toBe(false);
    });

    it('keeps the toggle for a course TSS has said nothing about', () => {
      render(false);
      expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'unmark')).toBe(true);
    });
  });

  describe('booked, but not the section on the grid', () => {
    function render(bookedOptionCode?: string) {
      act(() => {
        root.render(
          <CourseCard
            entry={fullEntry()} index={0} conflicted={false}
            booked={true} bookedByTss={true}
            {...(bookedOptionCode ? { bookedOptionCode } : {})}
            onSelect={() => {}} onRemove={() => {}} onOpenTss={() => {}}
          />,
        );
      });
    }

    it('puts an alert chip beside Booked, naming the package TSS actually has', () => {
      render('P-002-004');
      const warn = container.querySelector('.tag--alert');
      expect(warn?.querySelector('svg')).not.toBeNull(); // drawn, not typed — see WarnCircle
      expect(warn?.tagName).toBe('BUTTON'); // opens the explanation, not hover-only
      // The hover wording lives in the tooltip layer now, not a `title`; the
      // package still has to be named to a screen reader either way.
      expect(warn?.getAttribute('title')).toBeNull();
      expect(warn?.getAttribute('aria-label')).toMatch(/TSS has P-002-004/);
    });

    it('opens a popover naming both packages, and offers only to show the list', () => {
      render('P-002-004');
      act(() => (container.querySelector('.tag--alert') as HTMLButtonElement).click());
      const pop = document.querySelector('.bookedpop');
      expect(pop?.textContent).toContain('P-002-004'); // what TSS has
      expect(pop?.textContent).toContain('P-001-001'); // what the plan shows
      // Nothing in here switches anything: the only action reveals the section list.
      const actions = [...pop!.querySelectorAll('.mappop__actions button')].map((b) => b.textContent);
      expect(actions).toEqual(['Show sections']);
    });

    it('stays quiet when the two agree — silence is the normal case', () => {
      render();
      expect(container.querySelector('.tag--alert')).toBeNull();
      expect(container.querySelector('.tag--booked')?.textContent).toBe('Booked');
    });
  });
});

describe('CourseCard waitlisted state', () => {
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

  function render(props: { booked?: boolean; waitlisted?: boolean; waitlistPosition?: number }) {
    act(() => {
      root.render(
        <CourseCard
          entry={fullEntry()} index={0} conflicted={false}
          booked={props.booked ?? false}
          waitlisted={props.waitlisted}
          waitlistPosition={props.waitlistPosition}
          onSelect={() => {}} onRemove={() => {}} onOpenTss={() => {}}
        />,
      );
    });
  }

  it('takes the badge slot from Full — a place in the queue is the better news', () => {
    render({ waitlisted: true });
    expect(container.querySelector('.tag--waitlisted')?.textContent).toBe('Waitlisted');
    expect(container.querySelector('.tag--full')).toBeNull();
    expect(container.querySelector('.tag--booked')).toBeNull();
  });

  it('does not grey the card out: the student has a place in this course', () => {
    render({ waitlisted: true });
    expect(container.querySelector('.course-card')!.classList.contains('course-card--full')).toBe(false);
  });

  it('never shows next to Booked — enrolled beats queued', () => {
    // Both at once would be TSS contradicting itself; the enrolment is the one
    // that decides what the student should do next.
    render({ booked: true, waitlisted: true });
    expect(container.querySelector('.tag--booked')?.textContent).toBe('Booked');
    expect(container.querySelector('.tag--waitlisted')).toBeNull();
  });

  it('keeps the queue position out of the badge, where it would go stale loudest', () => {
    render({ waitlisted: true, waitlistPosition: 3 });
    expect(container.querySelector('.tag--waitlisted')?.textContent).toBe('Waitlisted');
    expect(container.querySelector('.tag--waitlisted')?.getAttribute('aria-label')).toMatch(/3/);
  });

  it('hides the manual mark toggle — the queue is TSS\'s fact, not a preference', () => {
    render({ waitlisted: true });
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'mark booked')).toBe(false);
  });
});
