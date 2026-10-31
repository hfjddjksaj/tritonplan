import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CourseOffering, PlanState, SectionOption, Term } from '@triton/shared';
import { SharedPlanView } from './SharedPlanView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FA: Term = { year: '2026', period: '2', label: 'Fall 2026' };

function course(code: string, title: string, option: SectionOption): CourseOffering {
  return {
    id: `${code}|2026|2`, moduleId: code, subject: code.split('-')[0]!, number: code.split('-')[1]!,
    courseCode: code, title, term: FA, units: 4, options: [option],
  };
}

/** CSE-100 with a chosen section that meets, has a final and two midterms; MATH-18 with no section chosen. */
function plan(): PlanState {
  const cse: SectionOption = {
    id: 'cse-a', code: 'A00', enrollCode: 'cse-a',
    components: [{
      id: 'E1', type: 'LE', typeText: 'Lecture', sectionCode: 'A00', instructors: ['Leo Porter'], rawSched: '',
      unscheduled: false,
      meetings: [{ days: ['Tue', 'Thu'], start: '11:00', end: '12:20', modality: 'In Person', building: 'CENTR', room: '115' }],
    }],
    final: { date: '2026-12-12', start: '08:00', end: '10:59' },
    // Out of order on purpose: the list reads earliest first.
    midterms: [
      { date: '2026-11-17', start: '19:00', end: '20:50' },
      { date: '2026-10-28', start: '11:00', end: '12:20' },
    ],
  };
  const math: SectionOption = { id: 'math-a', code: 'B00', enrollCode: 'math-a', components: [] };
  return {
    version: 1,
    term: FA,
    entries: [
      { course: course('CSE-100', 'Advanced Data Structures', cse), selectedOptionId: 'cse-a', color: '231' },
      { course: course('MATH-18', 'Linear Algebra', math), selectedOptionId: null },
    ],
  };
}

let container: HTMLDivElement;
let root: Root;
const onSave = vi.fn();

beforeEach(() => {
  onSave.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(p: PlanState = plan(), name = 'Fall draft') {
  act(() => root.render(<SharedPlanView name={name} plan={p} onSave={onSave} />));
}
const text = () => container.textContent ?? '';
const rows = () => [...container.querySelectorAll('.shared__course')];

describe('SharedPlanView', () => {
  it('names the plan, its term, and says it is read-only', () => {
    render();
    expect(container.querySelector('h1')?.textContent).toBe('Fall draft');
    expect(text()).toContain('Fall 2026 · shared with you · read-only');
  });

  it('lists every course with its title and chosen section, or says none was chosen', () => {
    render();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.textContent).toContain('CSE-100');
    expect(rows()[0]!.textContent).toContain('Advanced Data Structures');
    expect(rows()[0]!.textContent).toContain('A00');
    expect(rows()[1]!.textContent).toContain('MATH-18');
    expect(rows()[1]!.textContent).toContain('Linear Algebra');
    expect(rows()[1]!.textContent).toContain('no section chosen');
    expect(rows()[1]!.textContent).not.toContain('B00');
  });

  it('lists the final and midterms with their dates and times, earliest midterm first', () => {
    render();
    const exams = [...rows()[0]!.querySelectorAll('.shared__exam')].map((e) => e.textContent);
    expect(exams).toEqual([
      'Midterm 1 · Wed, Oct 28 · 11:00 AM – 12:20 PM',
      'Midterm 2 · Tue, Nov 17 · 7:00 PM – 8:50 PM',
      'Final · Sat, Dec 12 · 8:00 AM – 10:59 AM',
    ]);
    expect(rows()[1]!.querySelector('.shared__exam')).toBeNull();
  });

  it('a single midterm is just "Midterm"', () => {
    const p = plan();
    const opt = p.entries[0]!.course.options[0]!;
    opt.midterms = [opt.midterms![0]!];
    render(p);
    expect(rows()[0]!.textContent).toContain('Midterm · Tue, Nov 17 · 7:00 PM – 8:50 PM');
  });

  it('draws the week, and a block on it is not a control', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render();
    const blocks = [...container.querySelectorAll('.block')];
    expect(blocks).toHaveLength(2); // Tue + Thu
    expect(container.querySelector('.block button')).toBeNull();
    const before = container.innerHTML;
    act(() => (blocks[0] as HTMLElement).click());
    expect(open).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe(before);
  });

  it('a plan with nothing scheduled shows no planner "your week is open" prompt', () => {
    const p = plan();
    p.entries = [p.entries[1]!];
    render(p);
    expect(container.querySelector('.cal-wrap')).toBeNull();
    expect(text()).not.toContain('Your week is open');
  });

  it('Save to my account hands over to the caller', () => {
    render();
    const save = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save to my account');
    act(() => save!.click());
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
