import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PlanState } from '@triton/shared';
import { campusViewport, loadCampusGeo, type CampusGeo } from '../lib/campus-geo';
import type { Box } from '../lib/map-basemap';
import { panView, project, toScreen, zoomLevel, zoomView, type Viewport } from '../lib/map-projection';
import { defaultSliceId, meetingPins, slicesFor } from '../lib/map-pins';
import { groupPins, splitByViewport, unplacedPins } from '../lib/map-labels';
import { loadMapBookedOnly, saveMapBookedOnly } from '../lib/storage';
import { pluralize, todayWeekday } from '../lib/format';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useElementHeight, useStageSize } from '../hooks/useStageSize';
import { CampusMapCanvas, MAX_ZOOM, MIN_ZOOM } from './CampusMapCanvas';
import { MarkerCard } from './MarkerCard';
import { BuildingPopover } from './BuildingPopover';
import { Minus, Plus, X } from './icons';

interface Props {
  /** The plan on screen — yours, or a received one. */
  plan: PlanState;
  /** Course ids the student is enrolled in. RENDER-TIME ONLY; never persisted here. */
  booked: ReadonlySet<string>;
  /** Whether the extension has ever captured the booked feed for this term. */
  hasBookedData: boolean;
  /** Viewing someone else's plan — the booked toggle is meaningless then. */
  readOnly: boolean;
  onClose: () => void;
}

/** Nobody's booked set applies to someone else's plan — see §5.4. */
const NO_BOOKED: ReadonlySet<string> = new Set();

/** The floating header's height until it has been measured (and under jsdom). */
const HEADER_FALLBACK_H = 52;

const NO_BOXES: readonly Box[] = [];

/**
 * Full-screen campus map, toggled by state rather than a route: the address bar
 * hash is already owned by share links (#p=) and the self-mirror (#m=), so a
 * router would collide with readHash(). `position: fixed` covers the viewport
 * regardless of DOM depth, so — like BuildingPopover — this renders inline
 * rather than through a portal.
 *
 * The map IS the page: the SVG fills the viewport edge to edge, and everything
 * else (header, hint, empty-state copy, the "not on the map" list, the marker
 * card, zoom buttons) floats over it.
 */
export function CampusMap({ plan, booked, hasBookedData, readOnly, onClose }: Props) {
  const [geo, setGeo] = useState<CampusGeo | null>(null);
  // The canvas is the stage's own box (SVG units == CSS px, so chip text is
  // never scaled); it refits on resize/rotation. The header floats over its top
  // edge, so the map is fitted to what shows below the header.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvas = useStageSize(stageRef);
  const barRef = useRef<HTMLElement | null>(null);
  const insetTop = useElementHeight(barRef, HEADER_FALLBACK_H);
  const [bookedOnly, setBookedOnly] = useState<boolean>(
    () => loadMapBookedOnly() ?? (hasBookedData && !readOnly),
  );
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [cardBox, setCardBox] = useState<Box | null>(null);
  const [mapLoc, setMapLoc] = useState<{ building: string; room?: string } | null>(null);
  const [hintHidden, setHintHidden] = useState(false);
  const showHint = !readOnly && !hasBookedData && !hintHidden;
  // The hint floats over the map's top-left; basemap names keep out from under it.
  const hintRef = useRef<HTMLDivElement | null>(null);
  const [hintBox, setHintBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const el = hintRef.current;
    const stage = stageRef.current;
    if (!el || !stage) {
      setHintBox(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    if (r.width <= 0) return;
    setHintBox({ x: r.left - st.left, y: r.top - st.top, w: r.width, h: r.height });
  }, [showHint, insetTop, canvas.w]);
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
  useEffect(() => {
    setView(null);
  }, [canvas.w, canvas.h, insetTop]);
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
  const showBookedToggle = !readOnly && hasBookedData;
  const effectiveBookedOnly = showBookedToggle && bookedOnly;
  const effectiveBooked = readOnly ? NO_BOOKED : booked;

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
  const reserved = useMemo(() => {
    const boxes: Box[] = [];
    if (open && cardBox) boxes.push(cardBox);
    if (hintBox) boxes.push(hintBox);
    return boxes.length ? boxes : NO_BOXES;
  }, [open, cardBox, hintBox]);

  // The generic "nothing to place" copy is false only when a LOCATABLE class exists that
  // booked-only is hiding — an unbooked pin with no coords was never going on the map
  // either way, and turning the toggle off wouldn't change that.
  const bookedOnlyHidesEverything =
    showBookedToggle &&
    bookedOnly &&
    onCanvas.length === 0 &&
    allPins.some((p) => p.coords !== null && !p.booked);

  const emptyCopy = bookedOnlyHidesEverything
    ? 'Booked only is on and nothing here is booked yet. Turn it off to see every course in your plan.'
    : onCanvas.length === 0 && unplaced.length > 0
      ? 'Nothing here lands on the mapped part of campus — the list at the bottom-left has where these classes actually meet.'
      : onCanvas.length === 0
        ? 'No class locations to place yet. Add courses with scheduled meetings, and they’ll appear here.'
        : null;

  return (
    <div
      className="campusmap"
      role="dialog"
      aria-modal="true"
      aria-label="Campus map"
      style={{ '--map-inset': `${insetTop}px` } as CSSProperties}
    >
      <header className="campusmap__bar" ref={barRef}>
        <div className="campusmap__title">
          Campus map
          <span className="campusmap__count">
            {onCanvas.length === 0
              ? 'nothing to show'
              : `${onCanvas.length} ${pluralize(onCanvas.length, 'building')}`}
          </span>
        </div>

        <div className="campusmap__slices" role="tablist" aria-label="Filter by day">
          {slices.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === sliceId}
              className={`campusmap__chipbtn${s.id === sliceId ? ' is-on' : ''}`}
              onClick={() => setSliceId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {showBookedToggle && (
          <label className="campusmap__bookedtoggle">
            <input
              type="checkbox"
              checked={bookedOnly}
              onChange={(e) => {
                setBookedOnly(e.target.checked);
                saveMapBookedOnly(e.target.checked);
              }}
            />
            Booked only
          </label>
        )}

        <button type="button" className="campusmap__close" onClick={onClose} aria-label="Close map">
          <X size={16} />
        </button>
      </header>

      {showHint && (
        <div className="campusmap__hint" role="note" ref={hintRef}>
          <span>
            Open “Booked Courses” on the TSS homepage once and TritonPlan can tell which of these
            you’re actually enrolled in.
          </span>
          <button
            type="button"
            className="campusmap__hint-close"
            onClick={() => setHintHidden(true)}
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

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
              <button type="button" className="campusmap__zoombtn" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
                <Plus size={14} />
              </button>
              <button type="button" className="campusmap__zoombtn" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
                <Minus size={14} />
              </button>
              <button
                type="button"
                className="campusmap__zoombtn campusmap__zoombtn--home"
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
              className="campusmap__unlocated-toggle"
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
