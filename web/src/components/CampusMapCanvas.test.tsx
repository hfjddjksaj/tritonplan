import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { campusViewport, type CampusGeo } from '../lib/campus-geo';
import type { MapPin } from '../lib/map-pins';
import type { Viewport } from '../lib/map-projection';
import { CampusMapCanvas } from './CampusMapCanvas';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The district ring is what the viewport is framed to, so it has to contain every
// pin these tests expect to see drawn — a marker outside it is deliberately dropped.
const geo: CampusGeo = {
  footprints: [{ name: 'York Hall', rings: [[-117.2410, 32.8740, -117.2400, 32.8740, -117.2400, 32.8750]] }],
  districts: [{ name: 'Revelle', rings: [[-117.2450, 32.8700, -117.2350, 32.8700, -117.2350, 32.8800]] }],
  lines: [
    { name: 'Gilman Drive', kind: 'major', pts: [-117.2450, 32.8760, -117.2350, 32.8760] },
    { name: '', kind: 'coast', pts: [-117.2500, 32.8800, -117.2500, 32.8700] },
  ],
};
const HOME = campusViewport(geo, 800, 600);

function pin(over: Partial<MapPin>): MapPin {
  return {
    courseId: 'CSE-8A|2026|2',
    courseCode: 'CSE-8A',
    hue: 231,
    kind: 'meeting',
    label: 'LEC',
    when: { weekday: 'Mon', start: '11:00', end: '11:50' },
    building: 'York Hall',
    room: '2622',
    coords: { lat: 32.8745, lng: -117.2405 },
    booked: false,
    ...over,
  };
}

describe('CampusMapCanvas', () => {
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

  function render(
    pins: MapPin[],
    onSelect = vi.fn(),
    opts: {
      view?: Viewport;
      onViewChange?: (v: Viewport) => void;
      selectedKey?: string | null;
      insetTop?: number;
      reserved?: { x: number; y: number; w: number; h: number }[];
    } = {},
  ) {
    act(() => {
      root.render(
        <CampusMapCanvas
          geo={geo} pins={pins} width={800} height={600}
          view={opts.view ?? HOME} homeView={HOME} onViewChange={opts.onViewChange ?? vi.fn()}
          selectedKey={opts.selectedKey ?? null} onSelect={onSelect}
          insetTop={opts.insetTop} reserved={opts.reserved}
        />,
      );
    });
    return onSelect;
  }

  it('draws the basemap layers', () => {
    render([pin({})]);
    expect(container.querySelectorAll('.campusmap__district')).toHaveLength(1);
    expect(container.querySelectorAll('.campusmap__footprint')).toHaveLength(1);
    expect(container.querySelector('.campusmap__ocean')).not.toBeNull();
    expect(container.querySelector('.campusmap__road--major')!.getAttribute('d')).toMatch(/^M/);
    // The compass lives in the shell's control cluster now, not on the canvas.
    expect(container.querySelector('.campusmap__compass')).toBeNull();
    expect(container.querySelector('.campusmap__scale-text')!.textContent).toMatch(/^\d+ (m|km)$/);
    expect(container.querySelector('.campusmap__attrib')!.textContent).toContain('OpenStreetMap');
  });

  it('names the district and the road, and colours the building that hosts a class', () => {
    render([pin({})]);
    const names = [...container.querySelectorAll('.campusmap__districtname')].map((n) => n.textContent);
    expect(names).toEqual(['Revelle']);
    const road = container.querySelector('.campusmap__roadname');
    expect(road?.textContent).toBe('Gilman Dr');
    // Straight text, rotated to the road: never a textPath.
    expect(container.querySelector('textPath')).toBeNull();
    expect(road?.getAttribute('transform')?.startsWith('rotate(')).toBe(true);
    // York Hall has a footprint in this fixture and a class in it → a host path.
    expect(container.querySelectorAll('.campusmap__host')).toHaveLength(1);
    render([pin({ building: 'Center Hall', coords: { lat: 32.8779, lng: -117.2415 } })]);
    expect(container.querySelectorAll('.campusmap__host')).toHaveLength(0);
  });

  it('colours the host by its matched name, so a TSS-truncated building still lights up', () => {
    // TSS caps the field at 40 chars; matchBuilding() repairs it into `place`.
    render([pin({ building: 'York Hal', place: 'York Hall' })]);
    expect(container.querySelectorAll('.campusmap__host')).toHaveLength(1);
    // And the spoken label uses the repaired name.
    expect(container.querySelector('.campusmap__marker')!.getAttribute('aria-label')).toBe('York Hall: CSE-8A LEC');
  });

  it('draws the chip as a pill: a course-coloured dot, then the code, then the muted label', () => {
    render([pin({})]);
    const chip = container.querySelector('.campusmap__chip')!;
    // A pill, not a rounded box: corner radius is half the height.
    expect(Number(chip.getAttribute('rx'))).toBe(Number(chip.getAttribute('height')) / 2);
    const dot = container.querySelector('.campusmap__chip-dot')!;
    expect(dot).not.toBeNull();
    // The dot carries the course colour; the text is ink, not colour.
    expect(dot.getAttribute('fill')).toBe(container.querySelector('.campusmap__dot')!.getAttribute('stroke'));
    expect(container.querySelector('.campusmap__chipcode')!.textContent).toBe('CSE-8A');
    expect(container.querySelector('.campusmap__chiplabel')!.textContent).toBe('LEC');
    // Big enough to read and to hit: the dot is 7.5 px, the pill 22 px tall.
    expect(Number(container.querySelector('.campusmap__dot')!.getAttribute('r'))).toBe(7.5);
    expect(Number(chip.getAttribute('height'))).toBe(22);
    // Two classes in one building: the label becomes the overflow count.
    render([pin({}), pin({ courseId: 'MATH-20C|2026|2', courseCode: 'MATH-20C', hue: 12 })]);
    expect(container.querySelector('.campusmap__chipcode')!.textContent).toBe('CSE-8A');
    expect(container.querySelector('.campusmap__chiplabel')!.textContent).toBe('+1');
  });

  it('a mouse press on a marker does not move focus onto it, so no focus ring outlives the click', () => {
    // Cancelling pointerdown suppresses the compat mousedown, and with it the
    // focus move; the click still fires. Keyboard focus (Tab / Enter) is untouched.
    render([pin({})]);
    const marker = container.querySelector('.campusmap__marker')!;
    const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      marker.dispatchEvent(press);
    });
    expect(press.defaultPrevented).toBe(true);
  });

  it('draws no chip for the open marker — the card stands in for it', () => {
    render([pin({})]);
    expect(container.querySelector('.campusmap__chip')).not.toBeNull();
    render([pin({})], vi.fn(), { selectedKey: '32.87450,-117.24050' });
    expect(container.querySelector('.campusmap__chip')).toBeNull();
    expect(container.querySelector('.campusmap__marker--open')).not.toBeNull();
    expect(container.querySelector('.campusmap__dot')).not.toBeNull();
  });

  it('keeps the names out from under the floating header', () => {
    render([pin({})], vi.fn(), { insetTop: 56 });
    // The header strip is an obstacle: a district name that sat there is pushed or dropped.
    const namesUnderHeader = [...container.querySelectorAll('.campusmap__districtname')].filter(
      (n) => Number(n.getAttribute('y')) < 56,
    );
    expect(namesUnderHeader).toHaveLength(0);
  });

  it('never draws a basemap name under a reserved box (the open card)', () => {
    render([pin({})]);
    const name = container.querySelector('.campusmap__districtname')!;
    const x = Number(name.getAttribute('x'));
    const y = Number(name.getAttribute('y'));
    // Reserve exactly where "Revelle" landed: it has to move or go.
    render([pin({})], vi.fn(), { reserved: [{ x: x - 60, y: y - 30, w: 120, h: 60 }] });
    const after = container.querySelector('.campusmap__districtname');
    if (after) {
      const ax = Number(after.getAttribute('x'));
      const ay = Number(after.getAttribute('y'));
      expect(Math.abs(ax - x) > 1 || Math.abs(ay - y) > 1).toBe(true);
    }
  });

  it('draws only the markers the current view can show', () => {
    // Zoomed 8× onto the far corner of the canvas: York Hall scrolls off.
    const far: Viewport = { scale: HOME.scale * 8, offsetX: HOME.offsetX * 8 + 5000, offsetY: HOME.offsetY * 8 - 5000 };
    render([pin({})], vi.fn(), { view: far });
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(0);
  });

  it('zooms around the wheel position and pans on drag, without deselecting', () => {
    const onViewChange = vi.fn();
    const onSelect = render([pin({})], vi.fn(), { onViewChange, selectedKey: '32.87450,-117.24050' });
    const svg = container.querySelector('svg')!;
    // jsdom has no layout: give the svg a real box so pointer→svg maths works.
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;

    act(() => {
      svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
    });
    expect(onViewChange).toHaveBeenCalledTimes(1);
    const zoomed = onViewChange.mock.calls[0]![0] as Viewport;
    expect(zoomed.scale).toBeGreaterThan(HOME.scale);

    // jsdom has neither PointerEvent nor pointer capture.
    class PE extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number }) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    (globalThis as unknown as { PointerEvent: typeof PE }).PointerEvent = PE;
    svg.setPointerCapture = () => {};
    const pd = (x: number, y: number) =>
      new PointerEvent('pointerdown', { pointerId: 1, clientX: x, clientY: y, button: 0, bubbles: true });
    const pm = (x: number, y: number) =>
      new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y, bubbles: true });
    const pu = (x: number, y: number) =>
      new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: y, bubbles: true });
    act(() => {
      svg.dispatchEvent(pd(100, 100));
      svg.dispatchEvent(pm(130, 110));
      svg.dispatchEvent(pu(130, 110));
      svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // The drag compounds on the zoomed view (the canvas tracks its last commit,
    // not just the prop, so ticks in one frame don't overwrite each other).
    const panned = onViewChange.mock.calls.at(-1)![0] as Viewport;
    expect(panned.scale).toBe(zoomed.scale);
    expect(panned.offsetX).toBeCloseTo(zoomed.offsetX + 30);
    expect(panned.offsetY).toBeCloseTo(zoomed.offsetY + 10);
    // The click the browser fires after a drag must not close the open marker…
    expect(onSelect).not.toHaveBeenCalled();
    // …but a plain click on the background still does.
    act(() => {
      svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('a wheel event on the map is consumed rather than scrolling the overlay', () => {
    render([pin({})]);
    const svg = container.querySelector('svg')!;
    const e = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    act(() => {
      svg.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
  });

  it('draws one marker for two classes in the same building', () => {
    render([pin({ label: 'LEC' }), pin({ label: 'LAB' })]);
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(1);
  });

  it('draws separate markers for separate buildings', () => {
    render([pin({}), pin({ building: 'Center Hall', coords: { lat: 32.8779, lng: -117.2415 } })]);
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(2);
  });

  it('never draws a marker for a pin it cannot locate', () => {
    render([pin({ coords: null })]);
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(0);
  });

  it('reports the group key when a marker is clicked', () => {
    const onSelect = render([pin({})]);
    const marker = container.querySelector('.campusmap__marker') as SVGGElement;
    act(() => {
      marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toMatch(/^32\.87450,-117\.24050$/);
  });

  it('never draws a marker the viewport cannot show', () => {
    // A real, located class 13 km south (UCSD Health, Hillcrest). Drawing it
    // off-canvas is the same as not drawing it — CampusMap lists it instead.
    render([pin({ building: 'Hillcrest', coords: { lat: 32.755, lng: -117.166 } })]);
    expect(container.querySelectorAll('.campusmap__marker')).toHaveLength(0);
  });

  it('opens a marker from the keyboard, since it is the only route to the details', () => {
    const onSelect = render([pin({})]);
    const marker = container.querySelector('.campusmap__marker') as SVGGElement;
    expect(marker.getAttribute('role')).toBe('button');
    expect(marker.getAttribute('tabindex')).toBe('0');
    expect(marker.getAttribute('aria-label')).toBe('York Hall: CSE-8A LEC');

    act(() => {
      marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    act(() => {
      marker.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(2);
    act(() => {
      marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('distinguishes booked from unbooked markers', () => {
    render([pin({ booked: true })]);
    expect(container.querySelectorAll('.campusmap__marker--booked')).toHaveLength(1);
    render([pin({ booked: false })]);
    expect(container.querySelectorAll('.campusmap__marker--booked')).toHaveLength(0);
  });
});
