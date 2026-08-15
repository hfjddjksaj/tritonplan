import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CampusGeo } from '../lib/campus-geo';
import type { MapPin } from '../lib/map-pins';
import { CampusMapCanvas } from './CampusMapCanvas';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The district ring is what the viewport is framed to, so it has to contain every
// pin these tests expect to see drawn — a marker outside it is deliberately dropped.
const geo: CampusGeo = {
  footprints: [{ name: 'York Hall', rings: [[-117.2410, 32.8740, -117.2400, 32.8740, -117.2400, 32.8750]] }],
  districts: [{ name: 'Revelle', rings: [[-117.2450, 32.8700, -117.2350, 32.8700, -117.2350, 32.8800]] }],
};

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

  function render(pins: MapPin[], onSelect = vi.fn()) {
    act(() => {
      root.render(
        <CampusMapCanvas
          geo={geo} pins={pins} width={800} height={600}
          selectedKey={null} onSelect={onSelect}
        />,
      );
    });
    return onSelect;
  }

  it('draws the basemap layers', () => {
    render([pin({})]);
    expect(container.querySelectorAll('.campusmap__district')).toHaveLength(1);
    expect(container.querySelectorAll('.campusmap__footprint')).toHaveLength(1);
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
