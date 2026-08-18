import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FakeMap, fakeMapLibreModule } from '../test/fake-maplibre';
vi.mock('maplibre-gl', () => fakeMapLibreModule);
import { useMapLibre, type MapHandle, type HomeSpec } from './useMapLibre';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const STYLE = { version: 8 as const, sources: {}, layers: [] };
const HOME = { bounds: [[-117.245, 32.872], [-117.225, 32.892]] as [[number, number], [number, number]], padding: { top: 100, right: 20, bottom: 20, left: 20 } };

function Harness({ onHandle, home = HOME }: { onHandle: (h: MapHandle) => void; home?: typeof HOME }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const h = useMapLibre(ref, STYLE, home, { minZoom: 13.5, maxZoom: 19, maxPitch: 65, reduceMotion: true });
  onHandle(h);
  return <div ref={ref} />;
}
// jsdom (pretendToBeVisual, the default under vitest's jsdom environment) backs
// requestAnimationFrame with a real ~16.67ms setInterval — a 0ms setTimeout has
// no guaranteed budget to let a scheduled rAF actually fire before flush()
// returns. 20ms clears that floor with margin; this is a test-harness timing
// fix, not a change to the hook's throttling (task-6 Ruling 2).
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 20)); }); };

describe('useMapLibre', () => {
  beforeEach(() => FakeMap.reset());

  it('creates one map, fits home on load, exposes homeBounds and camera helpers', async () => {
    let handle!: MapHandle;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} />));
    await flush();
    expect(FakeMap.instances).toHaveLength(1);
    const m = FakeMap.instances[0]!;
    expect(m.opts.minZoom).toBe(13.5); expect(m.opts.attributionControl).toBe(false);
    expect(handle.ready).toBe(true);
    expect(handle.atHome).toBe(true);
    expect(handle.homeBounds![0][0]).toBeLessThan(-117.235);
    expect(m.getCenter().lng).toBeCloseTo(-117.235, 3);
    const tickBefore = handle.tick;
    await act(async () => { m.simulateUserPan(0.01, 0); });
    await flush();
    expect(handle.atHome).toBe(false);
    expect(handle.tick).toBeGreaterThan(tickBefore);
    await act(async () => handle.goHome());
    await flush();
    expect(handle.atHome).toBe(true);
    expect(m.getCenter().lng).toBeCloseTo(-117.235, 3);
    await act(async () => handle.zoomIn());
    expect(m.getZoom()).toBe(16);
    expect(handle.atHome).toBe(false);
    await act(async () => root.unmount());
    expect(m.removed).toBe(true);
  });

  it('surfaces a map error instead of hanging', async () => {
    let handle!: MapHandle;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} />));
    await flush();
    await act(async () => { FakeMap.instances[0]!.fire('error', { error: new Error('WebGL2 unavailable') }); });
    expect(handle.error).toBe('WebGL2 unavailable');
    await act(async () => root.unmount());
  });

  it('never recreates the map across re-renders', async () => {
    let handle!: MapHandle;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} />));
    await flush();
    expect(FakeMap.instances).toHaveLength(1);
    // Re-render with a brand-new (but equal) style/home object identity — the
    // creation effect must not treat this as a reason to build a second map.
    await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} home={{ ...HOME, padding: { ...HOME.padding } }} />));
    await flush();
    expect(FakeMap.instances).toHaveLength(1);
    expect(handle.map).toBe(FakeMap.instances[0]);
    await act(async () => root.unmount());
  });

  it('re-fits on a home change while at home, but not after a user pan', async () => {
    let handle!: MapHandle;
    let setHome!: (h: HomeSpec) => void;
    function Controlled() {
      const ref = useRef<HTMLDivElement | null>(null);
      const [home, setHomeState] = useState(HOME);
      setHome = setHomeState;
      const h = useMapLibre(ref, STYLE, home, { minZoom: 13.5, maxZoom: 19, maxPitch: 65, reduceMotion: true });
      handle = h;
      return <div ref={ref} />;
    }
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Controlled />));
    await flush();
    const m = FakeMap.instances[0]!;
    expect(handle.atHome).toBe(true);

    // Case 1: home changes (to a box with a different center) while still at
    // home -> re-fits (new center, new homeBounds).
    const boundsAfterFirstFit = handle.homeBounds;
    const shiftedHome: HomeSpec = {
      bounds: [[-117.24, 32.87], [-117.2, 32.91]],
      padding: HOME.padding,
    };
    await act(async () => setHome(shiftedHome));
    await flush();
    expect(handle.homeBounds).not.toEqual(boundsAfterFirstFit);
    expect(m.getCenter().lng).toBeCloseTo((-117.24 + -117.2) / 2, 3);

    // Case 2: user pans away, then home changes again -> no auto re-fit.
    await act(async () => { m.simulateUserPan(0.02, 0); });
    await flush();
    expect(handle.atHome).toBe(false);
    const centerAfterPan = m.getCenter();
    const boundsBeforeSecondHomeChange = handle.homeBounds;
    await act(async () => setHome(HOME));
    await flush();
    expect(handle.atHome).toBe(false);
    expect(handle.homeBounds).toEqual(boundsBeforeSecondHomeChange);
    expect(m.getCenter().lng).toBeCloseTo(centerAfterPan.lng, 5);

    await act(async () => root.unmount());
  });

  // Fix round 1, Finding 1: this app renders under <StrictMode> (web/src/main.tsx),
  // which double-invokes every effect on mount in development — run, cleanup, run
  // again. The creation effect's once-only guard must survive that: the SECOND
  // run has to build a fresh map, not bail out and leave `map` pointing at the
  // first (already-removed) instance.
  it('rebuilds a live map after a StrictMode double-invoke (mount, cleanup, mount)', async () => {
    let handle!: MapHandle;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness onHandle={(h) => (handle = h)} />
        </StrictMode>,
      ),
    );
    await flush();
    expect(handle.map).not.toBeNull();
    // `MapHandle.map` is typed as the real maplibre-gl `Map`; under `vi.mock`
    // it's actually the `FakeMap` double at runtime — narrow once here, then
    // read everything off `FakeMap.instances` like the rest of this file does.
    const liveMap = handle.map as unknown as FakeMap;
    expect(liveMap.removed).toBe(false);
    // Every OTHER instance the double-invoke created must be the one that got
    // torn down — the hook must be holding the live map, not a removed one.
    const others = FakeMap.instances.filter((m) => m !== liveMap);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((m) => m.removed)).toBe(true);
    await act(async () => root.unmount());
  });

  // Fix round 1, Finding 2(a): the throttle's entire point is coalescing a
  // burst of moves into one rAF — a regression that ticked synchronously on
  // every `move` would still pass every other test in this file unchanged.
  it('coalesces a burst of synchronous move events into exactly one tick', async () => {
    let handle!: MapHandle;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} />));
    await flush();
    const m = FakeMap.instances[FakeMap.instances.length - 1]!;
    const tickBefore = handle.tick;
    await act(async () => {
      m.simulateUserPan(0.001, 0);
      m.simulateUserPan(0.001, 0);
      m.simulateUserPan(0.001, 0);
    });
    await flush();
    expect(handle.tick).toBe(tickBefore + 1);
  });

  it('zoomOut reaches the map and marks atHome false', async () => {
    let handle!: MapHandle;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} />));
    await flush();
    const m = FakeMap.instances[0]!;
    const zoomBefore = m.getZoom();
    await act(async () => handle.zoomOut());
    expect(m.getZoom()).toBe(zoomBefore - 1);
    expect(handle.atHome).toBe(false);
  });

  it('easeCamera reaches the map and marks atHome false', async () => {
    let handle!: MapHandle;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} />));
    await flush();
    const m = FakeMap.instances[0]!;
    await act(async () => handle.easeCamera({ pitch: 55, bearing: -25 }));
    expect(m.getPitch()).toBe(55);
    expect(m.getBearing()).toBe(-25);
    expect(handle.atHome).toBe(false);
  });
});
