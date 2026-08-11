/** Exam-location display: the polluted-modality split + the popover click. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FinalsView } from './FinalsView';
import type { FinalItem } from '../lib/plan';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = {
  courseId: 'CHEM-43A|2026|2', courseCode: 'CHEM-43A', title: 'Organic Chemistry',
  hue: 10, full: false,
};

describe('FinalsView exam location', () => {
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

  function renderFinals(
    finals: FinalItem[],
    onOpenLocation?: (l: { building: string; room?: string }) => void,
  ) {
    act(() => {
      root.render(
        <FinalsView finals={finals} conflicts={[]} onOpenCourse={() => {}} onOpenLocation={onOpenLocation} />,
      );
    });
  }

  it('splits an old-capture polluted modality into an "@" line + full-location button', () => {
    const onOpenLocation = vi.fn();
    renderFinals(
      [{ ...BASE, final: { date: '2026-12-05', start: '11:30', end: '14:29', modality: 'In Person @ York Hall Room 2622' } }],
      onOpenLocation,
    );
    expect(container.textContent).toContain('In Person @');
    const btn = [...container.querySelectorAll('button.final-row__loc')].find(
      (b) => b.textContent === 'York Hall Room 2622',
    ) as HTMLButtonElement | undefined;
    expect(btn).toBeTruthy();
    act(() => btn!.click());
    expect(onOpenLocation).toHaveBeenCalledWith({ building: 'York Hall', room: '2622' });
  });

  it('location-less finals render the modality exactly as before', () => {
    renderFinals([{ ...BASE, final: { date: '2026-12-05', start: '11:30', end: '14:29', modality: 'In Person' } }]);
    expect(container.textContent).toContain('In Person');
    expect(container.querySelector('.final-row__loc')).toBeNull();
  });
});
