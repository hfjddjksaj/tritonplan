import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PositionedBlock } from '../lib/layout';
import { BlockSheet } from './BlockSheet';
import { CourseBlock } from './CourseBlock';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A full-size block (tall enough to show its teacher) in a matched building. */
function block(over: Partial<PositionedBlock> = {}): PositionedBlock {
  return {
    key: 'k', courseId: 'CSE-8A|2026|2', courseCode: 'CSE-8A', typeText: 'Lecture', type: 'LE', hue: 231,
    instructor: 'Leo Porter', location: 'Center Hall 109', building: 'Center Hall', room: '109',
    start: '11:00', end: '11:50', day: 'Mon', full: false,
    top: 0, height: 65, lane: 0, laneCount: 1, conflict: false,
    ...over,
  };
}

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
  document.body.innerHTML = '';
});

describe('CourseBlock teacher', () => {
  const handlers = () => ({ onOpen: vi.fn(), onOpenLocation: vi.fn(), onOpenInstructor: vi.fn(), onFocusCourse: vi.fn() });

  it('is a link to the course’s ratings, and the click stays on it', () => {
    const h = handlers();
    act(() => root.render(<CourseBlock block={block()} {...h} />));
    const link = container.querySelector<HTMLButtonElement>('button.block__instr--link')!;
    expect(link.textContent).toBe('Leo Porter');
    act(() => link.click());
    expect(h.onOpenInstructor).toHaveBeenCalledWith(block());
    expect(h.onFocusCourse).not.toHaveBeenCalled(); // not the block's own click
  });

  it('stays plain text for a TSS placeholder, without a handler, and on a phone', () => {
    const h = handlers();
    const cases = [
      <CourseBlock key="staff" block={block({ instructor: 'Staff' })} {...h} />,
      <CourseBlock key="none" block={block()} onOpen={h.onOpen} onFocusCourse={h.onFocusCourse} />,
      <CourseBlock key="phone" block={block()} {...h} onDetail={vi.fn()} />,
    ];
    for (const el of cases) {
      act(() => root.render(el));
      expect(container.querySelector('.block__instr--link')).toBeNull();
      expect(container.querySelector('.block__instr')!.tagName).toBe('DIV');
    }
  });
});

describe('BlockSheet teacher', () => {
  const props = () => ({
    onOpenCourse: vi.fn(), onOpenLocation: vi.fn(), onOpenInstructor: vi.fn(), onFocusCourse: vi.fn(), onClose: vi.fn(),
  });

  it('is a link to the course’s ratings', () => {
    const p = props();
    act(() => root.render(<BlockSheet block={block()} {...p} />));
    const link = document.body.querySelector<HTMLButtonElement>('button.blocksheet__instr--link')!;
    expect(link.textContent).toBe('Leo Porter');
    act(() => link.click());
    expect(p.onOpenInstructor).toHaveBeenCalledWith(block());
  });

  it('stays plain text for a TSS placeholder', () => {
    act(() => root.render(<BlockSheet block={block({ instructor: 'TBA' })} {...props()} />));
    expect(document.body.querySelector('.blocksheet__instr--link')).toBeNull();
    expect(document.body.querySelector('.blocksheet__instr')!.textContent).toBe('TBA');
  });
});
