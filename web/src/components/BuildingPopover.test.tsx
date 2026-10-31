import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BuildingPopover } from './BuildingPopover';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** The action buttons in order: [label, primary?]. */
const actions = () =>
  [...container.querySelectorAll<HTMLElement>('.mappop__actions .btn')].map((b) => [
    b.textContent!.trim(),
    b.classList.contains('btn--primary'),
  ]);

describe('BuildingPopover', () => {
  it('offers TritonPlan’s own map first, then Google Maps, and no UCSD map', () => {
    const open = vi.fn();
    act(() => root.render(<BuildingPopover building="Center Hall" room="109" onOpenCampusMap={open} onClose={vi.fn()} />));
    expect(actions()).toEqual([
      ['TritonPlan map', true],
      ['Google Maps', false],
    ]);
    expect(container.textContent).not.toContain('UCSD campus map');
    act(() => container.querySelector<HTMLButtonElement>('.mappop__actions button')!.click());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('leaves Google Maps alone where TritonPlan’s map has nothing to show', () => {
    // Inside the campus map (no handler), and for a building the map cannot place.
    act(() => root.render(<BuildingPopover building="Center Hall" onClose={vi.fn()} />));
    expect(actions()).toEqual([['Google Maps', true]]);
    act(() => root.render(<BuildingPopover building="Nowhere Annex" onOpenCampusMap={vi.fn()} onClose={vi.fn()} />));
    expect(actions()).toEqual([['Google Maps', true]]);
  });
});
