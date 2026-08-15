import { useEffect, useMemo, useState } from 'react';
import type { PlanState } from '@triton/shared';
import { loadCampusGeo, type CampusGeo } from '../lib/campus-geo';
import { defaultSliceId, meetingPins, slicesFor } from '../lib/map-pins';
import { groupPins, splitByViewport, unplacedPins } from '../lib/map-labels';
import { loadMapBookedOnly, saveMapBookedOnly } from '../lib/storage';
import { pluralize, todayWeekday } from '../lib/format';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useIsMobile } from '../hooks/useIsMobile';
import { CampusMapCanvas } from './CampusMapCanvas';
import { BuildingPopover } from './BuildingPopover';
import { X } from './icons';

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

/**
 * Canvas size in SVG units. It is also the rendered CSS size on desktop, and
 * the phone canvas is sized to render 1:1 there too: at 1100 px wide the SVG
 * had to shrink to ~0.33× inside a 390 px viewport, which put the 10 px chip
 * text at ~3 CSS px. Portrait also suits the core, which is ~2.4 km tall and
 * ~1.4 km wide.
 */
const CANVAS = { w: 1100, h: 760 };
const MOBILE_CANVAS = { w: 360, h: 560 };

/** Nobody's booked set applies to someone else's plan — see §5.4. */
const NO_BOOKED: ReadonlySet<string> = new Set();

/**
 * Full-page campus map, toggled by state rather than a route: the address bar
 * hash is already owned by share links (#p=) and the self-mirror (#m=), so a
 * router would collide with readHash(). `position: fixed` (Task 11's CSS)
 * covers the viewport regardless of DOM depth, so — like BuildingPopover —
 * this renders inline rather than through a portal.
 */
export function CampusMap({ plan, booked, hasBookedData, readOnly, onClose }: Props) {
  const [geo, setGeo] = useState<CampusGeo | null>(null);
  const isMobile = useIsMobile();
  const canvas = isMobile ? MOBILE_CANVAS : CANVAS;
  const [bookedOnly, setBookedOnly] = useState<boolean>(
    () => loadMapBookedOnly() ?? (hasBookedData && !readOnly),
  );
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [mapLoc, setMapLoc] = useState<{ building: string; room?: string } | null>(null);

  // BuildingPopover registers its own Escape handler while `mapLoc` is set; without this
  // guard both fire on one keypress and the user is bounced out of the whole map when all
  // they meant was "close this popover".
  useEscapeKey(mapLoc ? () => {} : onClose);

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

  // Split against the SAME viewport the canvas draws through: a marker outside it is
  // invisible, so it must not be counted as a building on the map, and it belongs in
  // the list below with its own explanation rather than disappearing.
  const { onCanvas, offCanvas } = useMemo(
    () =>
      geo
        ? splitByViewport(groupPins(shown), geo, canvas.w, canvas.h)
        : { onCanvas: [], offCanvas: [] },
    [shown, geo, canvas.w, canvas.h],
  );
  const unplaced = useMemo(() => unplacedPins(shown, offCanvas), [shown, offCanvas]);
  const open = onCanvas.find((g) => g.key === openKey) ?? null;

  // The generic "nothing to place" copy is false only when a LOCATABLE class exists that
  // booked-only is hiding — an unbooked pin with no coords was never going on the map
  // either way, and turning the toggle off wouldn't change that.
  const bookedOnlyHidesEverything =
    showBookedToggle &&
    bookedOnly &&
    onCanvas.length === 0 &&
    allPins.some((p) => p.coords !== null && !p.booked);

  return (
    <div className="campusmap" role="dialog" aria-modal="true" aria-label="Campus map">
      <header className="campusmap__bar">
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

      {!readOnly && !hasBookedData && (
        <p className="campusmap__hint">
          Open “Booked Courses” on the TSS homepage once and TritonPlan can tell which of these
          you’re actually enrolled in.
        </p>
      )}

      <div className="campusmap__stage">
        {geo === null ? (
          <div className="campusmap__loading">Loading campus…</div>
        ) : bookedOnlyHidesEverything ? (
          <div className="campusmap__empty">
            Booked only is on and nothing here is booked yet. Turn it off to see every course
            in your plan.
          </div>
        ) : onCanvas.length === 0 && unplaced.length > 0 ? (
          <div className="campusmap__empty">
            Nothing here lands on the mapped part of campus — the list below has where these
            classes actually meet.
          </div>
        ) : onCanvas.length === 0 ? (
          <div className="campusmap__empty">
            No class locations to place yet. Add courses with scheduled meetings, and they’ll
            appear here.
          </div>
        ) : (
          <CampusMapCanvas
            geo={geo}
            pins={shown}
            width={canvas.w}
            height={canvas.h}
            selectedKey={openKey}
            onSelect={setOpenKey}
          />
        )}
      </div>

      {open && (
        <div className="campusmap__detail">
          <div className="campusmap__detail-name">{open.building}</div>
          <ul className="campusmap__detail-list">
            {open.pins.map((p, i) => (
              <li key={`${p.courseId}-${p.label}-${i}`}>
                <b>{p.courseCode}</b> · {p.label} ·{' '}
                {p.when.weekday ?? p.when.date} {p.when.start}–{p.when.end}
                {p.room ? ` · Room ${p.room}` : ''}
              </li>
            ))}
          </ul>
          {open.building && (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setMapLoc({ building: open.building!, room: open.pins[0]!.room })}
            >
              Directions
            </button>
          )}
        </div>
      )}

      {unplaced.length > 0 && (
        <div className="campusmap__unlocated">
          <div className="eyebrow">Not on the map</div>
          <ul>
            {unplaced.map((u, i) => (
              <li key={`${u.pin.courseId}-${u.reason}-${i}`}>
                <b>{u.pin.courseCode}</b> {u.pin.label} — {u.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

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
