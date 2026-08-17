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

  // Create the map exactly once, as soon as the container is mounted and both
  // `style` and `home` are ready. Camera-limit options are read once here at
  // construction time (not a dependency) — the map is never rebuilt just
  // because a `reduceMotion` toggle or similar gave `opts` a new identity.
  useEffect(() => {
    const node = container.current;
    if (!node || !style || !home || createdRef.current) return;
    createdRef.current = true;

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
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setTick((t) => t + 1);
      });
    };

    m.on('load', () => setReady(true));
    m.on('move', scheduleTick);
    m.on('movestart', (e) => {
      if (e.originalEvent) setAtHome(false);
    });
    m.on('error', (e) => {
      setError(e.error?.message ?? 'Map failed to start');
    });

    setMap(m);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      m.remove();
    };
  }, [container.current, style, home !== null]);

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
