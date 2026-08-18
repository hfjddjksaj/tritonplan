import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('App → campus map', () => {
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

  it('opens the map on the view the planner is showing', async () => {
    await act(async () => {
      root.render(<App />);
    });
    const finals = [...container.querySelectorAll('.toolbar [role="tab"]')].find((b) =>
      b.textContent?.includes('Finals'),
    ) as HTMLButtonElement;
    await act(async () => finals.click());
    const mapBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Map') as HTMLButtonElement;
    await act(async () => mapBtn.click());
    // CampusMap is code-split (React.lazy + Suspense), so the island arrives a few
    // ticks after the click rather than in the same flush — pump until it lands.
    for (let i = 0; i < 40 && !container.querySelector('.campusmap__island'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    const island = container.querySelector('.campusmap__island')!;
    expect(island).not.toBeNull();
    const selected = [...island.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-selected'));
    expect(selected).toEqual(['false', 'false', 'true']);
  });
});
