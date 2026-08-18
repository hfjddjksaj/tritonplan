import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CourseOffering, PlanState } from '@triton/shared';
import { makePlan } from '../lib/fixtures';
import { FakeMap, fakeMapLibreModule } from '../test/fake-maplibre';
vi.mock('maplibre-gl', () => fakeMapLibreModule);
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

/**
 * A course whose meeting cites a building `matchBuilding()` cannot resolve, so its pin's
 * `coords` stays null — it can never land on the canvas, booked-only or not.
 */
function planWithUnlocatableMeeting(): PlanState {
  const course = courseWithMeeting();
  const meeting = course.options[0]!.components[0]!.meetings[0]!;
  meeting.building = 'A Building That Does Not Exist';
  meeting.location = 'A Building That Does Not Exist 000';
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }],
  };
}

/**
 * A course meeting at UCSD Health's Hillcrest campus — a real, matchable building
 * in the shipped point data that projects far outside the framed academic core.
 */
function planOffTheMap(): PlanState {
  const course = courseWithMeeting();
  const meeting = course.options[0]!.components[0]!.meetings[0]!;
  meeting.building = '304 Arbor Drive';
  meeting.room = '1';
  meeting.location = '304 Arbor Drive 1';
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }],
  };
}

/** A fully online lecture: no building, and none was ever expected. */
function planOnline(): PlanState {
  const course = courseWithMeeting();
  const meeting = course.options[0]!.components[0]!.meetings[0]!;
  meeting.modality = 'Live Online';
  meeting.building = undefined;
  meeting.room = undefined;
  meeting.location = undefined;
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }],
  };
}

/** A final in York Hall (a real, matchable building) on Wed Dec 09, structured fields. */
function planWithFinal(): PlanState {
  const course = courseWithMeeting();
  course.options[0]!.final = {
    date: '2026-12-09',
    start: '11:30',
    end: '14:29',
    modality: 'In Person',
    location: 'York Hall Room 2622',
    building: 'York Hall',
    room: '2622',
  };
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }],
  };
}

/** Two dated midterms in Center Hall: Sat Oct 31 (week of Oct 26) and Sat Nov 14 (week of Nov 09). */
function planWithMidterms(): PlanState {
  const course = courseWithMeeting();
  course.options[0]!.components[0]!.rawSched =
    'Midterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person @ Center Hall Room 109\n' +
    'Midterm Examination 11/14/2026 10:00 AM - 11:50 AM In Person @ Center Hall Room 109';
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }],
  };
}

/** Two dated midterms whose Sched lines stop at the modality — TSS listed no room at all. */
function planWithUnroomedMidterms(): PlanState {
  const course = courseWithMeeting();
  course.options[0]!.components[0]!.rawSched =
    'Midterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person\n' +
    'Midterm Examination 11/14/2026 10:00 AM - 11:50 AM In Person';
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }],
  };
}

/** One midterm in Center Hall, one with no place at all. */
function planWithMixedMidterms(): PlanState {
  const course = courseWithMeeting();
  course.options[0]!.components[0]!.rawSched =
    'Midterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person @ Center Hall Room 109\n' +
    'Midterm Examination 11/14/2026 10:00 AM - 11:50 AM In Person';
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }],
  };
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * One turn of the loop, wide enough for a dynamic import AND for jsdom's rAF:
 * `useMapLibre` throttles its camera ticks on requestAnimationFrame, which
 * jsdom backs with a real ~16.7 ms interval, so a 0 ms timeout has no
 * guaranteed budget to let one fire.
 */
async function pump() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
  });
}

/**
 * Let the dynamic geo/map imports, the GL map's construction and its `load`
 * settle (a cold import can take a few ticks). The loading pane goes away
 * exactly when the map's `load` has fired, so waiting on it waits on the map
 * existing AND being ready. Throws rather than returning quietly: a map that
 * stopped being constructed should fail here, by name, instead of leaving
 * every later line to die on an undefined `FakeMap.instances[0]`.
 */
async function settle() {
  for (let i = 0; i < 40; i++) {
    await pump();
    if (FakeMap.instances.length > 0 && !document.querySelector('.campusmap__loading')) return;
  }
  throw new Error('map never became ready');
}

/**
 * Wait only for the map to be CONSTRUCTED — for the no-WebGL case, where
 * `FakeMap.autoLoad = false` means `load` never fires and {@link settle} would
 * (correctly) time out.
 */
async function settleConstructed() {
  for (let i = 0; i < 40; i++) {
    await pump();
    if (FakeMap.instances.length > 0) return;
  }
  throw new Error('map was never constructed');
}

function tabNamed(name: string): HTMLButtonElement {
  return [...document.querySelectorAll('.campusmap__island [role="tab"]')].find(
    (t) => t.textContent === name,
  ) as HTMLButtonElement;
}
function sliceButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('.campusmap__slices .calseg__btn')] as HTMLButtonElement[];
}
function sliceOn(): string {
  return sliceButtons().find((b) => b.classList.contains('calseg__btn--on'))!.textContent ?? '';
}

describe('CampusMap', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    localStorage.clear();
    FakeMap.reset();
    // The map opens on today's weekday when it has classes; pin "today" to a
    // Sunday so every test starts on "All" whatever day it actually runs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 7, 16, 12));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render(over: Partial<Parameters<typeof CampusMap>[0]> = {}) {
    const plan: PlanState = makePlan();
    const onClose = vi.fn();
    act(() => {
      root.render(
        <CampusMap
          plan={plan} booked={new Set()}
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

  it('shows the booked-only toggle once anything is booked, however it got booked', async () => {
    // Manual "mark booked" in the rail counts — the extension feed is not required.
    render({ booked: new Set(['CSE-8A|2026|2']) });
    await settle();
    expect(container.querySelector('.campusmap__bookedtoggle')).not.toBeNull();
  });

  it('HIDES the booked-only toggle on someone else’s plan', async () => {
    render({ readOnly: true, booked: new Set(['CSE-8A|2026|2']) });
    await settle();
    expect(container.querySelector('.campusmap__bookedtoggle')).toBeNull();
  });

  it('hides the toggle when nothing is booked, even if the feed was captured', async () => {
    render({ booked: new Set() });
    await settle();
    expect(container.querySelector('.campusmap__bookedtoggle')).toBeNull();
    // And there is no nudge to go and "open" anything — the feed loads by itself.
    expect(container.textContent).not.toContain('Booked Courses');
  });

  it('draws every course in the plan by default — booked-only starts off', async () => {
    // Something IS booked (so the toggle shows), just not the class on this plan.
    render({ plan: planWithMeeting(), booked: new Set(['MATH-20C|2026|2']) });
    await settle();
    const toggle = container.querySelector('.campusmap__bookedtoggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(1);
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(0);
  });

  it('shows an empty state for a plan with no locatable classes', async () => {
    render();
    await settle();
    // makePlan()'s course has no components, so nothing can be placed.
    expect(container.querySelector('.campusmap__empty')).not.toBeNull();
  });

  it('Escape peels one layer at a time: popover, then the marker card, then the map', async () => {
    // Nothing booked ⇒ no booked-only toggle can hide the marker we need to click.
    const onClose = render({ plan: planWithMeeting() });
    await settle();

    const marker = container.querySelector('.campusmap__marker') as HTMLElement | null;
    expect(marker).not.toBeNull();
    act(() => {
      marker!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.campusmap__card')).not.toBeNull();

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
    expect(container.querySelector('.campusmap__card')).not.toBeNull(); // card still open
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('.campusmap__card')).toBeNull(); // card closed
    expect(container.querySelector('.campusmap')).not.toBeNull(); // map still mounted
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('grows the clicked marker into a card on the map, not a box under it', async () => {
    const plan = planWithMeeting();
    // A second component of the same course in the same building, and a second
    // course there too: one card, two same-size headings, rooms only, no times.
    const opt = plan.entries[0]!.course.options[0]!;
    opt.components.push({
      ...opt.components[0]!,
      id: 'E-2',
      type: 'DI',
      typeText: 'Discussion',
      sectionCode: 'A01',
      meetings: [{ ...opt.components[0]!.meetings[0]!, days: ['Wed'], room: '212', location: 'Center Hall 212' }],
    });
    const other = courseWithMeeting();
    other.id = 'MATH-20C|2026|2';
    other.courseCode = 'MATH-20C';
    other.options[0]!.components[0]!.meetings[0]!.room = '105';
    plan.entries.push({ course: other, selectedOptionId: other.options[0]!.id, color: '12' });

    render({ plan });
    await settle();
    expect(container.querySelector('.campusmap__detail')).toBeNull();
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(1);
    expect(container.querySelector('.campusmap__card')).toBeNull();
    // The marker is a focusable div with a button role, in the overlay above the GL canvas.
    const marker = container.querySelector('.campusmap__overlay .campusmap__marker')!;
    expect(marker.tagName).toBe('DIV');
    expect(marker.getAttribute('role')).toBe('button');

    act(() => {
      marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const card = container.querySelector('.campusmap__card')!;
    expect(card).not.toBeNull();
    // The card stands in for the chip.
    expect(container.querySelector('.campusmap__chip')).toBeNull();
    const heads = [...card.querySelectorAll('.campusmap__card-code')].map((h) => h.textContent);
    expect(heads).toEqual(['CSE-8A', 'MATH-20C']);
    const rows = [...card.querySelectorAll('.campusmap__card-rows li')].map((li) => li.textContent);
    expect(rows).toEqual(['LEC · Room 109', 'DIS · Room 212', 'LEC · Room 105']);
    expect(card.textContent).not.toContain('11:00');
    // The building's name heads the card, with Directions as the one primary action.
    expect(card.querySelector('.campusmap__card-place')!.textContent).toBe('Center Hall');
    expect(card.querySelectorAll('.campusmap__card-dir')).toHaveLength(1);
    const dir = card.querySelector('.campusmap__card-dir')!;
    expect(dir.textContent).toBe('Directions');
    expect(dir.classList.contains('btn--primary')).toBe(true);
    // The card is positioned in canvas px, off the marker.
    expect((card as HTMLElement).style.left).toMatch(/px$/);

    // A click on the map background closes it, and the chip comes back.
    act(() => {
      FakeMap.instances[0]!.fire('click', {});
    });
    expect(container.querySelector('.campusmap__card')).toBeNull();
    expect(container.querySelector('.campusmap__chip')).not.toBeNull();
  });

  it('floats a control island over the map: title, the view tabs, the day filter', async () => {
    render({ plan: planWithMeeting() });
    await settle();
    // Island and stage are siblings; the island comes first for tab order.
    const root = container.querySelector('.campusmap')!;
    const island = root.children[0]!;
    expect(island.classList.contains('campusmap__island')).toBe(true);
    expect(root.querySelector('.campusmap__bar')).toBeNull();
    expect(root.querySelector('.campusmap__hint')).toBeNull();
    expect(island.querySelector('.campusmap__title')!.textContent).toBe('Campus map');
    // The same segmented control as the planner toolbar, reading Classes here;
    // Midterms / Finals switch what the map shows.
    const tabs = [...island.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    expect(tabs.map((t) => t.textContent)).toEqual(['Classes', 'Midterms', 'Finals']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.disabled)).toEqual([false, false, false]);
    // The day filter is the small segmented control (calseg), All first.
    const days = [...island.querySelectorAll('.campusmap__slices .calseg__btn')] as HTMLButtonElement[];
    expect(days.map((d) => d.textContent)).toEqual(['All', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(days[0]!.classList.contains('calseg__btn--on')).toBe(true);
    act(() => days[1]!.click());
    expect(days[1]!.classList.contains('calseg__btn--on')).toBe(true);
    expect(days[0]!.classList.contains('calseg__btn--on')).toBe(false);
  });

  it('collapses the island to its title row plus a one-line summary of the view', async () => {
    render({ plan: planWithMeeting() });
    await settle();
    const island = container.querySelector('.campusmap__island')!;
    const fold = island.querySelector('.campusmap__collapse') as HTMLButtonElement;
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(island.querySelector('.campusmap__summary')).toBeNull();
    // Pick a day first: the summary should say what the map is filtered to.
    const mon = [...island.querySelectorAll('.calseg__btn')].find((b) => b.textContent === 'Mon') as HTMLButtonElement;
    act(() => mon.click());
    act(() => fold.click());
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(island.querySelector('[role="tablist"]')).toBeNull();
    expect(island.querySelector('.campusmap__slices')).toBeNull();
    expect(island.querySelector('.campusmap__summary')!.textContent).toBe('Classes · Mon');
    // Title row survives, with the count.
    expect(island.querySelector('.campusmap__title')!.textContent).toBe('Campus map');
    expect(island.querySelector('.campusmap__count')).not.toBeNull();
    act(() => fold.click());
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(island.querySelector('.campusmap__summary')).toBeNull();
    // Still on Mon after unfolding.
    const monAgain = [...island.querySelectorAll('.calseg__btn')].find((b) => b.textContent === 'Mon')!;
    expect(monAgain.classList.contains('calseg__btn--on')).toBe(true);
  });

  it('puts the compass between Booked only and the close button in the top-right cluster', async () => {
    render({ plan: planWithMeeting(), booked: new Set(['CSE-8A|2026|2']) });
    await settle();
    const cluster = container.querySelector('.campusmap__cluster')!;
    const kinds = [...cluster.children].map((el) =>
      el.classList.contains('campusmap__bookedtoggle')
        ? 'booked'
        : el.classList.contains('campusmap__compass')
          ? 'compass'
          : el.classList.contains('campusmap__close')
            ? 'close'
            : el.className,
    );
    expect(kinds).toEqual(['booked', 'compass', 'close']);
    // Phase 1 wires it to "put north back up"; Phase 2 makes it spin with the bearing.
    const compass = cluster.querySelector('.campusmap__compass') as HTMLButtonElement;
    expect(compass.tagName).toBe('BUTTON');
    expect(compass.getAttribute('aria-label')).toBe('Reset north');
  });

  it('explains a booked-only-hidden plan instead of claiming there is nothing to place', async () => {
    render({ plan: planWithMeeting(), booked: new Set(['MATH-20C|2026|2']) });
    await settle();
    act(() => (container.querySelector('.campusmap__bookedtoggle') as HTMLButtonElement).click());
    // Booked-only on; the plan's one class isn't booked, so it's filtered out — but it
    // DOES exist, unlike makePlan().
    expect(container.textContent).toContain(
      'Booked only is on and nothing here is booked yet. Turn it off to see every course in your plan.',
    );
    expect(container.textContent).not.toContain('No class locations to place yet');
  });

  it('never marks a pin booked on someone else’s plan, even in a course you take', async () => {
    const mine = new Set(['CSE-8A|2026|2']);
    // Control: on YOUR plan the solid dot is exactly the point.
    render({ plan: planWithMeeting(), booked: mine });
    await settle();
    expect(container.querySelectorAll('.campusmap__marker--booked')).toHaveLength(1);

    // Read-only: same course, same booked set, but the plan is someone else's — so
    // your enrolment says nothing about it and must not be painted onto it (§5.4).
    render({ plan: planWithMeeting(), booked: mine, readOnly: true });
    await settle();
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(1);
    expect(container.querySelectorAll('.campusmap__marker--booked')).toHaveLength(0);
  });

  it('abbreviates a long building name on the card instead of cutting it off', async () => {
    const plan = planWithMeeting();
    const meeting = plan.entries[0]!.course.options[0]!.components[0]!.meetings[0]!;
    meeting.building = 'Computer Science and Engineering Building';
    meeting.location = 'Computer Science and Engineering Building 1202';
    render({ plan });
    await settle();
    act(() => {
      container.querySelector('.campusmap__marker')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.campusmap__card-place')!.textContent).toBe('Computer Science & Eng Bldg');
  });

  it('counts buildings in English', async () => {
    render({ plan: planWithMeeting() });
    await settle();
    expect(container.querySelector('.campusmap__count')!.textContent).toBe('1 building');
  });

  it('lists a class outside the mapped area instead of counting it as drawn', async () => {
    render({ plan: planOffTheMap() });
    await settle();
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(0);
    expect(container.querySelector('.campusmap__count')!.textContent).toBe('nothing to show');
    // Collapsed to a pill over the map until asked for.
    const pill = container.querySelector('.campusmap__unlocated-toggle') as HTMLButtonElement;
    expect(pill.textContent).toContain('1 not on the map');
    expect(container.querySelector('.campusmap__unlocated-list')).toBeNull();
    act(() => pill.click());
    expect(container.textContent).toContain('304 Arbor Drive — outside the mapped area');
    expect(container.textContent).not.toContain('No class locations to place yet');
    act(() => pill.click());
    expect(container.querySelector('.campusmap__unlocated-list')).toBeNull();
  });

  it('says an online class is online rather than calling it unplaceable', async () => {
    render({ plan: planOnline() });
    await settle();
    act(() => (container.querySelector('.campusmap__unlocated-toggle') as HTMLButtonElement).click());
    expect(container.textContent).toContain('Live Online');
    expect(container.textContent).not.toContain('no location listed in TSS');
  });

  it('shows no pill at all when everything is on the map', async () => {
    render({ plan: planWithMeeting() });
    await settle();
    expect(container.querySelector('.campusmap__unlocated')).toBeNull();
  });

  it('does not blame booked-only when the only class was never locatable to begin with', async () => {
    // Booked-only on, but the course's building can't be matched — turning the toggle
    // off would NOT put it on the map, so the booked-only explanation would be a lie.
    // The generic empty state is the honest one.
    render({ plan: planWithUnlocatableMeeting(), booked: new Set(['MATH-20C|2026|2']) });
    await settle();
    act(() => (container.querySelector('.campusmap__bookedtoggle') as HTMLButtonElement).click());
    expect(container.textContent).not.toContain(
      'Booked only is on and nothing here is booked yet',
    );
    expect(container.textContent).toContain('No class locations to place yet');
  });

  it('applies host colours to the map once it is ready', async () => {
    await act(async () =>
      root.render(
        <CampusMap plan={planWithMeeting()} booked={new Set()} readOnly={false} onClose={() => {}} />,
      ),
    );
    await settle();
    const filters = FakeMap.instances[0]!.calls.filter(
      (c) => c.method === 'setFilter' && c.args[0] === 'hosts',
    );
    expect(JSON.stringify(filters.at(-1)!.args[1])).toContain('Center Hall');
  });

  it('shows the WebGL message, with the buildings as text, when the map never starts', async () => {
    // What a browser with no WebGL2 actually does: the map object is built, it
    // reports an error, and `load` never comes. There is no camera, so no home
    // frame either — which is exactly the case the fallback list's "every located
    // group" branch exists for, since nothing can be classed on-canvas yet.
    FakeMap.autoLoad = false;
    await act(async () =>
      root.render(
        <CampusMap plan={planWithMeeting()} booked={new Set()} readOnly={false} onClose={() => {}} />,
      ),
    );
    await settleConstructed();
    await act(async () => {
      FakeMap.instances[0]!.fire('error', { error: new Error('WebGL2 unavailable') });
    });
    const box = container.querySelector('.campusmap__nogl')!;
    expect(box.textContent).toContain('The campus map needs WebGL');
    expect(box.textContent).toContain('Center Hall');
    expect(container.querySelector('.campusmap__marker')).toBeNull();
    // It replaces the loading pane rather than sitting beside it.
    expect(container.querySelector('.campusmap__loading')).toBeNull();
  });

  it('still names the sittings TSS has not roomed when the map never starts', async () => {
    // The centred "No rooms from TSS yet" island lives inside the ready branch, so
    // in the WebGL fallback it cannot render — and the fallback's own list only
    // names LOCATED buildings. If the flag that suppresses the bottom-left island
    // were not tied to that branch, a Midterms view whose sittings TSS hasn't
    // roomed would explain itself nowhere at all.
    FakeMap.autoLoad = false;
    render({ plan: planWithUnroomedMidterms(), initialView: 'midterms' });
    await settleConstructed();
    // Same reasoning one step earlier: while the map is still loading there is no
    // home frame either, and the island must already be speaking.
    expect(container.querySelector('.campusmap__loading')).not.toBeNull();
    expect(container.querySelector('.campusmap__noroom-toggle')).not.toBeNull();
    await act(async () => {
      FakeMap.instances[0]!.fire('error', { error: new Error('WebGL2 unavailable') });
    });
    expect(container.querySelector('.campusmap__nogl')).not.toBeNull();
    // Not the centred island — it is not in the branch that rendered.
    expect(container.querySelector('.campusmap__empty--noroom')).toBeNull();
    // So the bottom-left island has to take over.
    const pill = container.querySelector('.campusmap__noroom-toggle') as HTMLButtonElement;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('2 without a room yet');
    act(() => pill.click());
    expect(container.textContent).toContain('CSE-8A Midterm 1 — no room listed in TSS yet');
    expect(container.textContent).toContain('CSE-8A Midterm 2 — no room listed in TSS yet');
  });

  it('keeps a loaded map — and its markers and controls — through a recoverable error', async () => {
    // A glyph, sprite or source failure arrives on the very same `error` event as
    // a fatal one. Swapping a working map for the no-WebGL panel over one 404
    // would be a lie to the student and would take their markers with it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () =>
      root.render(
        <CampusMap plan={planWithMeeting()} booked={new Set()} readOnly={false} onClose={() => {}} />,
      ),
    );
    await settle();
    await act(async () => {
      FakeMap.instances[0]!.fire('error', {
        error: new Error('Failed to load glyph range 0-255'),
      });
    });
    expect(container.querySelector('.campusmap__nogl')).toBeNull();
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(1);
    expect(container.querySelector('.campusmap__zoom')).not.toBeNull();
    expect(container.querySelector('.campusmap__attrib')).not.toBeNull();
    // Not fatal, but not swallowed either.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to load glyph range 0-255'));
    warn.mockRestore();
  });

  it('deselects the open marker on a background click', async () => {
    await act(async () =>
      root.render(
        <CampusMap plan={planWithMeeting()} booked={new Set()} readOnly={false} onClose={() => {}} />,
      ),
    );
    await settle();
    await act(async () => {
      container.querySelector('.campusmap__marker')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.campusmap__card')).not.toBeNull();
    await act(async () => {
      FakeMap.instances[0]!.fire('click', {});
    });
    expect(container.querySelector('.campusmap__card')).toBeNull();
  });

  it('zoom buttons drive the map and ⟲ lights up once the student has moved it, by any control', async () => {
    await act(async () =>
      root.render(
        <CampusMap plan={planWithMeeting()} booked={new Set()} readOnly={false} onClose={() => {}} />,
      ),
    );
    await settle();
    const map = FakeMap.instances[0]!;
    const z0 = map.getZoom();
    await act(async () => (container.querySelector('button[aria-label="Zoom in"]') as HTMLButtonElement).click());
    expect(map.getZoom()).toBeGreaterThan(z0);
    const reset = container.querySelector('button[aria-label="Reset view"]') as HTMLButtonElement;
    expect(reset.disabled).toBe(false); // ⊕ counts as moving the view
    await act(async () => {
      map.simulateUserPan(0.01, 0);
    });
    await settle();
    expect(reset.disabled).toBe(false);
    await act(async () => reset.click());
    await settle();
    expect(reset.disabled).toBe(true);
  });

  it('opens on the view it was given', async () => {
    // (The default — Classes — is already asserted by 'floats a control island…' above.
    // Do NOT re-render the same root with a different initialView: it is initial state,
    // a prop change after mount is deliberately ignored.)
    render({ plan: planWithFinal(), initialView: 'finals' });
    await settle();
    expect(tabNamed('Finals').getAttribute('aria-selected')).toBe('true');
    expect(tabNamed('Classes').getAttribute('aria-selected')).toBe('false');
  });

  it('Finals: exam chips, date slices, "Filter by date", and the folded summary names the view', async () => {
    render({ plan: planWithFinal() });
    await settle();
    // Classes view: the Monday lecture is on the map, the final is not.
    expect(container.querySelector('.campusmap__chiplabel')!.textContent).toBe('LEC');
    act(() => tabNamed('Finals').click());
    expect(tabNamed('Finals').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.campusmap__chiplabel')!.textContent).toBe('Final');
    expect(container.querySelector('.campusmap__chipcode')!.textContent).toBe('CSE-8A');
    expect(sliceButtons().map((b) => b.textContent)).toEqual(['All', 'Dec 09']);
    expect(container.querySelector('.campusmap__slices')!.getAttribute('aria-label')).toBe('Filter by date');
    act(() => sliceButtons()[1]!.click());
    act(() => (container.querySelector('.campusmap__collapse') as HTMLButtonElement).click());
    expect(container.querySelector('.campusmap__summary')!.textContent).toBe('Finals · Dec 09');
  });

  it('Midterms: one slice per Mon–Sun week that has an exam, "Filter by week"', async () => {
    render({ plan: planWithMidterms() });
    await settle();
    act(() => tabNamed('Midterms').click());
    expect(sliceButtons().map((b) => b.textContent)).toEqual(['All', 'Oct 26–Nov 01', 'Nov 09–15']);
    expect(container.querySelector('.campusmap__slices')!.getAttribute('aria-label')).toBe('Filter by week');
    // Both sittings are in Center Hall: one marker, its chip counts them.
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(1);
    act(() => sliceButtons()[2]!.click());
    expect(container.querySelector('.campusmap__chiplabel')!.textContent).toBe('Midterm 2');
    act(() => tabNamed('Classes').click());
    expect(container.querySelector('.campusmap__slices')!.getAttribute('aria-label')).toBe('Filter by day');
  });

  it('opens on today’s exam date when the map opens on Finals on that day', async () => {
    vi.setSystemTime(new Date(2026, 11, 9, 9)); // Wed Dec 09 — the day of the final
    render({ plan: planWithFinal(), initialView: 'finals' });
    await settle();
    expect(sliceOn()).toBe('Dec 09');
  });

  it('says why an exam view is empty, per view', async () => {
    render({ plan: planWithMeeting() }); // classes only: no midterm, no final
    await settle();
    expect(container.querySelector('.campusmap__empty')).toBeNull();
    act(() => tabNamed('Midterms').click());
    expect(container.querySelector('.campusmap__empty')!.textContent).toBe(
      'No midterm locations yet — TSS hasn’t announced a dated midterm for these courses.',
    );
    act(() => tabNamed('Finals').click());
    expect(container.querySelector('.campusmap__empty')!.textContent).toBe(
      'No final exam locations yet. Pick sections that carry a final and they’ll appear here.',
    );
  });

  it('Booked only filters exam views too', async () => {
    render({ plan: planWithFinal(), booked: new Set(['MATH-20C|2026|2']) });
    await settle();
    act(() => tabNamed('Finals').click());
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(1);
    act(() => (container.querySelector('.campusmap__bookedtoggle') as HTMLButtonElement).click());
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(0);
    expect(container.textContent).toContain('Booked only is on and nothing here is booked yet');
  });

  it('the marker card in an exam view is dated on the code row', async () => {
    render({ plan: planWithFinal(), initialView: 'finals' });
    await settle();
    act(() => {
      container.querySelector('.campusmap__marker')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const card = container.querySelector('.campusmap__card')!;
    expect(card.querySelector('.campusmap__card-place')!.textContent).toBe('York Hall');
    expect(card.querySelector('.campusmap__card-date')!.textContent).toBe('Wed Dec 09');
    expect([...card.querySelectorAll('.campusmap__card-rows li')].map((li) => li.textContent)).toEqual(['Final · Room 2622']);
  });

  it('re-runs the today rule when the tab changes: All on Classes, today’s date on Finals', async () => {
    vi.setSystemTime(new Date(2026, 11, 9, 9)); // Wed Dec 09, the final's day; the Monday lecture isn't today
    render({ plan: planWithFinal() });
    await settle();
    expect(sliceOn()).toBe('All');
    act(() => tabNamed('Finals').click());
    expect(sliceOn()).toBe('Dec 09');
    // …and back: Classes has nothing today, so it opens on All again.
    act(() => tabNamed('Classes').click());
    expect(sliceOn()).toBe('All');
  });

  it('Midterms opens on this week’s bucket when it has a sitting, whatever was picked before', async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 9)); // Wed Oct 28: the week of the Oct 31 midterm
    render({ plan: planWithMidterms() });
    await settle();
    act(() => tabNamed('Midterms').click());
    expect(sliceOn()).toBe('Oct 26–Nov 01');
    // A pick sticks within the view…
    act(() => sliceButtons()[2]!.click());
    expect(sliceOn()).toBe('Nov 09–15');
    // …but leaving and coming back re-runs the rule.
    act(() => tabNamed('Finals').click());
    act(() => tabNamed('Midterms').click());
    expect(sliceOn()).toBe('Oct 26–Nov 01');
  });

  it('keeps the pick when the active tab is clicked again', async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 9)); // Wed Oct 28: the week of the Oct 31 midterm
    render({ plan: planWithMidterms() });
    await settle();
    act(() => tabNamed('Midterms').click());
    act(() => sliceButtons()[2]!.click());
    expect(sliceOn()).toBe('Nov 09–15');
    act(() => tabNamed('Midterms').click()); // still in the view: nothing to re-run
    expect(sliceOn()).toBe('Nov 09–15');
  });

  it('a card left open in one view does not survive a tab switch: Escape then closes the map', async () => {
    const onClose = render({ plan: planWithFinal() });
    await settle();
    act(() => {
      container.querySelector('.campusmap__marker')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.campusmap__card')).not.toBeNull();
    act(() => tabNamed('Finals').click());
    expect(container.querySelector('.campusmap__card')).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    // …and coming back does not resurrect it.
    act(() => tabNamed('Classes').click());
    expect(container.querySelector('.campusmap__card')).toBeNull();
  });

  it('a pick yields while Booked only hides its slice, and returns when Booked only is lifted', async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 9)); // Wed Oct 28: the week of the Oct 31 midterm
    render({ plan: planWithMidterms(), booked: new Set(['MATH-20C|2026|2']) }); // nothing in this plan is booked
    await settle();
    act(() => tabNamed('Midterms').click());
    act(() => sliceButtons()[2]!.click());
    expect(sliceOn()).toBe('Nov 09–15');
    act(() => (container.querySelector('.campusmap__bookedtoggle') as HTMLButtonElement).click());
    expect(sliceOn()).toBe('All'); // no booked pins → no slices but All
    act(() => (container.querySelector('.campusmap__bookedtoggle') as HTMLButtonElement).click());
    expect(sliceOn()).toBe('Nov 09–15');
  });

  it('says TSS has listed no room yet — icon, title, the sittings — instead of "not on the map"', async () => {
    render({ plan: planWithUnroomedMidterms() });
    await settle();
    act(() => tabNamed('Midterms').click());
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(0);
    const empty = container.querySelector('.campusmap__empty--noroom')!;
    expect(empty).not.toBeNull();
    expect(empty.querySelector('.empty__mark')).not.toBeNull();
    expect(empty.querySelector('.empty__title')!.textContent).toBe('No rooms from TSS yet');
    expect(empty.querySelector('.empty__text')!.textContent).toBe(
      'TSS hasn’t listed a room for these midterms yet — check back after browsing the course again.',
    );
    expect([...empty.querySelectorAll('.campusmap__noroom-list li')].map((li) => li.textContent)).toEqual([
      'CSE-8A Midterm 1',
      'CSE-8A Midterm 2',
    ]);
    // A sitting with no place is not "not on the map" — that list must not appear.
    expect(container.querySelector('.campusmap__unlocated')).toBeNull();
    expect(container.textContent).not.toContain('not on the map');
    expect(container.textContent).not.toContain('mapped part of campus');
  });

  it('with some sittings placed, the roomless ones get their own bottom-left line, not the "not on the map" list', async () => {
    render({ plan: planWithMixedMidterms() });
    await settle();
    act(() => tabNamed('Midterms').click());
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(1);
    expect(container.querySelector('.campusmap__empty')).toBeNull();
    expect(container.textContent).not.toContain('not on the map');
    const pill = container.querySelector('.campusmap__noroom-toggle') as HTMLButtonElement;
    expect(pill.textContent).toContain('1 without a room yet');
    act(() => pill.click());
    expect(container.textContent).toContain('CSE-8A Midterm 2 — no room listed in TSS yet');
  });

  it('a vertical wheel over the slice row scrolls it sideways (mouse users have no other way in)', async () => {
    render({ plan: planWithMidterms() });
    await settle();
    act(() => tabNamed('Midterms').click());
    const row = container.querySelector('.campusmap__slices') as HTMLDivElement;
    // jsdom lays nothing out; give the row an overflow to scroll.
    Object.defineProperty(row, 'scrollWidth', { value: 420, configurable: true });
    Object.defineProperty(row, 'clientWidth', { value: 316, configurable: true });
    const consumed = !row.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true }));
    expect(consumed).toBe(true);
    expect(row.scrollLeft).toBe(40);
    // A sideways gesture is the browser's own business.
    const passed = row.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaY: 5, bubbles: true, cancelable: true }));
    expect(passed).toBe(true);
  });

  it('the no-room copy names the view: classes, midterms, finals', async () => {
    const course = courseWithMeeting();
    const meeting = course.options[0]!.components[0]!.meetings[0]!;
    delete (meeting as { building?: string }).building;
    delete (meeting as { room?: string }).room;
    delete (meeting as { location?: string }).location;
    course.options[0]!.final = { date: '2026-12-09', start: '11:30', end: '14:29', modality: 'In Person' };
    render({ plan: { version: 1, term: { year: '2026', period: '2', label: 'Fall 2026' }, entries: [{ course, selectedOptionId: course.options[0]!.id, color: '231' }] } });
    await settle();
    expect(container.querySelector('.campusmap__empty--noroom .empty__text')!.textContent).toContain('for these classes yet');
    act(() => tabNamed('Finals').click());
    expect(container.querySelector('.campusmap__empty--noroom .empty__text')!.textContent).toContain('for these finals yet');
  });
});
