import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FakeMap } from '../test/fake-maplibre';
import type { PinGroup } from '../lib/map-labels';
import type { MapPin } from '../lib/map-pins';
import { MapMarkers } from './MapMarkers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pin = (courseCode: string, label: string, hue = 231, booked = false): MapPin =>
  ({ courseId: courseCode, courseCode, label, hue, booked, kind: 'meeting', coords: { lat: 0, lng: 0 } } as unknown as MapPin);
const group = (key: string, lng: number, lat: number, place: string, pins: MapPin[]): PinGroup => ({ key, lng, lat, place, building: place, pins });

const CENTER_HALL = group('a', -117.2374, 32.8781, 'Center Hall', [pin('CSE-8A', 'LEC')]);
const YORK = group('b', -117.2405, 32.8748, 'York Hall', [pin('MUS-1', 'LEC', 12), pin('MUS-1', 'DI', 12)]);
const HILLCREST = group('c', -117.166, 32.755, '304 Arbor Drive', [pin('MED-100', 'LEC')]);

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

  it('draws a marker per visible group, none for the one off the frame, chip text per group', async () => {
    await render();
    const markers = container.querySelectorAll('.campusmap__marker');
    expect(markers).toHaveLength(2);
    const chips = [...container.querySelectorAll('.campusmap__chip')].map((c) => c.textContent);
    expect(chips).toEqual(expect.arrayContaining(['CSE-8ALEC', 'MUS-1+1']));
    expect(markers[0]!.getAttribute('aria-label')).toMatch(/Center Hall: CSE-8A LEC/);
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

  it('opens from the keyboard (Enter) and preventDefaults a mouse press so focus stays put', async () => {
    const onSelect = vi.fn();
    await render({ onSelect });
    const m = container.querySelector('.campusmap__marker') as HTMLElement;
    expect(m.getAttribute('tabindex')).toBe('0');
    await act(async () => { m.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(onSelect).toHaveBeenLastCalledWith('a');
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    await act(async () => { m.dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(true);
  });

  it('re-projects when tick changes after the map moved', async () => {
    await render({ tick: 0 });
    const before = (container.querySelector('.campusmap__marker') as HTMLElement).style.transform;
    map.jumpTo({ center: [-117.24, 32.88], zoom: 15 });
    await render({ tick: 1 });
    const after = (container.querySelector('.campusmap__marker') as HTMLElement).style.transform;
    expect(after).not.toBe(before);
  });
});
