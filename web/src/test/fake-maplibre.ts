/**
 * Test double for `maplibre-gl` — jsdom has no WebGL, so tests `vi.mock('maplibre-gl', …)`
 * to this module. It models exactly what the planner uses: a camera you can move and
 * project through, an event bus, and a recorder for style mutations. Nothing renders.
 */
type Handler = (ev: Record<string, unknown>) => void;

export interface FakeCamera { center: [number, number]; zoom: number; bearing: number; pitch: number }

export class FakeLngLatBounds {
  constructor(public sw: [number, number], public ne: [number, number]) {}
  getWest() { return this.sw[0]; }
  getSouth() { return this.sw[1]; }
  getEast() { return this.ne[0]; }
  getNorth() { return this.ne[1]; }
  contains(p: [number, number]) {
    return p[0] >= this.sw[0] && p[0] <= this.ne[0] && p[1] >= this.sw[1] && p[1] <= this.ne[1];
  }
}

export class FakeScaleControl {
  constructor(public opts?: unknown) {}
  onAdd() { return document.createElement('div'); }
  onRemove() {}
}

export class FakeMap {
  static instances: FakeMap[] = [];
  static size = { w: 1100, h: 760 };
  /**
   * Whether a new map fires `load` by itself. Set false to model a browser
   * that cannot start the map at all (no WebGL2): the instance is still
   * constructed and still fires `error`, but `load` never comes — which is
   * what separates a fatal failure from a recoverable one. Restored to true
   * by `reset()`, so a test that flips it cannot leak into the next.
   */
  static autoLoad = true;
  /**
   * How far an animated `easeTo` gets before the test looks. 1 = it lands and
   * fires `moveend`, which is what every test that does not care wants. Set
   * below 1 to model an ease still IN FLIGHT: the camera sits part-way there and
   * no `moveend` comes, which is the state a second zoom-button click used to
   * read its starting zoom from (QA M2). Only applies when a duration was asked
   * for — `reduceMotion` callers pass 0 and always land.
   */
  static easeProgress = 1;
  static reset() { FakeMap.instances = []; FakeMap.autoLoad = true; FakeMap.easeProgress = 1; }

  readonly opts: Record<string, unknown>;
  calls: { method: string; args: unknown[] }[] = [];
  removed = false;
  private handlers = new Map<string, Handler[]>();
  private cam: FakeCamera = { center: [0, 0], zoom: 0, bearing: 0, pitch: 0 };
  private terrain: unknown = null;
  private images = new Set<string>();

  constructor(opts: Record<string, unknown>) {
    this.opts = opts;
    if (opts.center) this.cam.center = opts.center as [number, number];
    if (typeof opts.zoom === 'number') this.cam.zoom = opts.zoom;
    FakeMap.instances.push(this);
    if (FakeMap.autoLoad) queueMicrotask(() => this.fire('load', {}));
  }

  /* events */
  on(type: string, fn: Handler) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); return this; }
  once(type: string, fn: Handler) {
    const wrap: Handler = (ev) => { this.off(type, wrap); fn(ev); };
    return this.on(type, wrap);
  }
  off(type: string, fn: Handler) {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter((h) => h !== fn));
    return this;
  }
  fire(type: string, ev: Record<string, unknown>) {
    for (const h of [...(this.handlers.get(type) ?? [])]) h({ type, target: this, ...ev });
    return this;
  }

  /* camera */
  private pxPerDeg() { return (256 * 2 ** this.cam.zoom) / 360; }
  /**
   * How far terrain currently lifts a projected point up the screen. Real
   * MapLibre folds the DEM elevation under a coordinate into `project()`; the
   * only property that matters to a caller is that the SAME camera can answer
   * differently once the DEM has loaded. See {@link simulateTerrainLoad}.
   */
  private lift = 0;
  project(p: [number, number]) {
    const s = this.pxPerDeg();
    return { x: (p[0] - this.cam.center[0]) * s + FakeMap.size.w / 2, y: (this.cam.center[1] - p[1]) * s + FakeMap.size.h / 2 - this.lift };
  }
  /**
   * What a DEM tile finishing its download looks like from the outside: the
   * ground under everything rises, so `project()` answers `px` higher for an
   * unchanged camera, and the map repaints. It fires `terrain` and `render` and
   * deliberately NOT `move` — that combination is the whole failure mode, and a
   * marker overlay that only listens to `move` freezes at the old position.
   */
  simulateTerrainLoad(px: number) {
    this.lift = px;
    this.fire('terrain', {}); this.fire('render', {});
    return this;
  }
  unproject(p: { x: number; y: number }): [number, number] {
    const s = this.pxPerDeg();
    return [this.cam.center[0] + (p.x - FakeMap.size.w / 2) / s, this.cam.center[1] - (p.y - FakeMap.size.h / 2) / s];
  }
  private move(next: Partial<FakeCamera>, ev: Record<string, unknown> = {}) {
    this.cam = { ...this.cam, ...next };
    this.fire('movestart', ev); this.fire('move', ev); this.fire('moveend', ev);
    return this;
  }
  jumpTo(o: Partial<FakeCamera>) { return this.move(o); }
  /** Every camera target `easeTo` was asked for, in order — what was REQUESTED, not what landed. */
  easeRequests: (Partial<FakeCamera> & { duration?: number })[] = [];
  /** An ease is still running: the next one has to stop it first, like the real thing. */
  private animating = false;
  easeTo(o: Partial<FakeCamera> & { duration?: number }) {
    // Real MapLibre stops a running animation before starting a new one, and
    // stopping it fires `moveend` — synchronously, from inside this call. That
    // detail is load-bearing (it wiped the zoom-button accumulator), so it is
    // modelled rather than glossed over.
    if (this.animating) {
      this.animating = false;
      this.fire('moveend', {});
    }
    this.easeRequests.push(o);
    const { duration = 0, ...cam } = o;
    if (duration > 0 && FakeMap.easeProgress < 1) {
      const p = FakeMap.easeProgress;
      const partial = { ...cam };
      if (typeof cam.zoom === 'number') partial.zoom = this.cam.zoom + (cam.zoom - this.cam.zoom) * p;
      this.cam = { ...this.cam, ...partial };
      this.animating = true;
      this.fire('movestart', {}); this.fire('move', {}); // no moveend: still animating
      return this;
    }
    return this.move(cam);
  }
  zoomIn() { return this.move({ zoom: this.cam.zoom + 1 }); }
  zoomOut() { return this.move({ zoom: this.cam.zoom - 1 }); }
  /**
   * What a click on the GL canvas looks like from the outside. Real MapLibre
   * always carries `point` (canvas-relative pixels) and only fires `click` when
   * the press was not a drag; the app hit-tests markers against that point, so a
   * fake click without one is not a click.
   */
  simulateMapClick(x: number, y: number) { return this.fire('click', { point: { x, y } }); }
  /** Pointer motion over the canvas — drives the hover/cursor hit test. */
  simulateMapMouseMove(x: number, y: number) { return this.fire('mousemove', { point: { x, y } }); }
  /** What a user drag looks like from the outside: a move that carries an originalEvent. */
  simulateUserPan(dLng: number, dLat: number) {
    return this.move({ center: [this.cam.center[0] + dLng, this.cam.center[1] + dLat] }, { originalEvent: new Event('pointermove') });
  }
  /**
   * What a right-drag / two-finger tilt looks like from the outside: the pitch
   * moves AND the events carry an originalEvent, which is the only thing that
   * separates a hand from an easeTo (see the mode rule in CampusMap).
   */
  simulateUserTilt(pitch: number) {
    this.cam = { ...this.cam, pitch };
    const ev = { originalEvent: new Event('pointermove') };
    this.fire('pitch', ev); this.fire('move', ev); this.fire('moveend', ev);
    return this;
  }
  getZoom() { return this.cam.zoom; }
  getCenter() { return { lng: this.cam.center[0], lat: this.cam.center[1] }; }
  getBearing() { return this.cam.bearing; }
  getPitch() { return this.cam.pitch; }
  getBounds() {
    const s = this.pxPerDeg();
    const hw = FakeMap.size.w / 2 / s;
    const hh = FakeMap.size.h / 2 / s;
    const [lng, lat] = this.cam.center;
    return new FakeLngLatBounds([lng - hw, lat - hh], [lng + hw, lat + hh]);
  }
  cameraForBounds(b: [[number, number], [number, number]], _o?: unknown) {
    return { center: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] as [number, number], zoom: 15, bearing: 0 };
  }

  /* style mutations — recorded, not applied */
  private rec(method: string, ...args: unknown[]) { this.calls.push({ method, args }); return this; }
  setPaintProperty(...a: unknown[]) { return this.rec('setPaintProperty', ...a); }
  setLayoutProperty(...a: unknown[]) { return this.rec('setLayoutProperty', ...a); }
  setFilter(...a: unknown[]) { return this.rec('setFilter', ...a); }
  getLayer(id: string) { return { id }; }
  getSource(id: string) { return { id, setData: (d: unknown) => this.rec('setData', id, d) }; }
  addImage(id: string, ...rest: unknown[]) { this.images.add(id); return this.rec('addImage', id, ...rest); }
  hasImage(id: string) { return this.images.has(id); }
  setTerrain(t: unknown) { this.terrain = t; return this.rec('setTerrain', t); }
  getTerrain() { return this.terrain; }
  addControl(...a: unknown[]) { return this.rec('addControl', ...a); }
  resize() { return this; }
  remove() { this.removed = true; }
  getCanvas() { return document.createElement('canvas'); }
  getContainer() { return this.opts.container as HTMLElement; }
  isStyleLoaded() { return true; }
}

/** The named exports a `vi.mock('maplibre-gl', …)` factory should return. */
export const fakeMapLibreModule = {
  Map: FakeMap,
  LngLatBounds: FakeLngLatBounds,
  ScaleControl: FakeScaleControl,
  /** Recorded, not applied — `map-worker.ts` calls this before every map is built. */
  setWorkerUrl: (url: string) => { workerUrls.push({ url, mapsBuilt: FakeMap.instances.length }); },
};

/**
 * Every URL `setWorkerUrl` was handed, in order, with how many maps already
 * existed when it arrived. `mapsBuilt` is the half that matters: MapLibre reads
 * the worker URL inside the `Map` constructor, so a call that lands after the
 * first map is a call that came too late.
 */
export const workerUrls: { url: string; mapsBuilt: number }[] = [];
