/**
 * ⚠ Rendered with `createRoot` + `act`, not @testing-library — that package is
 * not a dependency of this workspace and every other component test here does
 * it this way (see ViewTabs.test.tsx). The assertions are the plan's.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DistanceBar } from './DistanceBar';
import type { WalkPlace } from '../lib/walk-places';
import type { WalkResult } from '../lib/walk-route';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLACES: WalkPlace[] = [
  {
    id: 'a',
    courseCode: 'CSE 11',
    label: 'LEC',
    hue: 200,
    place: 'Center Hall',
    coords: { lat: 32.8779, lng: -117.2373 },
    disabled: false,
  },
  {
    id: 'b',
    courseCode: 'MATH 20C',
    label: 'DI',
    hue: 20,
    place: 'Applied Physics and Mathematics',
    coords: { lat: 32.8801, lng: -117.2405 },
    disabled: false,
  },
  {
    id: 'c',
    courseCode: 'MUIR 40',
    label: 'LEC',
    hue: 90,
    coords: null,
    disabled: true,
    disabledReason: 'online',
  },
  {
    id: 'd',
    courseCode: 'TDGE 1',
    label: 'DI',
    hue: 300,
    place: 'Somewhere Unmapped',
    coords: null,
    disabled: true,
    disabledReason: 'no-location',
  },
];

const ROUTE = {
  profile: 'walk',
  metres: 910,
  seconds: 840,
  stepsRuns: 2,
  ascent: 22,
  path: [
    [0, 0],
    [1, 1],
  ] as [number, number][],
  fromNode: 0,
  toNode: 1,
  degraded: false,
} satisfies WalkResult;

/** Center Hall → Conrad Prebys, measured 2026-08-21: 227 equivalent metres of
 *  this trip is indoor walking, so 160 m over 5 min is NOT a walking speed. */
const WIDE_BUILDINGS = { ...ROUTE, metres: 160, seconds: 300, stepsRuns: 0, ascent: 0 };

/** Mayer Hall → York Hall: one shared door, so the route never touches the network. */
const SAME_DOOR = {
  ...ROUTE,
  metres: 0,
  seconds: 81,
  stepsRuns: 0,
  ascent: 0,
  path: [[0, 0]] as [number, number][],
};

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

type Props = Parameters<typeof DistanceBar>[0];

describe('DistanceBar', () => {
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
    localStorage.clear();
  });

  function props(over: Partial<Props> = {}): Props {
    return {
      places: PLACES,
      a: null,
      b: null,
      onPick: vi.fn(),
      onSwap: vi.fn(),
      onClear: vi.fn(),
      route: null,
      profile: 'walk',
      onProfile: vi.fn(),
      results: null,
      loading: false,
      ...over,
    };
  }

  function render(p: Props) {
    act(() => {
      root.render(<DistanceBar {...p} />);
    });
    return p;
  }

  const toggle = () => container.querySelector<HTMLButtonElement>('.campusmap__dist-bar')!;
  const clear = () => container.querySelector<HTMLButtonElement>('[aria-label="Clear distance"]');
  const panel = () => container.querySelector<HTMLElement>('.campusmap__dist-panel');
  const selects = () => [...container.querySelectorAll<HTMLSelectElement>('select')];
  const modes = () => [...container.querySelectorAll<HTMLButtonElement>('.campusmap__dist-mode')];
  const expand = () => act(() => toggle().click());

  it('starts collapsed with no clear button — nothing to clear yet', () => {
    render(props());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();
    expect(clear()).toBeNull();
    expect(toggle().textContent).toContain('between two places');
  });

  it('expands and collapses on click, and the bar stays the header', () => {
    render(props());
    expand();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(panel()).not.toBeNull();
    expect(toggle().textContent).toContain('Distance');
    expand();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();
  });

  it('shows the summary and a clear button while collapsed, once a route exists', () => {
    render(props({ a: PLACES[0]!, b: PLACES[1]!, route: ROUTE }));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toMatch(/910\s*m/);
    expect(toggle().textContent).toMatch(/14 min/);
    expect(clear()).not.toBeNull();
  });

  it('calls onClear from the collapsed state — that is the whole point of it', () => {
    const p = render(props({ a: PLACES[0]!, b: PLACES[1]!, route: ROUTE }));
    expect(panel()).toBeNull();
    act(() => clear()!.click());
    expect(p.onClear).toHaveBeenCalledOnce();
  });

  it('keeps the summary and the clear button when expanded too', () => {
    render(props({ a: PLACES[0]!, b: PLACES[1]!, route: ROUTE }));
    expand();
    expect(toggle().textContent).toMatch(/910\s*m/);
    expect(clear()).not.toBeNull();
  });

  it('offers every place, disabling the unusable ones but showing why', () => {
    render(props());
    expand();
    const opts = [...selects()[0]!.options];
    expect(opts.map((o) => o.textContent)).toEqual([
      'Pick a place…',
      'CSE 11 · LEC — Center Hall',
      'MATH 20C · DI — Applied Physics and Mathematics',
      'MUIR 40 · LEC (online)',
      'TDGE 1 · DI — Somewhere Unmapped (no location)',
    ]);
    expect(opts.find((o) => o.textContent?.includes('MUIR 40'))!.disabled).toBe(true);
    expect(opts.find((o) => o.textContent?.includes('TDGE 1'))!.disabled).toBe(true);
    expect(opts.find((o) => o.textContent?.includes('CSE 11'))!.disabled).toBe(false);
  });

  it('reports a pick and a swap', () => {
    const p = render(props());
    expand();
    const from = selects()[0]!;
    act(() => {
      from.value = 'b';
      from.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(p.onPick).toHaveBeenCalledWith('a', PLACES[1]);
    act(() => container.querySelector<HTMLButtonElement>('.campusmap__dist-swap')!.click());
    expect(p.onSwap).toHaveBeenCalledOnce();
  });

  it('reads out stairs and climb, not just a time', () => {
    render(props({ a: PLACES[0]!, b: PLACES[1]!, route: ROUTE }));
    expand();
    const sub = container.querySelector('.campusmap__dist-sub')!.textContent!;
    expect(sub).toMatch(/2 flights/i);
    expect(sub).toMatch(/22 m climb/i);
  });

  it('never prints a bare distance a reader could divide into the time', () => {
    // 160 m and 5 min is a real pair (Center Hall → Conrad Prebys). Divided it
    // reads 0.5 m/s, so the distance must say what it measures.
    render(props({ a: PLACES[0]!, b: PLACES[1]!, route: WIDE_BUILDINGS }));
    expand();
    expect(container.querySelector('.campusmap__dist-sub')!.textContent).toBe('160 m on paths');
    expect(toggle().textContent).toContain('160 m on paths');
  });

  it('calls a zero-metre route "Next door" rather than printing 0 m', () => {
    render(props({ a: PLACES[0]!, b: PLACES[1]!, route: SAME_DOOR }));
    expect(toggle().textContent).toContain('Next door');
    expect(toggle().textContent).not.toMatch(/\b0\s*m\b/);
    expand();
    const sub = container.querySelector('.campusmap__dist-sub')!.textContent!;
    expect(sub).toMatch(/next door/i);
    expect(sub).not.toMatch(/\b0\s*m\b/);
  });

  it('shows time to the minute and never finer', () => {
    render(props({ a: PLACES[0]!, b: PLACES[1]!, route: SAME_DOOR }));
    expand();
    // 81 s rounds to 1 min; nothing anywhere may read in seconds.
    expect(container.querySelector('.campusmap__dist-big')!.textContent).toBe('1 min');
    expect(container.textContent).not.toMatch(/\d+\s*(s\b|sec)/i);
  });

  it('gives each mode its own time and marks bike and scooter as estimates', () => {
    render(
      props({
        a: PLACES[0]!,
        b: PLACES[1]!,
        route: ROUTE,
        results: {
          walk: ROUTE,
          bike: { ...ROUTE, profile: 'bike', seconds: 360 },
          scooter: { ...ROUTE, profile: 'scooter', seconds: 540 },
        },
      }),
    );
    expand();
    expect(modes().map((m) => m.textContent)).toEqual([
      'Walk 14 min',
      'Bike 6 min est',
      'Scooter 9 min est',
    ]);
    expect(modes()[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(modes()[0]!.getAttribute('aria-label')).toBe('Walk, 14 min');
    expect(modes()[1]!.getAttribute('aria-label')).toBe('Bike, 6 min, estimated');
  });

  it('disables a mode that has no route at all instead of blanking the readout', () => {
    const p = render(
      props({ a: PLACES[0]!, b: PLACES[1]!, route: ROUTE, results: { walk: ROUTE } }),
    );
    expand();
    expect(modes()[1]!.disabled).toBe(true);
    act(() => modes()[1]!.click());
    expect(p.onProfile).not.toHaveBeenCalled();
    act(() => modes()[2]!.click());
    expect(p.onProfile).not.toHaveBeenCalled();
    act(() => modes()[0]!.click());
    expect(p.onProfile).toHaveBeenCalledWith('walk');
  });

  it('marks a degraded answer and never implies a drawn route', () => {
    render(props({ a: PLACES[0]!, b: PLACES[1]!, route: DEGRADED }));
    expand();
    expect(container.querySelector('.campusmap__dist-foot')!.textContent).toMatch(
      /route unclear|estimate/i,
    );
    // no gold, and no "on paths" claim for a distance that never saw a path
    expect(container.querySelector('.campusmap__dist')!.className).toContain(
      'campusmap__dist--vague',
    );
    expect(container.querySelector('.campusmap__dist')!.className).not.toContain(
      'campusmap__dist--has',
    );
    expect(container.querySelector('.campusmap__dist-sub')!.textContent).not.toMatch(/on paths/);
  });

  it('says it is working while the engine runs', () => {
    render(props({ a: PLACES[0]!, b: PLACES[1]!, loading: true }));
    expect(toggle().textContent).toContain('measuring');
    expand();
    expect(panel()!.textContent).toMatch(/working out the route/i);
  });

  it('never remembers being open — it starts collapsed every time', () => {
    render(props());
    expand();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(localStorage.length).toBe(0);

    // A fresh mount is a fresh map opening: back to collapsed.
    act(() => root.unmount());
    root = createRoot(container);
    render(props({ a: PLACES[0]!, b: PLACES[1]!, route: ROUTE }));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.length).toBe(0);
  });

  it('is operable from the keyboard — every control is a real button or select', () => {
    render(props({ a: PLACES[0]!, b: PLACES[1]!, route: ROUTE, results: { walk: ROUTE } }));
    expand();
    const focusable = [...container.querySelectorAll('button, select, a[href]')];
    expect(focusable.length).toBeGreaterThan(5);
    for (const el of focusable) expect(el.hasAttribute('tabindex')).toBe(false);
    toggle().focus();
    expect(document.activeElement).toBe(toggle());
    clear()!.focus();
    expect(document.activeElement).toBe(clear());
  });
});
