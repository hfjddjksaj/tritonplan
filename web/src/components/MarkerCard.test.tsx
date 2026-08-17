import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MapPin } from '../lib/map-pins';
import type { PinGroup } from '../lib/map-labels';
import { MarkerCard } from './MarkerCard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pin(over: Partial<MapPin>): MapPin {
  return {
    courseId: 'CSE-8A|2026|2',
    courseCode: 'CSE-8A',
    hue: 231,
    kind: 'meeting',
    label: 'LEC',
    when: { weekday: 'Mon', start: '11:00', end: '11:50' },
    building: 'York Hall',
    place: 'York Hall',
    room: '2622',
    coords: { lat: 32.8749, lng: -117.2404 },
    booked: false,
    ...over,
  };
}

function group(pins: MapPin[]): PinGroup {
  return { key: '32.87490,-117.24040', lat: 32.8749, lng: -117.2404, building: 'York Hall', place: 'York Hall', pins };
}

describe('MarkerCard', () => {
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

  function render(pins: MapPin[]) {
    act(() => {
      root.render(
        <MarkerCard group={group(pins)} anchor={{ x: 100, y: 100 }} canvas={{ w: 800, h: 600 }} insetTop={0} onBox={() => {}} />,
      );
    });
  }

  it('prints a class section as code + rooms, with no date', () => {
    render([pin({})]);
    expect(container.querySelector('.campusmap__card-code')!.textContent).toBe('CSE-8A');
    expect(container.querySelector('.campusmap__card-date')).toBeNull();
    expect([...container.querySelectorAll('.campusmap__card-rows li')].map((li) => li.textContent)).toEqual(['LEC · Room 2622']);
  });

  it('puts the exam date at the right of the code row, one section per exam, no times', () => {
    render([
      pin({ kind: 'midterm', label: 'Midterm 1', when: { date: '2026-10-31', start: '10:00', end: '11:50' } }),
      pin({ kind: 'midterm', label: 'Midterm 2', when: { date: '2026-11-14', start: '10:00', end: '11:50' }, room: '105' }),
    ]);
    const codes = [...container.querySelectorAll('.campusmap__card-code')];
    expect(codes).toHaveLength(2);
    expect(codes.map((c) => c.querySelector('.campusmap__card-date')!.textContent)).toEqual(['Sat Oct 31', 'Sat Nov 14']);
    // The code itself stays the first thing on the row.
    expect(codes[0]!.textContent!.startsWith('CSE-8A')).toBe(true);
    expect([...container.querySelectorAll('.campusmap__card-rows li')].map((li) => li.textContent)).toEqual([
      'Midterm 1 · Room 2622',
      'Midterm 2 · Room 105',
    ]);
    expect(container.textContent).not.toContain('10:00');
  });
});
