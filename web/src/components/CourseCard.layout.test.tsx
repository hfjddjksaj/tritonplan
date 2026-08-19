import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanEntry } from '@triton/shared';
import { makeCourse } from '../lib/fixtures';
import { CourseCard } from './CourseCard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function entry(): PlanEntry {
  const course = makeCourse('CHEM-114A', 'CHEM-114A', 4);
  return { course, selectedOptionId: course.options[0]!.id, color: '231' };
}

/**
 * The head is identity + facts; the actions are a separate two-column grid. The old
 * single wrapping row put "4 units" among the buttons and let the last one run past
 * the card edge, where overflow:hidden cut it in half.
 */
describe('CourseCard head/action split', () => {
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

  function render(props: Partial<Parameters<typeof CourseCard>[0]> = {}) {
    act(() => {
      root.render(
        <CourseCard
          entry={entry()} index={0} conflicted={false} booked={false}
          onToggleBooked={vi.fn()} onBook={vi.fn()}
          onSelect={() => {}} onRemove={() => {}} onOpenTss={() => {}}
          {...props}
        />,
      );
    });
  }

  const actionLabels = () =>
    [...container.querySelectorAll('.course-card__actions .course-card__tss')].map((b) =>
      b.textContent!.trim(),
    );

  it('orders the actions open in TSS, book section, prerequisites, mark booked', () => {
    render();
    expect(actionLabels()).toEqual([
      'open in TSS',
      'book section',
      'prerequisites',
      'mark booked',
    ]);
  });

  it('keeps units out of the action row — it is a fact, not a control', () => {
    render();
    expect(container.querySelector('.course-card__actions')!.textContent).not.toContain('units');
    expect(container.querySelector('.course-card__facts')!.textContent).toContain('4 units');
  });

  it('shows Conflict as a status badge beside the course code', () => {
    render({ conflicted: true });
    const codeline = container.querySelector('.course-card__codeline')!;
    expect(codeline.querySelector('.tag--conflict')?.textContent).toBe('Conflict');
    expect(container.querySelector('.course-card__actions .tag--conflict')).toBeNull();
  });

  it('drops the buttons it has no callback for instead of leaving a hole', () => {
    render({ onBook: undefined, readOnly: true, onToggleBooked: undefined });
    expect(actionLabels()).toEqual(['open in TSS', 'prerequisites']);
  });

  it('omits the facts line entirely when the course carries neither units nor a capture time', () => {
    const e = entry();
    delete (e.course as { units?: number }).units;
    render({ entry: e });
    expect(container.querySelector('.course-card__facts')).toBeNull();
  });
});
