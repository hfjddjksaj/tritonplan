import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FakeMap } from '../test/fake-maplibre';
import type { PinGroup } from '../lib/map-labels';
import type { MapPin } from '../lib/map-pins';
import { colorsForHue } from '../lib/colors';
import { MapMarkers } from './MapMarkers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pin = (courseCode: string, label: string, hue = 231, booked = false): MapPin =>
  ({ courseId: courseCode, courseCode, label, hue, booked, kind: 'meeting', coords: { lat: 0, lng: 0 } } as unknown as MapPin);
const group = (key: string, lng: number, lat: number, place: string, pins: MapPin[]): PinGroup => ({ key, lng, lat, place, building: place, pins });

const CENTER_HALL = group('a', -117.2374, 32.8781, 'Center Hall', [pin('CSE-8A', 'LEC')]);
const YORK = group('b', -117.2405, 32.8748, 'York Hall', [pin('MUS-1', 'LEC', 12), pin('MUS-1', 'DI', 12)]);
const HILLCREST = group('c', -117.166, 32.755, '304 Arbor Drive', [pin('MED-100', 'LEC')]);
/** Two different courses in one building, plus a second sitting of the first. */
const GALBRAITH = group('d', -117.2409, 32.8738, 'Galbraith Hall', [
  pin('CSE-8A', 'LEC'),
  pin('CSE-8A', 'DIS'),
  pin('CSE-11', 'LEC', 12),
]);

/**
 * Mirrors `FakeMap.project` exactly (same expression, same evaluation order),
 * so the result is bit-identical to what the component's `map.project()` call
 * produces — an independent oracle for the marker's `translate()`, not a call
 * into the same collaborator the component uses.
 */
const expectedProject = (lng: number, lat: number, center: [number, number], zoom: number) => {
  const s = (256 * 2 ** zoom) / 360;
  return { x: (lng - center[0]) * s + FakeMap.size.w / 2, y: (center[1] - lat) * s + FakeMap.size.h / 2 };
};

/** jsdom normalizes an inline `background` colour (e.g. hsl() -> rgb()) on the way
 *  into `style`, so compare against the same round-trip rather than the raw string. */
const cssColor = (v: string) => {
  const el = document.createElement('div');
  el.style.background = v;
  return el.style.background;
};

describe('MapMarkers', () => {
  let container: HTMLDivElement;
  let root: Root;
  let map: FakeMap;
  beforeEach(() => {
    FakeMap.reset();
    map = new FakeMap({ container: document.createElement('div'), style: { version: 8, sources: {}, layers: [] } });
    map.jumpTo({ center: [-117.235, 32.88], zoom: 15 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  const render = (props: Partial<Parameters<typeof MapMarkers>[0]> = {}) =>
    act(() => root.render(<MapMarkers map={map as never} tick={0} groups={[CENTER_HALL, YORK, HILLCREST]} bounds={FakeMap.size} selectedKey={null} onSelect={() => {}} {...props} />));

  it('draws a marker per visible group, none for the one off the frame, the course code per chip', async () => {
    await render();
    const markers = container.querySelectorAll('.campusmap__marker');
    expect(markers).toHaveLength(2);
    // The chip names courses only. York's lecture and its discussion are one
    // course, so they are one line — not "MUS-1 +1", which read as a warning
    // about a class the map had failed to draw.
    const chips = [...container.querySelectorAll('.campusmap__chip')].map((c) => c.textContent);
    expect(chips).toEqual(expect.arrayContaining(['CSE-8A', 'MUS-1']));
    // The whole truth still reaches a screen reader, component labels included.
    expect(markers[0]!.getAttribute('aria-label')).toMatch(/Center Hall: CSE-8A LEC/);
  });

  it('stacks one ruled line per course when a building carries several', async () => {
    await render({ groups: [GALBRAITH] });
    const chip = container.querySelector('.campusmap__chip')!;
    expect(chip.classList.contains('campusmap__chip--stack')).toBe(true);
    const rows = [...chip.querySelectorAll('.campusmap__chiprow')];
    expect(rows.map((r) => r.querySelector('.campusmap__chipcode')!.textContent)).toEqual(['CSE-8A', 'CSE-11']);
    // Each line wears its own course's colour, the same as the card's headings.
    expect((rows[0]!.querySelector('.campusmap__chip-dot') as HTMLElement).style.background).toBe(
      cssColor(colorsForHue(231).spine),
    );
    expect((rows[1]!.querySelector('.campusmap__chip-dot') as HTMLElement).style.background).toBe(
      cssColor(colorsForHue(12).spine),
    );
  });

  it('omits the chip of the selected marker and marks it open', async () => {
    await render({ selectedKey: 'a' });
    const open = container.querySelector('.campusmap__marker--open')!;
    expect(open.getAttribute('aria-pressed')).toBe('true');
    expect(open.querySelector('.campusmap__chip')).toBeNull();
    expect(container.querySelectorAll('.campusmap__chip')).toHaveLength(1);
  });

  it('reports the key on click and toggles off on a second click', async () => {
    const onSelect = vi.fn();
    await render({ onSelect });
    const m = container.querySelector('.campusmap__marker')!;
    await act(async () => { m.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onSelect).toHaveBeenLastCalledWith('a');
    await render({ onSelect, selectedKey: 'a' });
    await act(async () => { container.querySelector('.campusmap__marker--open')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('opens from the keyboard (Enter) and never touches a pointer press', async () => {
    // The markers are pointer-transparent now (QA I1), so a press must reach the
    // GL canvas underneath and start MapLibre's drag. Cancelling pointerdown —
    // which this component used to do, to keep a mouse press from leaving a focus
    // ring — is exactly what made every chip and dot a dead zone. Nothing may
    // consume the press here; the focus ring is handled in CSS instead.
    const onSelect = vi.fn();
    await render({ onSelect });
    const m = container.querySelector('.campusmap__marker') as HTMLElement;
    expect(m.getAttribute('tabindex')).toBe('0');
    await act(async () => { m.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(onSelect).toHaveBeenLastCalledWith('a');
    for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      await act(async () => { m.dispatchEvent(ev); });
      expect(ev.defaultPrevented, type).toBe(false);
    }
  });

  it('marks the hovered marker so its chip can answer a hit test the pointer cannot reach', async () => {
    await render({ hoverKey: 'a' });
    const hovered = container.querySelector('.campusmap__marker--hover')!;
    expect(hovered.getAttribute('aria-label')).toMatch(/Center Hall/);
    expect(container.querySelectorAll('.campusmap__marker--hover')).toHaveLength(1);
  });

  // THE anti-lag test. The dots used to be positioned by React off the
  // rAF-throttled `tick`, which lands a frame AFTER the GL canvas has already
  // painted the new camera — so during a drag every pin visibly trailed the
  // basemap it was pinned to. Positions now come out of MapLibre's own `move`
  // event, synchronously: no re-render, no new `tick`, and the marker is already
  // where it belongs. Nothing below re-renders the component.
  it('follows the camera inside MapLibre’s move event, without waiting for a render', async () => {
    const groups = [CENTER_HALL, YORK, HILLCREST];
    const marker = () => container.querySelector('.campusmap__marker') as HTMLElement;

    await render({ tick: 0, groups });
    const before = expectedProject(CENTER_HALL.lng, CENTER_HALL.lat, [-117.235, 32.88], 15);
    expect(marker().style.transform).toBe(`translate(${before.x}px, ${before.y}px)`);

    // A camera change and nothing else: same props, same tick, no re-render.
    await act(async () => { map.jumpTo({ center: [-117.24, 32.88], zoom: 15 }); });
    const after = expectedProject(CENTER_HALL.lng, CENTER_HALL.lat, [-117.24, 32.88], 15);
    expect(marker().style.transform).toBe(`translate(${after.x}px, ${after.y}px)`);
  });

  it('carries the open marker’s card in its own layer, pinned to that marker’s dot', async () => {
    // Its own layer, not a child of the marker: inside the marker, a press on
    // anything in the card bubbled into the marker's toggle, so "Directions"
    // closed the card on its way to the popover.
    await render({ selectedKey: 'a', card: <div className="probe-card">card</div> });
    const layer = container.querySelector('.campusmap__cardlayer') as HTMLElement;
    expect(layer).not.toBeNull();
    expect(layer.querySelector('.probe-card')).not.toBeNull();
    expect(layer.closest('.campusmap__marker')).toBeNull();
    const open = container.querySelector('.campusmap__marker--open') as HTMLElement;
    expect(layer.style.transform).toBe(open.style.transform);

    // ...and it stays pinned to it through a camera change, in the same event
    // the dot itself moves in.
    await act(async () => { map.jumpTo({ center: [-117.24, 32.881], zoom: 15.5 }); });
    const moved = expectedProject(CENTER_HALL.lng, CENTER_HALL.lat, [-117.24, 32.881], 15.5);
    expect(layer.style.transform).toBe(`translate(${moved.x}px, ${moved.y}px)`);
    expect(open.style.transform).toBe(layer.style.transform);
  });

  it('draws no card layer with nothing open, or with a marker that is off the canvas', async () => {
    // The layer exists only to be pinned to a dot, so it must not outlive one:
    // no selection at all, or a selection whose marker the camera has left
    // behind (QA I2), and there is nothing to pin.
    await render({ selectedKey: null, card: <div className="probe-card">card</div> });
    expect(container.querySelector('.campusmap__cardlayer')).toBeNull();
    await render({ selectedKey: 'c', card: <div className="probe-card">card</div> }); // Hillcrest: off the frame
    expect(container.querySelector('.campusmap__cardlayer')).toBeNull();
  });

  it('fills the dot from the course colour when booked, marks the marker --booked; plain white otherwise', async () => {
    const bookedGroup = group('a', CENTER_HALL.lng, CENTER_HALL.lat, 'Center Hall', [pin('CSE-8A', 'LEC', 231, true)]);
    await render({ groups: [bookedGroup, YORK, HILLCREST] });

    const booked = container.querySelector('.campusmap__marker--booked') as HTMLElement;
    expect(booked).not.toBeNull();
    expect((booked.querySelector('.campusmap__dot') as HTMLElement).style.background).toBe(cssColor(colorsForHue(231).spine));

    const unbooked = container.querySelector('.campusmap__marker:not(.campusmap__marker--booked)') as HTMLElement;
    expect(unbooked).not.toBeNull();
    expect((unbooked.querySelector('.campusmap__dot') as HTMLElement).style.background).toBe(cssColor('#fff'));
  });
});
