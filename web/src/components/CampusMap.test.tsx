import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CourseOffering, PlanState } from '@triton/shared';
import { makePlan } from '../lib/fixtures';
import { CampusMap } from './CampusMap';

/**
 * A course whose lecture meets in a real, matchable UCSD building — mirrors
 * `courseWithMeetings()` in `../lib/map-pins.test.ts`. `makePlan()` has zero
 * locatable pins, so it can't exercise anything that depends on a marker
 * actually landing on the map (this fixture stays local to this file).
 */
function courseWithMeeting(): CourseOffering {
  return {
    id: 'CSE-8A|2026|2',
    moduleId: '8461',
    subject: 'CSE',
    number: '8A',
    courseCode: 'CSE-8A',
    title: 'Intro to Programming',
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    units: 4,
    options: [
      {
        id: 'opt-1',
        code: 'P-001-001',
        enrollCode: 'SE00152185',
        components: [
          {
            id: 'E-1',
            type: 'LE',
            typeText: 'Lecture',
            sectionCode: 'A00',
            instructors: ['Ada Lovelace'],
            meetings: [
              {
                days: ['Mon'],
                start: '11:00',
                end: '11:50',
                modality: 'In Person',
                building: 'Center Hall',
                room: '109',
                location: 'Center Hall 109',
              },
            ],
          },
        ],
      },
    ],
  } as CourseOffering;
}

function planWithMeeting(): PlanState {
  const course = courseWithMeeting();
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }],
  };
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Let the dynamic geo import and its promise settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('CampusMap', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(over: Partial<Parameters<typeof CampusMap>[0]> = {}) {
    const plan: PlanState = makePlan();
    const onClose = vi.fn();
    act(() => {
      root.render(
        <CampusMap
          plan={plan} booked={new Set()} hasBookedData={true}
          readOnly={false} onClose={onClose} {...over}
        />,
      );
    });
    return onClose;
  }

  it('renders a titled dialog with a close button', async () => {
    const onClose = render();
    await settle();
    expect(container.querySelector('.campusmap')).not.toBeNull();
    const close = container.querySelector('.campusmap__close') as HTMLButtonElement;
    expect(close).not.toBeNull();
    act(() => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const onClose = render();
    await settle();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the booked-only toggle for your own plan', async () => {
    render();
    await settle();
    expect(container.querySelector('.campusmap__bookedtoggle')).not.toBeNull();
  });

  it('HIDES the booked-only toggle on someone else’s plan', async () => {
    render({ readOnly: true });
    await settle();
    expect(container.querySelector('.campusmap__bookedtoggle')).toBeNull();
  });

  it('hides the toggle when no booked data has ever been captured', async () => {
    render({ hasBookedData: false });
    await settle();
    expect(container.querySelector('.campusmap__bookedtoggle')).toBeNull();
    expect(container.textContent).toContain('Booked Courses');
  });

  it('shows an empty state for a plan with no locatable classes', async () => {
    render();
    await settle();
    // makePlan()'s course has no components, so nothing can be placed.
    expect(container.querySelector('.campusmap__empty')).not.toBeNull();
  });

  it('a nested popover eats the first Escape; the map only closes on the second', async () => {
    // hasBookedData: false so the booked-only toggle can't hide the marker we need to click.
    const onClose = render({ plan: planWithMeeting(), hasBookedData: false });
    await settle();

    const marker = container.querySelector('.campusmap__marker') as SVGGElement | null;
    expect(marker).not.toBeNull();
    act(() => {
      marker!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const directions = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Directions',
    ) as HTMLButtonElement | undefined;
    expect(directions).not.toBeUndefined();
    act(() => directions!.click());
    expect(container.querySelector('.mappop')).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('.mappop')).toBeNull(); // popover closed
    expect(container.querySelector('.campusmap')).not.toBeNull(); // map still mounted
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('explains a booked-only-hidden plan instead of claiming there is nothing to place', async () => {
    render({ plan: planWithMeeting(), hasBookedData: true, booked: new Set() });
    await settle();
    // hasBookedData: true + no prior choice ⇒ booked-only defaults on; the plan's one
    // class isn't booked, so it's filtered out — but it DOES exist, unlike makePlan().
    expect(container.textContent).toContain(
      'Booked only is on and nothing here is booked yet. Turn it off to see every course in your plan.',
    );
    expect(container.textContent).not.toContain('No class locations to place yet');
  });
});
