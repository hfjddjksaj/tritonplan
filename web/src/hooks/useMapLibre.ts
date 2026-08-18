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

export interface MapHandle {
  /** Set once created — after mount, once both `style` and `home` are non-null. */
  map: MapLibreMap | null;
  /** True once the map's `load` event has fired. */
  ready: boolean;
  /** e.g. WebGL2 missing — set from the map's `error` event. */
  error: string | null;
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

    m.on('load', () => {
      if (active) setReady(true);
    });
    m.on('move', scheduleTick);
    m.on('movestart', (e) => {
      if (active && e.originalEvent) setAtHome(false);
    });
    m.on('error', (e) => {
      if (active) setError(e.error?.message ?? 'Map failed to start');
    });

    setMap(m);

    return () => {
      active = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      m.remove();
      createdRef.current = false;
      // A genuinely clean reconstruction: nothing about the removed map's
      // state should linger into the next run (or, on a real final unmount,
      // stick around unobserved). Harmless when this is the very last
      // cleanup — nothing renders these updates afterward.
      setMap(null);
      setReady(false);
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
    map.jumpTo(cam);
    setHomeBounds(boxOf(map.getBounds()));
  }, [map, home, ready]);

  const goHome = useCallback(() => {
    const h = homeRef.current;
    if (!map || !h) return;
    const cam = map.cameraForBounds(h.bounds, { padding: h.padding });
    if (cam) map.easeTo({ ...cam, duration: durationMs() });
    setAtHome(true);
  }, [map, durationMs]);

  const zoomIn = useCallback(() => {
    map?.zoomIn({ duration: durationMs() });
    setAtHome(false);
  }, [map, durationMs]);

  const zoomOut = useCallback(() => {
    map?.zoomOut({ duration: durationMs() });
    setAtHome(false);
  }, [map, durationMs]);

  const easeCamera = useCallback(
    (o: { pitch?: number; bearing?: number }) => {
      map?.easeTo({ ...o, duration: durationMs() });
      setAtHome(false);
    },
    [map, durationMs],
  );

  return { map, ready, error, tick, atHome, homeBounds, goHome, zoomIn, zoomOut, easeCamera };
}
