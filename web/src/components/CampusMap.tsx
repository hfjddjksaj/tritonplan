import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PlanState } from '@triton/shared';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  campusPadding,
  coreBounds,
  loadCampusGeo,
  loadCampusMap,
  type CampusGeo,
  type CampusMapData,
} from '../lib/campus-geo';
import { buildSources } from '../lib/map-data';
import { applyHosts, applyMode, assetBase, buildStyle, CAMERA, type MapMode } from '../lib/map-style';
import {
  defaultSliceId,
  finalPins,
  hasNoLocation,
  meetingPins,
  midtermPins,
  slicesFor,
  todayKey,
  type MapPin,
  type SliceBy,
} from '../lib/map-pins';
import {
  groupPins,
  hitMarker,
  inside,
  markerLabel,
  splitByBounds,
  unplacedPins,
  type PlacedMarker,
} from '../lib/map-labels';
import { loadMapBookedOnly, saveMapBookedOnly } from '../lib/storage';
import { pluralize } from '../lib/format';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useIsMobile } from '../hooks/useIsMobile';
import { useMapLibre } from '../hooks/useMapLibre';
import { useMarkerLayout } from '../hooks/useMarkerLayout';
import { useElementHeight, useStageSize } from '../hooks/useStageSize';
import { useWheelToHorizontal } from '../hooks/useWheelToHorizontal';
import { MapMarkers } from './MapMarkers';
import { MarkerCard } from './MarkerCard';
import { BuildingPopover } from './BuildingPopover';
import { ViewTabs, type PlannerView } from './ViewTabs';
import { Check, ChevronDown, Compass, MapPinIcon, Minus, Plus, X } from './icons';

interface Props {
  /** The plan on screen — yours, or a received one. */
  plan: PlanState;
  /** Course ids the student is enrolled in. RENDER-TIME ONLY; never persisted here. */
  booked: ReadonlySet<string>;
  /** Viewing someone else's plan — the booked toggle is meaningless then. */
  readOnly: boolean;
  /** The tab the map opens on — the planner's current view. One-way: switching tabs here never changes the planner. */
  initialView?: PlannerView;
  onClose: () => void;
}

/** Nobody's booked set applies to someone else's plan — see §5.4. */
const NO_BOOKED: ReadonlySet<string> = new Set();

/** The island's height until it has been measured (and under jsdom): three rows. */
const ISLAND_FALLBACK_H = 118;
/** Gap between the island's bottom edge and where the fitted map may begin. */
const ISLAND_TOP = 10;
const ISLAND_GAP = 8;

interface MapViewDef {
  /** Tab / summary label. The first tab reads "Classes" here, not "Calendar": the map shows where classes are, not a calendar. */
  label: string;
  /** Slice granularity — one level below the view's span (see slicesFor). */
  by: SliceBy;
  sliceAria: string;
  pins: (plan: PlanState, booked: ReadonlySet<string>) => MapPin[];
  /** Shown over the basemap when nothing in this view can be placed. */
  empty: string;
  /** What this view's pins are called in the "TSS hasn’t listed a room" copy: "classes" / "midterms" / "finals". */
  noun: string;
}

const MAP_VIEWS: Record<PlannerView, MapViewDef> = {
  calendar: {
    label: 'Classes',
    by: 'weekday',
    sliceAria: 'Filter by day',
    pins: meetingPins,
    empty: 'No class locations to place yet. Add courses with scheduled meetings, and they’ll appear here.',
    noun: 'classes',
  },
  midterms: {
    label: 'Midterms',
    by: 'week',
    sliceAria: 'Filter by week',
    pins: midtermPins,
    empty: 'No midterm locations yet — TSS hasn’t announced a dated midterm for these courses.',
    noun: 'midterms',
  },
  finals: {
    label: 'Finals',
    by: 'date',
    sliceAria: 'Filter by date',
    pins: finalPins,
    empty: 'No final exam locations yet. Pick sections that carry a final and they’ll appear here.',
    noun: 'finals',
  },
};

/**
 * Full-screen campus map, toggled by state rather than a route: the address bar
 * hash is already owned by share links (#p=) and the self-mirror (#m=), so a
 * router would collide with readHash(). `position: fixed` covers the viewport
 * regardless of DOM depth, so — like BuildingPopover — this renders inline
 * rather than through a portal.
 *
 * The map IS the page: a MapLibre GL canvas fills the viewport edge to edge in
 * UCSD's own official palette (ground surfaces, trees, roads and names all come
 * from the bundled GIS data — no tile server, no CDN, no request off our own
 * origin), and everything else floats over it as islands in the app's chrome
 * language — a control island top-left (title, Classes / Midterms / Finals
 * tabs, each with its own time filter; foldable to its title row), a control
 * cluster top-right (Booked only · compass · close), the marker card, the
 * "not on the map" island bottom-left, the zoom buttons bottom-right.
 *
 * Layering, and why no `suppressClick` guard survives from the SVG renderer:
 * `.campusmap__gl` (the GL canvas MapLibre owns and binds its drag/zoom
 * handlers to) and `.campusmap__overlay` (the DOM markers) are SIBLINGS, and
 * the overlay is `pointer-events: none` THROUGHOUT — markers included. Every
 * press, drag, pinch and wheel therefore reaches MapLibre untouched, wherever
 * on the canvas it lands, and marker selection rides on MapLibre's own `click`
 * instead: the handler below asks `hitMarker()` what was under the point. That
 * is also why no `suppressClick` guard is needed. MapLibre does not fire
 * `click` after a drag, so a drag released over a marker opens nothing, and a
 * drag STARTED on one pans normally — which is the whole point, because while
 * the markers took the pointer they were a dead zone that swallowed the
 * gesture entirely (QA I1). The old hand-rolled pan handler needed
 * `suppressClick` only because its markers lived INSIDE the element it dragged.
 */
export function CampusMap({ plan, booked, readOnly, initialView = 'calendar', onClose }: Props) {
  const [data, setData] = useState<{ geo: CampusGeo; map: CampusMapData } | null>(null);
  const isMobile = useIsMobile();
  // The stage's own box: the size the overlay projects into and the card is
  // placed against. The island floats over its top edge, so the map is fitted
  // to what shows below the island.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvas = useStageSize(stageRef);
  const islandRef = useRef<HTMLElement | null>(null);
  const islandH = useElementHeight(islandRef, ISLAND_FALLBACK_H);
  const insetTop = ISLAND_TOP + islandH + ISLAND_GAP;
  const [collapsed, setCollapsed] = useState(false);
  // Off unless the student switched it on before: the map is for planning first,
  // and "everything in the plan" is the honest default.
  const [bookedOnly, setBookedOnly] = useState<boolean>(() => loadMapBookedOnly() ?? false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [mapLoc, setMapLoc] = useState<{ building: string; room?: string } | null>(null);
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  const [noRoomOpen, setNoRoomOpen] = useState(false);
  const [mapView, setMapView] = useState<PlannerView>(initialView);
  const { label: viewLabel, by, sliceAria, empty: emptyViewCopy, noun: viewNoun } = MAP_VIEWS[mapView];

  // Both bundles are dynamic `?raw` imports, so neither the geometry nor
  // `maplibre-gl` itself is in the first-paint chunk.
  useEffect(() => {
    let live = true;
    Promise.all([loadCampusGeo(), loadCampusMap()]).then(([geo, map]) => {
      if (live) setData({ geo, map });
    });
    return () => {
      live = false;
    };
  }, []);

  const style = useMemo(
    () => (data ? buildStyle({ sources: buildSources(data.geo, data.map), assetBase: assetBase() }) : null),
    [data],
  );
  const pad = campusPadding(canvas.w, canvas.h);
  const home = useMemo(
    () =>
      data
        ? { bounds: coreBounds(data.geo), padding: { top: insetTop + pad, right: pad, bottom: pad, left: pad } }
        : null,
    [data, insetTop, pad],
  );
  const reduceMotion =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glRef = useRef<HTMLDivElement | null>(null);
  const gl = useMapLibre(glRef, style, home, {
    minZoom: CAMERA.minZoom,
    maxZoom: CAMERA.maxZoom,
    maxPitch: CAMERA.maxPitch,
    reduceMotion,
  });
  const [mode] = useState<MapMode>('2d'); // Phase 2 adds the setter and the button

  // Both read-only defences, side by side. §5.4 hides the toggle because the plan on
  // screen is someone else's; the same reasoning kills the solid/hollow booked dots,
  // which would otherwise paint YOUR enrolment over THEIR plan with nothing to explain it.
  // On your own plan the toggle appears as soon as anything is booked — by the extension's
  // feed or by a manual "mark booked" in the rail — because only then is there a subset
  // to show. (Gating on the feed alone would hide it from a student who marked by hand.)
  const effectiveBooked = readOnly ? NO_BOOKED : booked;
  const showBookedToggle = !readOnly && booked.size > 0;
  const effectiveBookedOnly = showBookedToggle && bookedOnly;

  const allPins = useMemo(() => MAP_VIEWS[mapView].pins(plan, effectiveBooked), [mapView, plan, effectiveBooked]);
  const scoped = useMemo(
    () => (effectiveBookedOnly ? allPins.filter((p) => p.booked) : allPins),
    [allPins, effectiveBookedOnly],
  );

  const sliced = useMemo(() => slicesFor(scoped, by), [scoped, by]);
  const { slices, predicate } = sliced;
  // The student's pick. It sticks while they stay on this view — reselecting the
  // same tab is a no-op, not a reset — but the view-switch handler below clears it
  // the moment the view actually changes, so the today rule gets to run again; it
  // also yields early if Booked only has removed its slice from what's offered.
  const [picked, setPicked] = useState<string | null>(null);
  const today = useMemo(() => todayKey(by), [by]);
  const sliceId =
    picked !== null && slices.some((s) => s.id === picked)
      ? picked
      : defaultSliceId(sliced, scoped, today);
  const sliceLabel = slices.find((s) => s.id === sliceId)?.label ?? 'All';

  // The slice row scrolls sideways when the weeks don't fit the fixed island. A
  // mouse wheel must drive it (the scrollbar is hidden), and the checked chip must
  // be in view whenever the selection changes under the student — the today rule
  // can land on a week far to the right the moment the tab switches.
  const slicesEl = useRef<HTMLDivElement | null>(null);
  const wheelRef = useWheelToHorizontal<HTMLDivElement>();
  const slicesRef = useCallback(
    (el: HTMLDivElement | null) => {
      slicesEl.current = el;
      wheelRef(el);
    },
    [wheelRef],
  );
  useEffect(() => {
    slicesEl.current
      ?.querySelector<HTMLElement>('.calseg__btn--on')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [sliceId, collapsed]);

  const shown = useMemo(() => scoped.filter(predicate(sliceId)), [scoped, predicate, sliceId]);

  // Split against the home frame the camera fitted to: a marker outside it is not on
  // the map the student opened onto, so it must not be counted as a building on the
  // map, and it belongs in the list with its own explanation rather than disappearing.
  const groups = useMemo(() => groupPins(shown), [shown]);
  const { onCanvas, offCanvas } = useMemo(
    () => splitByBounds(groups, gl.homeBounds),
    [groups, gl.homeBounds],
  );
  // Two different absences. "Not on the map" is a place TSS did give that we could
  // not put on this canvas (unmatched text, online, outside the mapped area) — the
  // list says where it actually is. A pin TSS gave NO place for is not on any list
  // of places: it gets its own line, and its own empty state, saying TSS hasn't
  // listed a room yet — pointing at "where these actually meet" would be a lie.
  const noRoom = useMemo(() => shown.filter(hasNoLocation), [shown]);
  const unplaced = useMemo(
    () => unplacedPins(shown, offCanvas).filter((u) => !hasNoLocation(u.pin)),
    [shown, offCanvas],
  );
  const open = onCanvas.find((g) => g.key === openKey) ?? null;

  // Escape peels one layer at a time: the popover (which registers its own handler
  // while `mapLoc` is set — without this guard both would fire on one keypress),
  // then the open marker card, then the map itself. Keyed off `open` (the group
  // actually on screen) rather than `openKey`: a tab switch can leave `openKey`
  // pointing at a group that no longer exists in this view, and Escape must not
  // spend itself clearing a key nobody can see.
  useEscapeKey(mapLoc ? () => {} : open ? () => setOpenKey(null) : onClose);

  // Re-projected on every camera tick: the card hangs off the dot and must follow it.
  //
  // Culled by the same `inside()` test `MapMarkers` culls its markers with, and at
  // the same moment, so the card and its dot leave together. Without it the card
  // outlived its marker: `project()` keeps answering off-screen coordinates,
  // `cardPlacement` clamps them back into the canvas, and the card parked itself in
  // a corner over open ocean with no dot and no relationship to anything (QA I2).
  //
  // HIDDEN, not closed. The card is the open marker's chip, so it should come back
  // when the marker does — panning past a dot and back should not have thrown the
  // selection away, and closing on the boundary would make a dot resting one pixel
  // outside the frame permanently un-openable. Escape and a click on empty map are
  // still what actually close it.
  const openAnchor = useMemo(() => {
    if (!open || !gl.map) return null;
    const pt = gl.map.project([open.lng, open.lat]);
    return inside(pt.x, pt.y, canvas.w, canvas.h) ? pt : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gl.map, gl.tick, canvas.w, canvas.h]);
  // Where every marker's dot and chip actually are, for this camera. Shared with
  // `MapMarkers`, which draws from the same function — see `useMarkerLayout`.
  const placed = useMarkerLayout(gl.map, gl.tick, onCanvas, canvas, openKey);
  const openPlace = open ? (open.place ?? open.building) : undefined;
  // Without a working camera there is no home frame, so nothing is "on canvas" —
  // the WebGL fallback still has to name every located building it would have drawn.
  const onCanvasOrAll = onCanvas.length > 0 ? onCanvas : groups;

  // `error` is MapLibre's general-purpose channel: a missing WebGL2 context comes
  // through it, but so do a glyph or sprite 404 and a source hiccup, and the map
  // carries on fine after those. The distinction that matters to a student is
  // whether the map ever became usable at all, so the text fallback is gated on
  // `!gl.ready` — an error before `load` means there is nothing on screen to
  // look at, one after it means a working map that lost some detail.
  //
  // Gated here rather than latched inside `useMapLibre` deliberately: this
  // expression is re-evaluated every render, so a recoverable error that happens
  // to arrive BEFORE `load` (a glyph 404 can) un-does itself the moment `load`
  // lands, where a hook-side latch would have frozen the panel on for the rest
  // of the session. The hook stays the honest record of "the last error seen".
  const mapUnusable = gl.error !== null && !gl.ready;
  // The OTHER way a map fails: it never finishes starting and never says so. A
  // 404'd worker chunk and a container the cascade collapsed to zero height both
  // did exactly that in QA — no `error` event, no console line, "Loading campus…"
  // forever. A separate condition rather than a wider `mapUnusable`, because the
  // two failures are not the same thing and do not deserve the same sentence:
  // this one is not "your browser turned WebGL off". Same destination though —
  // the list of buildings, which is the only thing the map was going to tell them.
  const mapStalled = gl.stalled && !gl.ready;
  const showFallback = mapUnusable || mapStalled;

  // The host footprints are recoloured to the plan's courses, and the flat/extruded
  // look is a layer-visibility switch — both are style mutations on a live map, so
  // they run as effects rather than in the style object the map was built from.
  useEffect(() => {
    if (gl.ready && gl.map) applyHosts(gl.map, onCanvas);
  }, [gl.ready, gl.map, onCanvas]);
  useEffect(() => {
    if (gl.ready && gl.map) applyMode(gl.map, mode);
  }, [gl.ready, gl.map, mode]);
  // Not fatal is not the same as not worth knowing: a map that renders but lost
  // its labels or a texture says so here, and nowhere else.
  useEffect(() => {
    if (gl.error && gl.ready) {
      console.warn(`[TritonPlan] campus map reported an error after loading: ${gl.error}`);
    }
  }, [gl.error, gl.ready]);
  // Marker selection runs off MapLibre's own pointer events, because the marker
  // overlay is now transparent to the pointer (see the note in MapMarkers.tsx —
  // taking the pointer there made every chip and dot a dead zone for panning).
  // So the canvas sees every press, and this asks afterwards what was under it:
  // a marker opens, empty map closes. MapLibre does not fire `click` after a
  // drag, which is exactly the semantics wanted — a drag that begins on a chip
  // pans the map and opens nothing, and panning away from an open card does not
  // shut it. `mousemove` gives the chips back their hover affordance and the
  // canvas a pointer cursor over them, which `pointer-events: none` costs.
  //
  // The layout is read through a ref so these listeners are bound once per map
  // rather than re-bound on every camera tick.
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const placedRef = useRef<PlacedMarker[]>([]);
  placedRef.current = placed;
  useEffect(() => {
    const m = gl.map;
    if (!m) return;
    const onClick = (e: { point: { x: number; y: number } }) => {
      setOpenKey(hitMarker(placedRef.current, e.point.x, e.point.y));
    };
    const onMove = (e: { point: { x: number; y: number } }) => {
      setHoverKey(hitMarker(placedRef.current, e.point.x, e.point.y));
    };
    const onOut = () => setHoverKey(null);
    m.on('click', onClick);
    m.on('mousemove', onMove);
    m.on('mouseout', onOut);
    return () => {
      m.off('click', onClick);
      m.off('mousemove', onMove);
      m.off('mouseout', onOut);
    };
  }, [gl.map]);

  // The generic "nothing to place" copy is false only when a LOCATABLE class exists that
  // booked-only is hiding — an unbooked pin with no coords was never going on the map
  // either way, and turning the toggle off wouldn't change that.
  const bookedOnlyHidesEverything =
    effectiveBookedOnly &&
    onCanvas.length === 0 &&
    allPins.some((p) => p.coords !== null && !p.booked);

  const emptyCopy = bookedOnlyHidesEverything
    ? 'Booked only is on and nothing here is booked yet. Turn it off to see every course in your plan.'
    : onCanvas.length === 0 && unplaced.length > 0
      ? `Nothing here lands on the mapped part of campus — the list at the bottom-left has where these ${viewNoun} actually meet.`
      : onCanvas.length === 0 && noRoom.length === 0
        ? emptyViewCopy
        : null;
  // Nothing placed and nothing else to point at: TSS simply hasn't listed rooms yet.
  //
  // Gated on `gl.ready` because this island is drawn INSIDE the ternary's third
  // branch, while the bottom-left list it stands in for sits outside and hides
  // itself whenever this is true. Without the gate the two cancel out exactly
  // where the map is least able to speak for itself: with no camera there is no
  // home frame, so `onCanvas` is empty by construction, and a view whose only
  // absence is roomless sittings would suppress the island it cannot render AND
  // the list that would have named them. (`mapUnusable` implies `!gl.ready`, so
  // this one flag covers the WebGL fallback and the loading pane alike.)
  const noRoomEmpty = gl.ready && !emptyCopy && onCanvas.length === 0 && noRoom.length > 0;

  // `aria-modal="true"` is a promise to assistive tech that nothing outside this
  // dialog is reachable, and until now it was a lie: with no containment, Tab
  // walked 31 controls of the planner underneath the full-screen overlay — every
  // course card's "open in TSS", "mark booked", "Remove" — before it reached the
  // map's own island, and 43 presses before the first marker (QA I4).
  //
  // `inert` on the dialog's SIBLINGS rather than a hand-rolled Tab trap: the
  // browser then removes that whole subtree from the tab order, from hit
  // testing and from the accessibility tree in one go, which is more than a
  // keydown handler can do and cannot be defeated by focus arriving from
  // somewhere unexpected. Scoping it to siblings — not to any named planner
  // root — keeps this component from having to know App's layout; it renders
  // inline rather than through a portal, so its siblings ARE the planner.
  // Written as the attribute, not the IDL property, because jsdom does not
  // implement `HTMLElement.inert` while every browser honours the attribute.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const restore = document.activeElement;
    const inerted: Element[] = [];
    for (const sib of Array.from(parent.children)) {
      if (sib === el || sib.hasAttribute('inert')) continue;
      sib.setAttribute('inert', '');
      inerted.push(sib);
    }
    // Focus lands on the dialog itself rather than on a control: a screen reader
    // then reads "Campus map, dialog" before anything else, and the first Tab
    // goes to the island — the top of the map's own order, not the middle of it.
    el.focus({ preventScroll: true });
    return () => {
      for (const sib of inerted) sib.removeAttribute('inert');
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus({ preventScroll: true });
    };
  }, []);

  const cluster = (
    <div className="campusmap__cluster">
      {showBookedToggle && (
        <button
          type="button"
          className={`btn btn--sm campusmap__bookedtoggle${bookedOnly ? ' is-on' : ''}`}
          aria-pressed={bookedOnly}
          title="Show only the classes you are booked into"
          onClick={() => {
            const next = !bookedOnly;
            setBookedOnly(next);
            saveMapBookedOnly(next);
          }}
        >
          {bookedOnly && <Check size={13} />}
          <span className="campusmap__bookedtoggle-label">Booked only</span>
        </button>
      )}
      {/* The GL camera can be rotated AND tilted (drag with the right button / two
          fingers), so the needle is the button that puts the map back: north up and
          flat. Pitch has to be in there — `cameraForBounds` behind "Reset view"
          returns centre/zoom/bearing only, so without this a student who
          two-finger-pitched by accident had no way back to a flat map at all
          (QA I3). The gestures themselves stay enabled: pitch renders correctly
          and the chips stay anchored through it, and Phase 2's 3D control wants
          them. Phase 2 spins the needle with the bearing; in Phase 1 it is simply
          the way back. */}
      <button
        type="button"
        className="btn btn--sm btn--icon campusmap__compass"
        aria-label="Reset north and tilt"
        title="Reset north and tilt"
        onClick={() => gl.easeCamera({ bearing: 0, pitch: 0 })}
      >
        <Compass size={18} />
      </button>
      <button
        type="button"
        className="btn btn--sm btn--icon campusmap__close"
        onClick={onClose}
        aria-label="Close map"
      >
        <X size={15} />
      </button>
    </div>
  );

  return (
    <div
      className="campusmap"
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Campus map"
      tabIndex={-1}
      style={{ '--map-inset': `${insetTop}px` } as CSSProperties}
    >
      <section
        className={`campusmap__island${collapsed ? ' campusmap__island--folded' : ''}`}
        ref={islandRef}
        aria-label="Map controls"
      >
        <div className="campusmap__titlerow">
          <MapPinIcon size={16} className="campusmap__titleicon" />
          <span className="campusmap__title">Campus map</span>
          <span className="campusmap__count">
            {onCanvas.length === 0
              ? 'nothing to show'
              : `${onCanvas.length} ${pluralize(onCanvas.length, 'building')}`}
          </span>
          {/* On a phone the island spans the screen, so the control cluster joins its title row. */}
          {isMobile && cluster}
          <button
            type="button"
            className="campusmap__collapse"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Show map controls' : 'Hide map controls'}
            onClick={() => setCollapsed((v) => !v)}
          >
            <ChevronDown size={16} />
          </button>
        </div>

        {collapsed ? (
          <div className="campusmap__summary">
            {viewLabel} · {sliceLabel}
          </div>
        ) : (
          <>
            <ViewTabs
              value={mapView}
              onChange={(v) => {
                // ViewTabs fires onChange on every click of an enabled tab, including
                // the one already active — only an actual view change forgets the pick
                // and any card left open in the view being left.
                if (v !== mapView) {
                  setPicked(null);
                  setOpenKey(null);
                }
                setMapView(v);
              }}
              calendarLabel="Classes"
              ariaLabel="Map views"
            />
            <div ref={slicesRef} className="calseg campusmap__slices" role="radiogroup" aria-label={sliceAria}>
              {slices.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={s.id === sliceId}
                  className={`calseg__btn${s.id === sliceId ? ' calseg__btn--on' : ''}`}
                  onClick={() => setPicked(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {!isMobile && cluster}

      <div className="campusmap__stage" ref={stageRef}>
        {/* Rendered unconditionally: `useMapLibre` builds the map into this node the
            moment the style and home frame are ready, so it must never be gated
            behind the ready/error state it is what produces. */}
        <div
          className={`campusmap__gl${hoverKey ? ' is-over-marker' : ''}`}
          ref={glRef}
          aria-label="UCSD campus map of this term's class locations"
          role="group"
        />
        {showFallback ? (
          <div className="campusmap__nogl" role="status">
            <p>
              {mapUnusable
                ? `The campus map needs WebGL, which this browser has turned off. Where your ${viewNoun} meet:`
                : `The campus map didn’t load. Where your ${viewNoun} meet:`}
            </p>
            <ul>
              {onCanvasOrAll.map((g) => (
                <li key={g.key}>{markerLabel(g)}</li>
              ))}
            </ul>
          </div>
        ) : !gl.ready ? (
          <div className="campusmap__loading">Loading campus…</div>
        ) : (
          <>
            <MapMarkers
              map={gl.map}
              tick={gl.tick}
              groups={onCanvas}
              bounds={{ w: canvas.w, h: canvas.h }}
              selectedKey={openKey}
              hoverKey={hoverKey}
              onSelect={setOpenKey}
            />
            {open && openAnchor && (
              <MarkerCard
                group={open}
                anchor={openAnchor}
                canvas={canvas}
                insetTop={insetTop}
                onDirections={
                  openPlace ? () => setMapLoc({ building: openPlace, room: open.pins[0]!.room }) : undefined
                }
              />
            )}
            <div className="campusmap__zoom" role="group" aria-label="Zoom">
              <button type="button" className="btn btn--sm btn--icon campusmap__zoombtn" onClick={gl.zoomIn} aria-label="Zoom in">
                <Plus size={14} />
              </button>
              <button type="button" className="btn btn--sm btn--icon campusmap__zoombtn" onClick={gl.zoomOut} aria-label="Zoom out">
                <Minus size={14} />
              </button>
              <button
                type="button"
                className="btn btn--sm btn--icon campusmap__zoombtn campusmap__zoombtn--home"
                onClick={gl.goHome}
                disabled={gl.atHome}
                aria-label="Reset view"
                title="Reset view"
              >
                ⟲
              </button>
            </div>
            {/* The empty-state copy floats over the basemap: a map with no pins is
                still a map, and a blank panel taught nothing about where campus is. */}
            {emptyCopy && <div className="campusmap__empty">{emptyCopy}</div>}
            {noRoomEmpty && (
              <div className="campusmap__empty campusmap__empty--noroom">
                <MapPinIcon size={36} className="empty__mark" strokeWidth={1.4} />
                <div className="empty__title">No rooms from TSS yet</div>
                <p className="empty__text">
                  TSS hasn’t listed a room for these {viewNoun} yet — check back after browsing the course again.
                </p>
                <ul className="campusmap__noroom-list">
                  {noRoom.map((p, i) => (
                    <li key={`${p.courseId}-${p.label}-${i}`}>
                      <b>{p.courseCode}</b> {p.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="campusmap__attrib" aria-hidden="true">
              UC San Diego GIS · © OpenStreetMap contributors
            </div>
          </>
        )}

        {(unplaced.length > 0 || (noRoom.length > 0 && !noRoomEmpty)) && (
          <div className="campusmap__unlocated">
            {/* column-reverse: each toggle sits below the list it opens, and the
                first toggle in DOM order is the bottom one. */}
            {noRoom.length > 0 && !noRoomEmpty && (
              <>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost campusmap__unlocated-toggle campusmap__noroom-toggle"
                  aria-expanded={noRoomOpen}
                  onClick={() => setNoRoomOpen((v) => !v)}
                >
                  {noRoom.length} without a room yet <span aria-hidden="true">{noRoomOpen ? '▾' : '▸'}</span>
                </button>
                {noRoomOpen && (
                  <ul className="campusmap__unlocated-list">
                    {noRoom.map((p, i) => (
                      <li key={`${p.courseId}-${p.label}-${i}`}>
                        <b>{p.courseCode}</b> {p.label} — no room listed in TSS yet
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {unplaced.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost campusmap__unlocated-toggle"
                  aria-expanded={unplacedOpen}
                  onClick={() => setUnplacedOpen((v) => !v)}
                >
                  {unplaced.length} not on the map <span aria-hidden="true">{unplacedOpen ? '▾' : '▸'}</span>
                </button>
                {unplacedOpen && (
                  <ul className="campusmap__unlocated-list">
                    {unplaced.map((u, i) => (
                      <li key={`${u.pin.courseId}-${u.reason}-${i}`}>
                        <b>{u.pin.courseCode}</b> {u.pin.label} — {u.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {mapLoc && (
        <BuildingPopover
          building={mapLoc.building}
          room={mapLoc.room}
          onClose={() => setMapLoc(null)}
        />
      )}
    </div>
  );
}
