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

  it('shows Conflict on the facts line, next to units and out of the action rows', () => {
    render({ conflicted: true });
    const facts = container.querySelector('.course-card__facts')!;
    expect(facts.querySelector('.tag--conflict')?.textContent).toBe('Conflict');
    expect(facts.querySelector('.tag--units')?.textContent).toBe('4 units');
    expect(container.querySelector('.course-card__actions .tag--conflict')).toBeNull();
  });

  it('keeps the facts line for a conflicted course that has no unit count', () => {
    const e = entry();
    delete (e.course as { units?: number }).units;
    render({ entry: e, conflicted: true });
    expect(container.querySelector('.course-card__facts .tag--conflict')).not.toBeNull();
  });

  it('drops the buttons it has no callback for instead of leaving a hole', () => {
    render({ onBook: undefined, readOnly: true, onToggleBooked: undefined });
    expect(actionLabels()).toEqual(['open in TSS', 'prerequisites']);
  });

  it('omits the facts line when the course carries no unit count', () => {
    const e = entry();
    delete (e.course as { units?: number }).units;
    render({ entry: e });
    expect(container.querySelector('.course-card__facts')).toBeNull();
  });

  it('keeps the seat-count age in the corner column, out of the reading flow', () => {
    const e = entry();
    e.course = { ...e.course, capturedAt: new Date(Date.now() - 3 * 3600_000).toISOString() };
    render({ entry: e });
    const fresh = container.querySelector('.course-card__side .course-card__fresh');
    expect(fresh?.textContent).toMatch(/^seats /);
    expect(container.querySelector('.course-card__facts')!.textContent).not.toContain('seats');
  });
});
