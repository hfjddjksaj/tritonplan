import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PlanState } from '@triton/shared';
import { campusViewport, loadCampusGeo, type CampusGeo } from '../lib/campus-geo';
import type { Box } from '../lib/map-basemap';
import { panView, project, toScreen, zoomLevel, zoomView, type Viewport } from '../lib/map-projection';
import { defaultSliceId, meetingPins, slicesFor, todayKey } from '../lib/map-pins';
import { groupPins, splitByViewport, unplacedPins } from '../lib/map-labels';
import { loadMapBookedOnly, saveMapBookedOnly } from '../lib/storage';
import { pluralize } from '../lib/format';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useIsMobile } from '../hooks/useIsMobile';
import { useElementHeight, useStageSize } from '../hooks/useStageSize';
import { CampusMapCanvas, MAX_ZOOM, MIN_ZOOM } from './CampusMapCanvas';
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

const NO_BOXES: readonly Box[] = [];

/**
 * Full-screen campus map, toggled by state rather than a route: the address bar
 * hash is already owned by share links (#p=) and the self-mirror (#m=), so a
 * router would collide with readHash(). `position: fixed` covers the viewport
 * regardless of DOM depth, so — like BuildingPopover — this renders inline
 * rather than through a portal.
 *
 * The map IS the page: the SVG fills the viewport edge to edge, and everything
 * else floats over it as islands in the app's own chrome language — a control
 * island top-left (title, view tabs, day filter; foldable to its title row),
 * a control cluster top-right (Booked only · compass · close), the marker card,
 * the "not on the map" island bottom-left, the zoom buttons bottom-right.
 */
export function CampusMap({ plan, booked, readOnly, onClose }: Props) {
  const [geo, setGeo] = useState<CampusGeo | null>(null);
  const isMobile = useIsMobile();
  // The canvas is the stage's own box (SVG units == CSS px, so chip text is
  // never scaled); it refits on resize/rotation. The island floats over its top
  // edge, so the map is fitted to what shows below the island.
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
  const [cardBox, setCardBox] = useState<Box | null>(null);
  const [mapLoc, setMapLoc] = useState<{ building: string; room?: string } | null>(null);
  const [unplacedOpen, setUnplacedOpen] = useState(false);

  // The fitted frame is the anchor for zoom limits and the ⟲ button; `view` is
  // what the canvas actually draws through and what wheel/drag/pinch move.
  const homeView = useMemo(
    () => (geo ? panView(campusViewport(geo, canvas.w, canvas.h - insetTop), 0, insetTop) : null),
    [geo, canvas.w, canvas.h, insetTop],
  );
  const [view, setView] = useState<Viewport | null>(null);
  const shownView = view ?? homeView;
  // A canvas-size change (rotating a phone, resizing past the breakpoint) refits.
  // Folding the island does not: at home the fit follows the island by itself
  // (homeView depends on insetTop), and a zoomed-in view is the student's — the
  // island moving must not throw it away.
  useEffect(() => {
    setView(null);
  }, [canvas.w, canvas.h]);
  const visibleCentre = { x: canvas.w / 2, y: insetTop + (canvas.h - insetTop) / 2 };
  const zoomBy = (factor: number) => {
    if (!shownView || !homeView) return;
    const level = zoomLevel(shownView, homeView);
    const f = Math.max(MIN_ZOOM / level, Math.min(MAX_ZOOM / level, factor));
    setView(zoomView(shownView, f, visibleCentre));
  };
  const atHome = view === null;

  // Escape peels one layer at a time: the popover (which registers its own handler
  // while `mapLoc` is set — without this guard both would fire on one keypress),
  // then the open marker card, then the map itself.
  useEscapeKey(mapLoc ? () => {} : openKey ? () => setOpenKey(null) : onClose);

  useEffect(() => {
    let live = true;
    loadCampusGeo().then((g) => {
      if (live) setGeo(g);
    });
    return () => {
      live = false;
    };
  }, []);

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

  const sliced = useMemo(() => slicesFor(scoped, 'weekday'), [scoped]);
  const { slices, predicate } = sliced;
  const [sliceId, setSliceId] = useState<string>(() =>
    defaultSliceId(sliced, scoped, todayKey('weekday')),
  );
  useEffect(() => {
    // The available columns change with scope; keep the selection valid.
    if (!slices.some((s) => s.id === sliceId)) {
      setSliceId(defaultSliceId(sliced, scoped, todayKey('weekday')));
    }
  }, [slices, scoped, sliceId]);
  const sliceLabel = slices.find((s) => s.id === sliceId)?.label ?? 'All';

  const shown = useMemo(() => scoped.filter(predicate(sliceId)), [scoped, predicate, sliceId]);

  // Split against the fitted frame: a marker outside it is not on the map the student
  // opened onto, so it must not be counted as a building on the map, and it belongs
  // in the list with its own explanation rather than disappearing.
  const { onCanvas, offCanvas } = useMemo(
    () =>
      homeView
        ? splitByViewport(groupPins(shown), homeView, canvas.w, canvas.h)
        : { onCanvas: [], offCanvas: [] },
    [shown, homeView, canvas.w, canvas.h],
  );
  const unplaced = useMemo(() => unplacedPins(shown, offCanvas), [shown, offCanvas]);
  const open = onCanvas.find((g) => g.key === openKey) ?? null;
  const openAnchor = open && shownView ? toScreen(project(open.lng, open.lat), shownView) : null;
  const openPlace = open ? (open.place ?? open.building) : undefined;
  const reserved = useMemo(() => (open && cardBox ? [cardBox] : NO_BOXES), [open, cardBox]);

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
      {/* North is up, but a map with no needle makes people doubt it. */}
      <span className="campusmap__compass" role="img" aria-label="North is up" title="North is up">
        <Compass size={18} />
      </span>
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
        {geo === null || !shownView || !homeView ? (
          <div className="campusmap__loading">Loading campus…</div>
        ) : (
          <>
            <CampusMapCanvas
              geo={geo}
              pins={shown}
              width={canvas.w}
              height={canvas.h}
              view={shownView}
              homeView={homeView}
              onViewChange={setView}
              selectedKey={openKey}
              onSelect={setOpenKey}
              insetTop={insetTop}
              reserved={reserved}
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
                onBox={(b) =>
                  setCardBox((prev) =>
                    prev && prev.x === b.x && prev.y === b.y && prev.w === b.w && prev.h === b.h ? prev : b,
                  )
                }
              />
            )}
            <div className="campusmap__zoom" role="group" aria-label="Zoom">
              <button type="button" className="btn btn--sm btn--icon campusmap__zoombtn" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
                <Plus size={14} />
              </button>
              <button type="button" className="btn btn--sm btn--icon campusmap__zoombtn" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
                <Minus size={14} />
              </button>
              <button
                type="button"
                className="btn btn--sm btn--icon campusmap__zoombtn campusmap__zoombtn--home"
                onClick={() => setView(null)}
                disabled={atHome}
                aria-label="Reset view"
                title="Reset view"
              >
                ⟲
              </button>
            </div>
            {/* The empty-state copy floats over the basemap: a map with no pins is
                still a map, and a blank panel taught nothing about where campus is. */}
            {emptyCopy && <div className="campusmap__empty">{emptyCopy}</div>}
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
