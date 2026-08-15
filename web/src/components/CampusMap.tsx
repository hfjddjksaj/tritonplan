import { useEffect, useMemo, useState } from 'react';
import type { PlanState } from '@triton/shared';
import { loadCampusGeo, type CampusGeo } from '../lib/campus-geo';
import { defaultSliceId, meetingPins, slicesFor } from '../lib/map-pins';
import { groupPins, unlocatedPins } from '../lib/map-labels';
import { loadMapBookedOnly, saveMapBookedOnly } from '../lib/storage';
import { todayWeekday } from '../lib/format';
import { useEscapeKey } from '../hooks/useEscapeKey';
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

const CANVAS_W = 1100;
const CANVAS_H = 760;

/**
 * Full-page campus map, toggled by state rather than a route: the address bar
 * hash is already owned by share links (#p=) and the self-mirror (#m=), so a
 * router would collide with readHash(). `position: fixed` (Task 11's CSS)
 * covers the viewport regardless of DOM depth, so — like BuildingPopover —
 * this renders inline rather than through a portal.
 */
export function CampusMap({ plan, booked, hasBookedData, readOnly, onClose }: Props) {
  const [geo, setGeo] = useState<CampusGeo | null>(null);
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

  const showBookedToggle = !readOnly && hasBookedData;
  const effectiveBookedOnly = showBookedToggle && bookedOnly;

  const allPins = useMemo(() => meetingPins(plan, booked), [plan, booked]);
  const scoped = useMemo(
    () => (effectiveBookedOnly ? allPins.filter((p) => p.booked) : allPins),
    [allPins, effectiveBookedOnly],
  );

  const { slices, predicate } = useMemo(() => slicesFor(scoped), [scoped]);
  const [sliceId, setSliceId] = useState<string>(() => defaultSliceId(slices, todayWeekday()));
  useEffect(() => {
    // The available columns change with scope; keep the selection valid.
    if (!slices.some((s) => s.id === sliceId)) setSliceId(defaultSliceId(slices, todayWeekday()));
  }, [slices, sliceId]);

  const shown = useMemo(() => scoped.filter(predicate(sliceId)), [scoped, predicate, sliceId]);
  const unlocated = useMemo(() => unlocatedPins(shown), [shown]);
  const groups = useMemo(() => groupPins(shown), [shown]);
  const open = groups.find((g) => g.key === openKey) ?? null;

  // The generic "nothing to place" copy is false only when a LOCATABLE class exists that
  // booked-only is hiding — an unbooked pin with no coords was never going on the map
  // either way, and turning the toggle off wouldn't change that.
  const bookedOnlyHidesEverything =
    showBookedToggle &&
    bookedOnly &&
    groups.length === 0 &&
    allPins.some((p) => p.coords !== null && !p.booked);

  return (
    <div className="campusmap" role="dialog" aria-modal="true" aria-label="Campus map">
      <header className="campusmap__bar">
        <div className="campusmap__title">
          Campus map
          <span className="campusmap__count">
            {groups.length === 0 ? 'nothing to show' : `${groups.length} buildings`}
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
        ) : groups.length === 0 ? (
          <div className="campusmap__empty">
            No class locations to place yet. Add courses with scheduled meetings, and they’ll
            appear here.
          </div>
        ) : (
          <CampusMapCanvas
            geo={geo}
            pins={shown}
            width={CANVAS_W}
            height={CANVAS_H}
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

      {unlocated.length > 0 && (
        <div className="campusmap__unlocated">
          <div className="eyebrow">Couldn’t place</div>
          <ul>
            {unlocated.map((p, i) => (
              <li key={`${p.courseId}-${i}`}>
                <b>{p.courseCode}</b> {p.label} —{' '}
                {p.rawLocation ?? p.building ?? 'no location listed in TSS'}
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
