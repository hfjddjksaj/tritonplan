import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { defaultSliceId, meetingPins, slicesFor } from '../lib/map-pins';
import { groupPins, markerLabel, splitByBounds, unplacedPins } from '../lib/map-labels';
import { loadMapBookedOnly, saveMapBookedOnly } from '../lib/storage';
import { pluralize, todayWeekday } from '../lib/format';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useIsMobile } from '../hooks/useIsMobile';
import { useMapLibre } from '../hooks/useMapLibre';
import { useElementHeight, useStageSize } from '../hooks/useStageSize';
import { MapMarkers } from './MapMarkers';
import { MarkerCard } from './MarkerCard';
import { BuildingPopover } from './BuildingPopover';
import { ViewTabs } from './ViewTabs';
import { Check, ChevronDown, Compass, MapPinIcon, Minus, Plus, X } from './icons';

interface Props {
  /** The plan on screen — yours, or a received one. */
  plan: PlanState;
  /** Course ids the student is enrolled in. RENDER-TIME ONLY; never persisted here. */
  booked: ReadonlySet<string>;
  /** Viewing someone else's plan — the booked toggle is meaningless then. */
  readOnly: boolean;
  onClose: () => void;
}

/** Nobody's booked set applies to someone else's plan — see §5.4. */
const NO_BOOKED: ReadonlySet<string> = new Set();

/** The island's height until it has been measured (and under jsdom): three rows. */
const ISLAND_FALLBACK_H = 118;
/** Gap between the island's bottom edge and where the fitted map may begin. */
const ISLAND_TOP = 10;
const ISLAND_GAP = 8;

/** What the map shows this round: class meetings. Midterms / Finals tabs are drawn, not wired. */
const MAP_VIEW_LABEL = 'Classes';

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
 * language — a control island top-left (title, view tabs, day filter; foldable
 * to its title row), a control cluster top-right (Booked only · compass ·
 * close), the marker card, the "not on the map" island bottom-left, the zoom
 * buttons bottom-right.
 *
 * Layering, and why no `suppressClick` guard survives from the SVG renderer:
 * `.campusmap__gl` (the GL canvas MapLibre owns and binds its drag/zoom
 * handlers to) and `.campusmap__overlay` (the DOM markers) are SIBLINGS, and
 * the overlay is `pointer-events: none` with only the markers `auto`. So a
 * press on empty map goes straight to the canvas and pans it, while a press on
 * a marker never reaches MapLibre's container at all — it cannot start a drag
 * to begin with. And a drag that starts on the canvas and is released over a
 * marker fires its `click` on the two targets' nearest common ancestor (the
 * stage), never on the marker, so the marker's handler is not even in the
 * propagation path. The old hand-rolled pan handler needed `suppressClick`
 * only because its markers lived INSIDE the element it dragged.
 */
export function CampusMap({ plan, booked, readOnly, onClose }: Props) {
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

  // Escape peels one layer at a time: the popover (which registers its own handler
  // while `mapLoc` is set — without this guard both would fire on one keypress),
  // then the open marker card, then the map itself.
  useEscapeKey(mapLoc ? () => {} : openKey ? () => setOpenKey(null) : onClose);

  // Both read-only defences, side by side. §5.4 hides the toggle because the plan on
  // screen is someone else's; the same reasoning kills the solid/hollow booked dots,
  // which would otherwise paint YOUR enrolment over THEIR plan with nothing to explain it.
  // On your own plan the toggle appears as soon as anything is booked — by the extension's
  // feed or by a manual "mark booked" in the rail — because only then is there a subset
  // to show. (Gating on the feed alone would hide it from a student who marked by hand.)
  const effectiveBooked = readOnly ? NO_BOOKED : booked;
  const showBookedToggle = !readOnly && booked.size > 0;
  const effectiveBookedOnly = showBookedToggle && bookedOnly;

  const allPins = useMemo(() => meetingPins(plan, effectiveBooked), [plan, effectiveBooked]);
  const scoped = useMemo(
    () => (effectiveBookedOnly ? allPins.filter((p) => p.booked) : allPins),
    [allPins, effectiveBookedOnly],
  );

  const { slices, predicate } = useMemo(() => slicesFor(scoped), [scoped]);
  const [sliceId, setSliceId] = useState<string>(() =>
    defaultSliceId(slices, scoped, todayWeekday()),
  );
  useEffect(() => {
    // The available columns change with scope; keep the selection valid.
    if (!slices.some((s) => s.id === sliceId)) {
      setSliceId(defaultSliceId(slices, scoped, todayWeekday()));
    }
  }, [slices, scoped, sliceId]);
  const sliceLabel = slices.find((s) => s.id === sliceId)?.label ?? 'All';

  const shown = useMemo(() => scoped.filter(predicate(sliceId)), [scoped, predicate, sliceId]);

  // Split against the home frame the camera fitted to: a marker outside it is not on
  // the map the student opened onto, so it must not be counted as a building on the
  // map, and it belongs in the list with its own explanation rather than disappearing.
  const groups = useMemo(() => groupPins(shown), [shown]);
  const { onCanvas, offCanvas } = useMemo(
    () => splitByBounds(groups, gl.homeBounds),
    [groups, gl.homeBounds],
  );
  const unplaced = useMemo(() => unplacedPins(shown, offCanvas), [shown, offCanvas]);
  const open = onCanvas.find((g) => g.key === openKey) ?? null;
  // Re-projected on every camera tick: the card hangs off the dot and must follow it.
  const openAnchor = useMemo(
    () => (open && gl.map ? gl.map.project([open.lng, open.lat]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, gl.map, gl.tick],
  );
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
  // A click on the map itself (not on a marker — those stop propagation, and never
  // reach the canvas anyway) closes the open card. MapLibre suppresses this event
  // after a drag, so panning away from a card does not shut it.
  useEffect(() => {
    const m = gl.map;
    if (!m) return;
    const h = () => setOpenKey(null);
    m.on('click', h);
    return () => {
      m.off('click', h);
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
      ? 'Nothing here lands on the mapped part of campus — the list at the bottom-left has where these classes actually meet.'
      : onCanvas.length === 0
        ? 'No class locations to place yet. Add courses with scheduled meetings, and they’ll appear here.'
        : null;

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
      {/* The GL camera can be rotated (drag with the right button / two fingers), so
          the needle is a button that puts north back up. Phase 2 spins it with the
          bearing; in Phase 1 it is simply the way back. */}
      <button
        type="button"
        className="btn btn--sm btn--icon campusmap__compass"
        aria-label="Reset north"
        title="Reset north"
        onClick={() => gl.easeCamera({ bearing: 0 })}
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
      role="dialog"
      aria-modal="true"
      aria-label="Campus map"
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
            {MAP_VIEW_LABEL} · {sliceLabel}
          </div>
        ) : (
          <>
            <ViewTabs
              value="calendar"
              onChange={() => {}}
              calendarLabel={MAP_VIEW_LABEL}
              disabled={['midterms', 'finals']}
              ariaLabel="Map views"
            />
            <div className="calseg campusmap__slices" role="radiogroup" aria-label="Filter by day">
              {slices.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={s.id === sliceId}
                  className={`calseg__btn${s.id === sliceId ? ' calseg__btn--on' : ''}`}
                  onClick={() => setSliceId(s.id)}
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
          className="campusmap__gl"
          ref={glRef}
          aria-label="UCSD campus map of this term's class locations"
          role="group"
        />
        {mapUnusable ? (
          <div className="campusmap__nogl" role="status">
            <p>
              The campus map needs WebGL, which this browser has turned off. Where your classes
              meet:
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
            <div className="campusmap__attrib" aria-hidden="true">
              UC San Diego GIS · © OpenStreetMap contributors
            </div>
          </>
        )}

        {unplaced.length > 0 && (
          <div className="campusmap__unlocated">
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
