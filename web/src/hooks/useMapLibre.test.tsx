import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FakeMap, fakeMapLibreModule, workerUrls } from '../test/fake-maplibre';
import { MAP_WORKER_URL } from '../lib/map-worker';
vi.mock('maplibre-gl', () => fakeMapLibreModule);
import { useMapLibre, MAP_LOAD_TIMEOUT_MS, type MapHandle, type HomeSpec } from './useMapLibre';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const STYLE = { version: 8 as const, sources: {}, layers: [] };
const HOME = { bounds: [[-117.245, 32.872], [-117.225, 32.892]] as [[number, number], [number, number]], padding: { top: 100, right: 20, bottom: 20, left: 20 } };

function Harness({ onHandle, home = HOME, reduceMotion = true }: { onHandle: (h: MapHandle) => void; home?: typeof HOME; reduceMotion?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const h = useMapLibre(ref, STYLE, home, { minZoom: 13.5, maxZoom: 19, maxPitch: 65, reduceMotion });
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

  // THE call-site guard. `map-worker.test.ts` proves `configureMapWorker()` does
  // the right thing when called; this proves it is called at all — which is the
  // line that actually keeps the map alive. Delete `configureMapWorker()` from the
  // creation effect and everything else stays green: every other unit test passes,
  // and `verify-build.mjs` passes too, because the module is still in the graph so
  // the worker asset still emits and is still referenced. Production just goes back
  // to "Loading campus…" forever — now dressed up by C3's timeout as a slow map
  // rather than a bug. This test is the only thing standing between that line and
  // the nine tasks it already survived.
  //
  // It has to run FIRST in this file: `configureMapWorker()` is idempotent, so only
  // the first map built in this module registry records anything.
  it('points MapLibre at our own bundled worker BEFORE it builds the map', async () => {
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Harness onHandle={() => {}} />));
    await flush();
    expect(FakeMap.instances.length).toBeGreaterThan(0);
    expect(workerUrls.length).toBeGreaterThan(0);
    // The URL handed over is exactly the one the bundler emitted...
    expect(workerUrls[0]!.url).toBe(MAP_WORKER_URL);
    // ...and it arrived before any map existed. MapLibre reads it in the Map
    // constructor, so "after" is the same as "never".
    expect(workerUrls[0]!.mapsBuilt).toBe(0);
    await act(async () => root.unmount());
  });

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

  it('easeCamera does nothing — and does not un-home the view — when the camera is already there', async () => {
    // QA M4: the compass pressed at bearing 0 used to re-enable "Reset view" for
    // a camera that never moved.
    let handle!: MapHandle;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} />));
    await flush();
    const m = FakeMap.instances[0]!;
    expect(handle.atHome).toBe(true);
    const eases = m.easeRequests.length;
    await act(async () => handle.easeCamera({ bearing: 0, pitch: 0 }));
    expect(m.easeRequests).toHaveLength(eases);
    expect(handle.atHome).toBe(true);
    // ...but it still fires once the camera has actually drifted.
    await act(async () => handle.easeCamera({ bearing: 0, pitch: 40 }));
    expect(handle.atHome).toBe(false);
    await act(async () => handle.easeCamera({ bearing: 0, pitch: 0 }));
    expect(m.getPitch()).toBe(0);
  });

  it('goHome levels the map, not just its bearing', async () => {
    // QA I3: cameraForBounds answers centre/zoom/bearing and says nothing about
    // pitch, so a tilted map stayed tilted through "Reset view" forever.
    let handle!: MapHandle;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} />));
    await flush();
    const m = FakeMap.instances[0]!;
    await act(async () => handle.easeCamera({ pitch: 50, bearing: -30 }));
    expect(m.getPitch()).toBe(50);
    await act(async () => handle.goHome());
    await flush();
    expect(m.getPitch()).toBe(0);
    expect(m.getBearing()).toBe(0);
    expect(handle.atHome).toBe(true);
  });

  it('accumulates zoom steps instead of re-reading a camera that is still animating', async () => {
    // QA M2: two clicks inside the 500 ms ease moved 1.04 levels, not 2, because
    // the second click started from the interpolated zoom.
    FakeMap.easeProgress = 0.4;
    let handle!: MapHandle;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () =>
      root.render(<Harness onHandle={(h) => (handle = h)} reduceMotion={false} />),
    );
    await flush();
    const m = FakeMap.instances[0]!;
    await act(async () => m.jumpTo({ zoom: 17 })); // room to step twice inside [13.5, 19]
    const z0 = m.getZoom();
    // Three, not two: starting an ease STOPS the one in flight, and stopping it
    // fires `moveend` from inside that same `easeTo` call — so a naive "clear on
    // moveend" survives the second click and only loses the third. That is the
    // shape the real browser showed (two clicks moved 1 level, not 2).
    await act(async () => handle.zoomOut());
    await act(async () => handle.zoomOut());
    await act(async () => handle.zoomOut());
    const asked = m.easeRequests.filter((r) => typeof r.zoom === 'number').map((r) => r.zoom);
    expect(asked.at(-3)).toBeCloseTo(z0 - 1, 6);
    expect(asked.at(-2)).toBeCloseTo(z0 - 2, 6);
    expect(asked.at(-1)).toBeCloseTo(z0 - 3, 6);
    // And the accumulator lets go once the camera settles, so the next click
    // starts from wherever the student actually is.
    FakeMap.easeProgress = 1;
    await act(async () => m.simulateUserPan(0.01, 0));
    await act(async () => handle.zoomIn());
    expect(m.easeRequests.at(-1)!.zoom).toBeCloseTo(m.getZoom(), 6);
  });

  it('never lets the zoom buttons walk past the camera limits', async () => {
    let handle!: MapHandle;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} />));
    await flush();
    const m = FakeMap.instances[0]!;
    for (let i = 0; i < 12; i++) await act(async () => handle.zoomOut());
    expect(m.getZoom()).toBe(13.5);
    for (let i = 0; i < 30; i++) await act(async () => handle.zoomIn());
    expect(m.getZoom()).toBe(19);
  });

  it('gives up on a map that never starts, without waiting on an error that is not coming', async () => {
    // QA C3: a 404'd worker chunk and a zero-height container both leave the map
    // "starting" forever — ready false, error null, console clean. Nothing else
    // in the app can tell that apart from a slow load.
    vi.useFakeTimers();
    try {
      FakeMap.autoLoad = false;
      let handle!: MapHandle;
      const root = createRoot(document.body.appendChild(document.createElement('div')));
      await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} />));
      expect(handle.ready).toBe(false);
      expect(handle.error).toBeNull();
      expect(handle.stalled).toBe(false);
      await act(async () => { vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS - 1); });
      expect(handle.stalled).toBe(false);
      await act(async () => { vi.advanceTimersByTime(2); });
      expect(handle.stalled).toBe(true);
      expect(handle.error).toBeNull(); // still no error — that is the whole point
    } finally {
      vi.useRealTimers();
    }
  });

  it('never gives up on a map that did start', async () => {
    vi.useFakeTimers();
    try {
      let handle!: MapHandle;
      const root = createRoot(document.body.appendChild(document.createElement('div')));
      await act(async () => root.render(<Harness onHandle={(h) => (handle = h)} />));
      await act(async () => { await Promise.resolve(); });
      expect(handle.ready).toBe(true);
      await act(async () => { vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS * 3); });
      expect(handle.stalled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
