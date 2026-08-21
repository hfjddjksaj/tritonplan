/**
 * The Distance bar as the map mounts it, and the route line the map draws for
 * it — the two halves Task 9 adds to `CampusMap.tsx`.
 *
 * ⚠ `createRoot` + `act`, not @testing-library: that package is not a
 * dependency of this workspace, and every other component test here renders
 * this way (see `ViewTabs.test.tsx`, `CampusMap.test.tsx`).
 *
 * ⚠ `useWalkRoute` is mocked. The real hook lazy-loads a 260 KB graph and runs
 * three full Dijkstras, none of which this file is testing: what it IS testing
 * is that a given answer becomes the right layers on the map, and that the
 * picks survive the things that must not clear them. Handing the component an
 * answer directly is the only way to test the answers that draw NOTHING (a
 * single-point path, a degraded estimate) without reverse-engineering two
 * buildings that happen to produce them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CourseOffering, PlanState } from '@triton/shared';
import { FakeMap, fakeMapLibreModule } from '../test/fake-maplibre';
vi.mock('maplibre-gl', () => fakeMapLibreModule);

/**
 * What the mocked hook answers once BOTH ends are picked — which is the real
 * hook's own contract (it returns `IDLE` until then, and never routes on one).
 * Both objects are stable references on purpose: the route effect keys on the
 * result's identity, so a fresh literal per render would make it tear the
 * layers down and rebuild them on every keystroke elsewhere in the component.
 */
const hook = vi.hoisted(() => {
  const idle = { loading: false, results: null, error: null };
  return { idle, state: idle as typeof idle | { loading: boolean; results: unknown; error: null } };
});
vi.mock('../hooks/useWalkRoute', () => ({
  useWalkRoute: (a: unknown, b: unknown) => (a && b ? hook.state : hook.idle),
}));

import { CampusMap } from './CampusMap';
import { LAYER, ROUTE_SOURCE } from '../lib/map-style';
import type { WalkResult } from '../lib/walk-route';

/** A two-point route: 910 m of gold line, the ordinary case. */
const ROUTE = {
  profile: 'walk',
  metres: 910,
  seconds: 840,
  stepsRuns: 2,
  ascent: 22,
  path: [
    [-117.2373, 32.8779],
    [-117.2405, 32.8801],
  ] as [number, number][],
  fromNode: 0,
  toNode: 1,
  degraded: false,
} satisfies WalkResult;

/**
 * Mayer Hall → York Hall, measured 2026-08-21: both reach the network at the
 * same node, so the cheapest route never touches it. One coordinate is a real
 * answer, and a LineString needs two.
 */
const SAME_DOOR = { ...ROUTE, metres: 0, seconds: 81, path: [[-117.2373, 32.8779]] as [number, number][] };

/** Routing failed outright, so the readout says so and there is no line to draw. */
const DEGRADED = {
  profile: 'walk',
  metres: 240,
  seconds: 260,
  stepsRuns: 0,
  ascent: 0,
  path: null,
  degraded: true,
  reason: 'unreachable',
} satisfies WalkResult;

/** One answer for every mode, which is the shape `useWalkRoute` really returns. */
const answered = (r: WalkResult) => ({
  loading: false,
  results: { walk: r, bike: r, scooter: r },
  error: null,
});

/**
 * Two courses in real, matchable buildings, on DIFFERENT weekdays.
 *
 * `makePlan()` alone yields zero pins — `makeCourse()` is schedule-less
 * (`components: []`) — so it would make every assertion here pass vacuously.
 * This mirrors `courseWithMeetings()` in `../lib/map-pins.test.ts`. The days
 * are split Mon / Wed on purpose: the day slice filters the MARKERS but not
 * the pickers, so a Mon slice with a Wed pick is the case §8 calls out.
 */
function courseAt(id: string, code: string, building: string, day: string): CourseOffering {
  return {
    id,
    moduleId: id,
    subject: code.split('-')[0]!,
    number: code.split('-')[1]!,
    courseCode: code,
    title: `Course ${code}`,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    units: 4,
    options: [
      {
        id: `${id}-opt`,
        code: 'P-001-001',
        enrollCode: `${id}-enroll`,
        components: [
          {
            id: `${id}-E1`,
            type: 'LE',
            typeText: 'Lecture',
            sectionCode: 'A00',
            instructors: ['Ada Lovelace'],
            meetings: [
              {
                days: [day],
                start: '11:00',
                end: '11:50',
                modality: 'In Person',
                building,
                room: '101',
                location: `${building} 101`,
              },
            ],
          },
        ],
      },
    ],
  } as CourseOffering;
}

function planWithSchedule(): PlanState {
  const a = courseAt('CSE-8A|2026|2', 'CSE-8A', 'Center Hall', 'Mon');
  const b = courseAt('MATH-20C|2026|2', 'MATH-20C', 'York Hall', 'Wed');
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: [
      { course: a, selectedOptionId: a.options[0]!.id, color: '231' },
      { course: b, selectedOptionId: b.options[0]!.id, color: '12' },
    ],
  };
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One turn of the loop, wide enough for a dynamic import and for jsdom's rAF. */
async function pump() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
  });
}

/** Wait for the geometry chunks, the map's construction and its `load`. */
async function settle() {
  for (let i = 0; i < 40; i++) {
    await pump();
    if (FakeMap.instances.length > 0 && !document.querySelector('.campusmap__loading')) return;
  }
  throw new Error('map never became ready');
}

describe('CampusMap · Distance', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    FakeMap.reset();
    hook.state = hook.idle;
    // Pin "today" to a Sunday, so the Classes view always opens on All and the
    // slice this file clicks is the only filter in play.
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

  function render() {
    act(() => {
      root.render(
        <CampusMap plan={planWithSchedule()} booked={new Set()} readOnly={false} onClose={() => {}} />,
      );
    });
  }

  const map = () => FakeMap.instances[0]!;
  const bar = () => container.querySelector<HTMLButtonElement>('.campusmap__dist-bar')!;
  const expand = () => act(() => bar().click());
  const selects = () => [...container.querySelectorAll('.campusmap__dist-select')] as HTMLSelectElement[];

  /** Pick one end by the building its option names. */
  function pick(end: 'a' | 'b', building: string) {
    const sel = selects()[end === 'a' ? 0 : 1]!;
    const opt = [...sel.options].find((o) => o.textContent?.includes(building));
    if (!opt) throw new Error(`no option for ${building}: ${[...sel.options].map((o) => o.textContent)}`);
    act(() => {
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // The select is controlled by CampusMap's own state, so React snaps it back
    // to '' if the pick did not actually land — without this, a broken mount
    // point would leave every assertion below passing over two empty ends.
    expect(selects()[end === 'a' ? 0 : 1]!.value).toBe(opt.value);
  }

  /** Both ends of a measurement, with the answer the hook will give for them. */
  function measure(result: WalkResult) {
    hook.state = answered(result);
    expand();
    pick('a', 'Center Hall');
    pick('b', 'York Hall');
  }

  const layers = () => map().layerIds;
  const drawn = () => layers().includes(LAYER.route);

  it('mounts the bar collapsed at the foot of the island, behind a hairline', async () => {
    render();
    await settle();
    const island = container.querySelector('.campusmap__island')!;
    expect(island.querySelector('.campusmap__dist')).not.toBeNull();
    expect(bar().getAttribute('aria-expanded')).toBe('false');
    // The rule separates "which pins" from "measure between two of them", so it
    // has to sit between the slice row and the bar, not anywhere else.
    const rule = island.querySelector('.campusmap__rule')!;
    expect(rule.previousElementSibling!.classList.contains('campusmap__slices')).toBe(true);
    expect(rule.nextElementSibling!.classList.contains('campusmap__dist')).toBe(true);
  });

  it('leaves the layer stack untouched while nothing has been measured', async () => {
    render();
    await settle();
    // Not "an empty source" — none at all. Opening the map has to cost exactly
    // what it cost before this feature existed (spec §7.6).
    expect(layers()).not.toContain(LAYER.route);
    expect(layers()).not.toContain(LAYER.routeCasing);
    expect(map().getSource(ROUTE_SOURCE)).toBeUndefined();
    expect(map().calls.some((c) => c.method === 'addSource' || c.method === 'addLayer')).toBe(false);
  });

  it('draws the picked route over the ground and under the building labels', async () => {
    render();
    await settle();
    measure(ROUTE);
    expect(drawn()).toBe(true);
    expect(map().getSource(ROUTE_SOURCE)).toBeDefined();
    // Casing under the line, both under the first label layer: a route that hid
    // a building's name would cost more than it gives.
    expect(layers().indexOf(LAYER.routeCasing)).toBeLessThan(layers().indexOf(LAYER.route));
    expect(layers().indexOf(LAYER.route)).toBeLessThan(layers().indexOf(LAYER.roadNames));
    const added = map().calls.find((c) => c.method === 'addSource')!;
    expect((added.args[1] as { data: { geometry: { coordinates: unknown } } }).data.geometry.coordinates).toEqual(
      ROUTE.path,
    );
  });

  it('draws nothing when the two ends share a door — a LineString needs two points', async () => {
    render();
    await settle();
    measure(SAME_DOOR);
    expect(drawn()).toBe(false);
    expect(map().getSource(ROUTE_SOURCE)).toBeUndefined();
    // The reading is still there: 0 m of line is not 0 m of trip.
    expect(container.querySelector('.campusmap__dist-sum')!.textContent).toMatch(/next door/i);
  });

  it('draws nothing for a degraded answer, which has no path to draw', async () => {
    render();
    await settle();
    measure(DEGRADED);
    expect(drawn()).toBe(false);
    expect(map().getSource(ROUTE_SOURCE)).toBeUndefined();
    expect(container.querySelector('.campusmap__dist-foot')!.textContent).toMatch(/no line drawn/i);
  });

  it('removes both layers AND the source when the route is cleared', async () => {
    render();
    await settle();
    measure(ROUTE);
    expect(drawn()).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('.campusmap__dist-clear')!.click());
    expect(layers()).not.toContain(LAYER.route);
    expect(layers()).not.toContain(LAYER.routeCasing);
    expect(map().getSource(ROUTE_SOURCE)).toBeUndefined();
    expect(map().calls.some((c) => c.method === 'removeSource')).toBe(true);
  });

  it('keeps the picks and the route when the view tab changes', async () => {
    render();
    await settle();
    measure(ROUTE);
    const before = selects().map((s) => s.value);
    const finals = [...container.querySelectorAll('.campusmap__island [role="tab"]')].find(
      (t) => t.textContent === 'Finals',
    ) as HTMLButtonElement;
    act(() => finals.click());
    // Classes → Finals resets `picked` and `openKey`; a distance is not scoped
    // to a view and must not join them.
    expect(selects().map((s) => s.value)).toEqual(before);
    expect(drawn()).toBe(true);
  });

  it('keeps the route when the day slice hides the pins at its ends', async () => {
    render();
    await settle();
    measure(ROUTE);
    const mon = [...container.querySelectorAll('.campusmap__slices .calseg__btn')].find(
      (b) => b.textContent === 'Mon',
    ) as HTMLButtonElement;
    act(() => mon.click());
    // B is a Wednesday class, so its marker is gone from the canvas — the line
    // between the two buildings is not (spec §8).
    expect(drawn()).toBe(true);
    expect(selects()[1]!.value).not.toBe('');
  });
});
