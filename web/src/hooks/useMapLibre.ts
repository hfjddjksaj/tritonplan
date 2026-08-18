/**
 * Owns the actual MapLibre GL map instance and its camera: creates the map
 * once a container and a style are ready, fits it to the campus "home" view,
 * and exposes a small, rAF-throttled `tick` the DOM marker overlay (Task 7)
 * re-projects on. The style object itself is applied only at construction —
 * the underlying GeoJSON never changes at runtime (see `map-style.ts`), so
 * there is nothing to react to there; what DOES change over the map's life is
 * the camera, which this hook tracks and drives.
 *
 * `maplibre-gl` is ESM-only with no default export, so it's imported by name
 * — and only as a lazy chunk: nothing here pulls in a tile server, a CDN, or
 * any other request off the page's own origin.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Map as MapLibreMap, ScaleControl } from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import type { LngLatBox } from '../lib/campus-geo';
import { configureMapWorker } from '../lib/map-worker';
import { HOME_ZOOM_BOOST } from '../lib/map-style';

/** The campus-core box the map homes to, plus the padding to fit it with. */
export interface HomeSpec {
  bounds: LngLatBox;
  padding: { top: number; right: number; bottom: number; left: number };
}

/** Camera limits and motion preference — Task 8 sources these from `map-style.ts`'s `CAMERA`. */
export interface MapCameraOptions {
  minZoom: number;
  maxZoom: number;
  maxPitch: number;
  reduceMotion: boolean;
}

/**
 * How long the map gets to fire `load` before we stop waiting on it (QA C3).
 *
 * MapLibre has exactly one honest failure channel, the `error` event, and two
 * of the three ways this map died in QA never reached it: a worker whose script
 * 404s, and a container the cascade collapsed to zero height. Both leave the map
 * "starting" forever, with `ready` false, `error` null, and nothing in the
 * console — so the student watches "Loading campus…" for the rest of the
 * session. This timer turns that silence into the same building list the WebGL
 * fallback shows.
 *
 * 12 s, chosen to be far too long rather than nearly too short. The clock starts
 * at `new Map()`, which is already AFTER the campus geometry bundles have
 * downloaded and the style object has been built — so it only has to cover
 * style parse, the worker's own script, the two glyph ranges and the first
 * paint. Measured end-to-end on this desktop (dev server, cold, StrictMode
 * double-mount included): 3.6 s from opening the map to markers on screen, of
 * which the timed window is the tail. Triple the worst phone-on-a-cold-cache
 * arithmetic (~470 KB worker over a slow link plus GeoJSON tiling on a weak
 * CPU) still lands inside 12 s.
 */
export const MAP_LOAD_TIMEOUT_MS = 12_000;

export interface MapHandle {
  /** Set once created — after mount, once both `style` and `home` are non-null. */
  map: MapLibreMap | null;
  /** True once the map's `load` event has fired. */
  ready: boolean;
  /** e.g. WebGL2 missing — set from the map's `error` event. */
  error: string | null;
  /**
   * True when the map was built but never finished starting within
   * `MAP_LOAD_TIMEOUT_MS`. A SEPARATE signal from `error`, because the failures
   * it catches are exactly the ones that raise no error at all; it is latched
   * (a `load` that arrives late still sets `ready`, and the caller gates on
   * `!ready`).
   */
  stalled: boolean;
  /** Increments (rAF-throttled) on every `move` — re-project overlays on change. */
  tick: number;
  /** False after any user-initiated move; true again after `goHome` or the initial fit. */
  atHome: boolean;
  /** `map.getBounds()` right after the last home fit. */
  homeBounds: LngLatBox | null;
  goHome(): void;
  zoomIn(): void;
  zoomOut(): void;
  easeCamera(o: { pitch?: number; bearing?: number }): void;
}

interface BoundsLike {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}

/**
 * Applies the {@link HOME_ZOOM_BOOST} framing preference to whatever
 * `cameraForBounds` answered, clamped so a small enough canvas can never
 * push the home view past `maxZoom`.
 */
function boostedHomeZoom(fittedZoom: number, maxZoom: number): number {
  return Math.min(maxZoom, fittedZoom + HOME_ZOOM_BOOST);
}

/** `map.getBounds()` → the plain `LngLatBox` the rest of the app deals in. */
function boxOf(b: BoundsLike): LngLatBox {
  return [
    [b.getWest(), b.getSouth()],
    [b.getEast(), b.getNorth()],
  ];
}

/**
 * Creates and owns a MapLibre GL map bound to `container`, once `style` and
 * `home` are both available.
 */
export function useMapLibre(
  container: RefObject<HTMLDivElement | null>,
  style: StyleSpecification | null,
  home: HomeSpec | null,
  opts: MapCameraOptions,
): MapHandle {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [atHome, setAtHome] = useState(true);
  const [homeBounds, setHomeBounds] = useState<LngLatBox | null>(null);

  // Latest values for callbacks/effects that must not re-run — or re-create
  // the map — just because a prop object got a fresh identity on some
  // unrelated render.
  const homeRef = useRef(home);
  const atHomeRef = useRef(atHome);
  const optsRef = useRef(opts);
  useEffect(() => {
    homeRef.current = home;
  }, [home]);
  useEffect(() => {
    atHomeRef.current = atHome;
  }, [atHome]);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  const durationMs = useCallback(() => (optsRef.current.reduceMotion ? 0 : 500), []);

  // Where the zoom buttons are steering, while an ease is still in flight.
  // Reading `map.getZoom()` per click sampled the ANIMATION instead: a second
  // click inside the 500 ms ease restarted from the interpolated value, so two
  // clicks moved 1.04 levels rather than 2 (QA M2). Cleared on `moveend` —
  // which covers the end of our own ease and any wheel/pinch the student does
  // in between — so it never drifts away from the real camera.
  const targetZoom = useRef<number | null>(null);

  const createdRef = useRef(false);

  // Create the map exactly once per mount, as soon as the container is
  // mounted and both `style` and `home` are ready. Camera-limit options are
  // read once here at construction time (not a dependency) — the map is
  // never rebuilt just because a `reduceMotion` toggle or similar gave
  // `opts` a new identity.
  //
  // Deliberately NOT keyed on `container.current` (despite that being the
  // dependency this hook started with): a ref's `.current` is read fresh
  // inside the effect body below regardless, and by the time ANY passive
  // effect runs after a commit, a ref attached during that same commit's
  // render is already set — so it adds nothing on the renders that matter.
  // What it DOES add is a bug: `container.current` is `null` in the deps
  // array captured during the render that first mounts the container div
  // (refs attach during commit, which happens after that render computes its
  // deps), then non-null on the very next render — which this effect's own
  // `setMap` call triggers. React sees that as a changed dependency and
  // tears the effect down and reruns it, EVERY mount, not just under
  // StrictMode. `FakeMap.remove()` being a harmless flag flip masked this in
  // the original test run; a real `maplibre-gl` `Map.remove()` genuinely
  // tears down the WebGL context, so this was already the dev-breaks-on-
  // every-load bug, just with a shorter fuse than the StrictMode case below.
  //
  // "Once per mount", not "once ever": this app renders under <StrictMode>
  // (web/src/main.tsx), which double-invokes every effect in development —
  // run, cleanup, run again — to flush out exactly this class of bug. The
  // cleanup below resets `createdRef` so the second run genuinely rebuilds a
  // live map instead of bailing out on the guard and leaving `map` pointing
  // at the instance the cleanup just removed; the `active` flag stops the
  // torn-down instance's still-pending async events (`load` fires on a
  // `queueMicrotask`, so it outlives a synchronous double-invoke) from
  // writing into state after the fact.
  useEffect(() => {
    const node = container.current;
    if (!node || !style || !home || createdRef.current) return;
    createdRef.current = true;
    let active = true;
    // Before the constructor, never after: MapLibre reads the worker URL when it
    // spins up its worker pool, which happens inside `new Map()`.
    configureMapWorker();

    const m = new MapLibreMap({
      container: node,
      style,
      minZoom: opts.minZoom,
      maxZoom: opts.maxZoom,
      maxPitch: opts.maxPitch,
      attributionControl: false,
      dragRotate: true,
      touchPitch: true,
      pitchWithRotate: true,
      fadeDuration: 0,
      canvasContextAttributes: { antialias: true },
    });
    m.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

    // One rAF per burst of synchronous `move` events — cheap enough to
    // re-project overlay markers on, without doing it once per camera frame
    // during a drag or an animated ease.
    let rafId: number | null = null;
    const scheduleTick = () => {
      if (!active || rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setTick((t) => t + 1);
      });
    };

    // Stop waiting on a map that is never going to start. Cleared by `load`,
    // so a map that does start never pays for this.
    let loadTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      loadTimer = null;
      if (active) setStalled(true);
    }, MAP_LOAD_TIMEOUT_MS);

    m.on('load', () => {
      if (loadTimer !== null) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
      if (active) setReady(true);
    });
    m.on('move', scheduleTick);
    // Let go of the accumulated zoom target only when the camera ACTUALLY got
    // there. Clearing on every `moveend` looked right and was not: starting an
    // ease while another is running makes MapLibre stop the old one, and
    // stopping it fires `moveend` — from inside the very `easeTo` call that had
    // just set the new target, so the second of two fast clicks wiped its own
    // accumulator and the button lost the step it was meant to add. Measured in
    // a real browser: two clicks moved 1 level, not 2, even with the ref in
    // place. An interrupted ease ends short of the target, so this test tells
    // the two cases apart.
    m.on('moveend', () => {
      const t = targetZoom.current;
      if (t !== null && Math.abs(m.getZoom() - t) < 1e-6) targetZoom.current = null;
    });
    m.on('movestart', (e) => {
      // A wheel, a pinch or a drag is the student steering, not the buttons —
      // the next button press must start from where they actually are.
      if (e.originalEvent) targetZoom.current = null;
      if (active && e.originalEvent) setAtHome(false);
    });
    m.on('error', (e) => {
      if (active) setError(e.error?.message ?? 'Map failed to start');
    });

    setMap(m);

    return () => {
      active = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (loadTimer !== null) clearTimeout(loadTimer);
      m.remove();
      createdRef.current = false;
      // A genuinely clean reconstruction: nothing about the removed map's
      // state should linger into the next run (or, on a real final unmount,
      // stick around unobserved). Harmless when this is the very last
      // cleanup — nothing renders these updates afterward.
      setMap(null);
      setReady(false);
      setStalled(false);
      setError(null);
      setHomeBounds(null);
      setAtHome(true);
      setTick(0);
    };
  }, [style, home !== null]);

  // Fits the camera to `home`: once the map finishes loading, and again
  // whenever `home` itself changes (e.g. a viewport resize reflows the
  // padding) — but only while the student hasn't panned away, so this never
  // yanks the view out from under them mid-drag.
  useEffect(() => {
    if (!map || !ready || !home) return;
    if (!atHomeRef.current) return;
    const cam = map.cameraForBounds(home.bounds, { padding: home.padding });
    if (!cam) return;
    map.jumpTo({ ...cam, zoom: boostedHomeZoom(cam.zoom ?? map.getZoom(), optsRef.current.maxZoom) });
    setHomeBounds(boxOf(map.getBounds()));
  }, [map, home, ready]);

  const goHome = useCallback(() => {
    const h = homeRef.current;
    if (!map || !h) return;
    const cam = map.cameraForBounds(h.bounds, { padding: h.padding });
    // `cameraForBounds` answers centre/zoom/bearing and says nothing about
    // pitch, so a tilted map used to stay tilted through "Reset view" — the
    // student had no way back to flat at all (QA I3). "Reset" means the view
    // the map opened on, and that view is flat and north-up — and, since the
    // fit-on-load effect above boosts the same `cameraForBounds` answer,
    // "Reset" has to boost it too, or it would land the camera on a WIDER
    // view than the one the map actually opened on.
    if (cam)
      map.easeTo({
        ...cam,
        zoom: boostedHomeZoom(cam.zoom ?? map.getZoom(), optsRef.current.maxZoom),
        bearing: 0,
        pitch: 0,
        duration: durationMs(),
      });
    targetZoom.current = null;
    setAtHome(true);
  }, [map, durationMs]);

  const stepZoom = useCallback(
    (delta: number) => {
      if (!map) return;
      const { minZoom, maxZoom } = optsRef.current;
      const from = targetZoom.current ?? map.getZoom();
      const next = Math.min(maxZoom, Math.max(minZoom, from + delta));
      targetZoom.current = next;
      map.easeTo({ zoom: next, duration: durationMs() });
      setAtHome(false);
    },
    [map, durationMs],
  );

  const zoomIn = useCallback(() => stepZoom(1), [stepZoom]);
  const zoomOut = useCallback(() => stepZoom(-1), [stepZoom]);

  const easeCamera = useCallback(
    (o: { pitch?: number; bearing?: number }) => {
      if (!map) return;
      // A control that changes nothing must not report that it did: pressing
      // the compass at bearing 0 used to re-enable "Reset view" for a camera
      // that never moved (QA M4).
      const settled = (want: number | undefined, have: number) => want === undefined || Math.abs(want - have) < 0.01;
      if (settled(o.bearing, map.getBearing()) && settled(o.pitch, map.getPitch())) return;
      // This ease interrupts any zoom ease in flight, and an interrupted one ends
      // SHORT of its target — so the "did we arrive?" release test in `moveend`
      // never fires and the accumulator would sit there stale, making the next
      // zoom click step from a zoom the camera never reached. `goHome` already
      // lets go for the same reason.
      targetZoom.current = null;
      map.easeTo({ ...o, duration: durationMs() });
      setAtHome(false);
    },
    [map, durationMs],
  );

  return { map, ready, stalled, error, tick, atHome, homeBounds, goHome, zoomIn, zoomOut, easeCamera };
}
