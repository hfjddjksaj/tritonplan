/**
 * "How far is it from here to there" — the collapsible block at the foot of the
 * map island.
 *
 * Deliberately NOT a fourth tab beside Classes / Finals / Midterms: those pick
 * WHICH PINS to show, this performs an action on two of them. Sharing that row
 * would blur what the row means (user's call, 2026-08-21). A hairline separates
 * the two jobs instead.
 *
 * ⚠ Time is shown to the minute and never finer, and no copy here may imply
 * better. That is not a rendering preference, it is the accuracy floor. TSS
 * gives a room number and there are no indoor coordinates, so every place is
 * positioned at its building's centroid: the median UCSD teaching building is
 * 52 m across (p90 88 m, Biomedical Sciences 143 m), which at 1.3 m/s is ±40 s
 * of error before the router has done anything at all — ±1.8 min for the worst
 * building (spec §2.2, §2.4). "13 min 20 s" would be a claim the data cannot
 * support however exact the routing is. The drawn route, the flight count and
 * the climb are this feature's real output; the time is a rounded courtesy.
 *
 * ⚠ Two readings the copy has to keep honest, both forced by real pairs
 * measured against the engine on 2026-08-21:
 *
 *  1. `metres` counts the OUTDOOR NETWORK LEG only, while `seconds` covers the
 *     whole door-to-door trip, walking inside the buildings included. The two
 *     bases are deliberate and walk-route.ts explains at length why neither may
 *     be "fixed" into the other. Center Hall → Conrad Prebys Music Center reads
 *     160 m and 5 min, because 227 equivalent metres of that trip is indoors
 *     between two wide buildings. Set as a bare "160 m" over "5 min" a reader
 *     divides them, gets 0.5 m/s, and concludes the feature is broken. So the
 *     distance is always LABELLED as the on-path distance — "160 m on paths" —
 *     the length of the gold line they can see, never the length of the trip.
 *  2. A route can be a single point with `metres === 0`, and that is a real
 *     answer rather than a failure: Mayer Hall and York Hall reach the same
 *     network node, so their cheapest route never touches the network. "0 m"
 *     would read as broken, so under a metre the distance slot says "Next door"
 *     and the readout explains that there is no outdoor leg to draw.
 */
import { useId, useState } from 'react';
import { googleMapsLink } from '../lib/buildings';
import { colorsForHue } from '../lib/colors';
import { PROFILES, PROFILE_ORDER, type Profile } from '../lib/walk-cost';
import type { WalkPlace } from '../lib/walk-places';
import type { WalkResult } from '../lib/walk-route';
import { tip } from './Tooltip';

interface Props {
  places: WalkPlace[];
  a: WalkPlace | null;
  b: WalkPlace | null;
  onPick(end: 'a' | 'b', place: WalkPlace | null): void;
  onSwap(): void;
  onClear(): void;
  /** The active profile's result, or null when there is nothing to show yet. */
  route: WalkResult | null;
  profile: Profile;
  onProfile(p: Profile): void;
  /** Every profile's result, so a mode chip can carry its own time. */
  results: Partial<Record<Profile, WalkResult>> | null;
  loading: boolean;
}

/**
 * Under a metre of network leg is the degenerate same-node case, not a short
 * walk: node coordinates are quantised to a 1e6 grid (~0.11 m), so two doors
 * that resolve to one node give exactly 0 and nothing else lands this low.
 */
const NEAR_M = 1;

/** Below this a climb is terrain noise from an 8 m/px DEM, not a hill worth mentioning. */
const CLIMB_M = 5;

/** Never finer than a minute, and never "0 min" for a trip you still have to make. */
const minutes = (seconds: number): string => `${Math.max(1, Math.round(seconds / 60))} min`;

const rawDistance = (m: number): string =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

/**
 * The distance slot, qualified so it can never be divided into the time.
 * Degraded answers get "≈" instead of "on paths": there is no path behind them
 * (spec §6 draws no line for those), so claiming one would be the wrong lie.
 */
function distanceText(r: WalkResult): string {
  if (r.degraded) return `≈ ${rawDistance(r.metres)}`;
  if (r.metres < NEAR_M) return 'Next door';
  return `${rawDistance(r.metres)} on paths`;
}

const DIST_TIP =
  'Distance along the route drawn on the map. The time also covers walking inside the buildings, so the two are not a walking speed.';

const NEAR_TIP =
  'Both ends reach the path network at the same point, so there is no outdoor leg to measure or draw. The time is what it takes to get out of one building and into the other.';

const TIME_TIP =
  'Door to door, to the nearest minute. Places are located to the building, so anything finer than a minute would be made up.';

const flights = (n: number): string => `${n} flight${n === 1 ? '' : 's'}`;

/**
 * Unusable places stay in the list and say why. A student whose lecture is
 * online has to be able to see that it is missing on purpose — silently
 * dropping it looks like the planner lost their course.
 */
const placeLabel = (p: WalkPlace): string => {
  const where = p.place ? ` — ${p.place}` : '';
  const why =
    p.disabledReason === 'online'
      ? ' (online)'
      : p.disabledReason === 'no-location'
        ? ' (no location)'
        : '';
  return `${p.courseCode} · ${p.label}${where}${why}`;
};

function Picker({
  end,
  value,
  places,
  onPick,
  label,
}: {
  end: 'a' | 'b';
  value: WalkPlace | null;
  places: WalkPlace[];
  onPick(end: 'a' | 'b', place: WalkPlace | null): void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="campusmap__dist-row">
      <span className="campusmap__dist-lab" aria-hidden="true">
        {end.toUpperCase()}
      </span>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="campusmap__dist-select"
        value={value?.id ?? ''}
        onChange={(e) => onPick(end, places.find((p) => p.id === e.target.value) ?? null)}
      >
        <option value="">Pick a place…</option>
        {places.map((p) => (
          <option key={p.id} value={p.id} disabled={p.disabled}>
            {placeLabel(p)}
          </option>
        ))}
      </select>
      {value && (
        <span
          className="campusmap__dist-swatch"
          style={{ background: colorsForHue(value.hue).spine }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export function DistanceBar({
  places,
  a,
  b,
  onPick,
  onSwap,
  onClear,
  route,
  profile,
  onProfile,
  results,
  loading,
}: Props) {
  // Never remembered — every time the map opens this starts closed, on phones
  // and desktop alike (user's call, 2026-08-21). Expanded it stands ~268 px
  // tall, which is most of a narrow screen, and nobody wants that back until
  // they ask for it. So: component state, no localStorage, on purpose.
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const near = route !== null && !route.degraded && route.metres < NEAR_M;
  const summary = route ? `${distanceText(route)} · ${minutes(route.seconds)}` : null;

  // The clear button exists because the summary survives collapsing: a gold
  // line sits on the map while the bar is shut, so the way to undo it has to be
  // reachable while the bar is shut too. It appears for a half-set state as
  // well — a picked A with no B is also something to clear — but not for the
  // untouched bar, where it would offer to undo nothing.
  const canClear = route !== null || a !== null || b !== null;

  const cls = [
    'campusmap__dist',
    route && !route.degraded ? 'campusmap__dist--has' : '',
    route?.degraded ? 'campusmap__dist--vague' : '',
    open ? 'campusmap__dist--open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      <div className="campusmap__dist-barrow">
        <button
          type="button"
          className="campusmap__dist-bar"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="campusmap__dist-mark" aria-hidden="true">
            ⤳
          </span>
          <span className="campusmap__dist-label">Distance</span>
          {summary ? (
            <span className="campusmap__dist-sum">{summary}</span>
          ) : (
            <span className="campusmap__dist-hint">
              {loading ? 'measuring…' : 'between two places'}
            </span>
          )}
          <span className="campusmap__dist-chev" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </button>
        {canClear && (
          <button
            type="button"
            className="campusmap__dist-clear"
            // Sits beside "Close map" in the corner cluster, so it names what it
            // clears rather than being another bare ✕.
            aria-label="Clear distance"
            {...tip('Clear the route')}
            onClick={onClear}
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div className="campusmap__dist-panel" id={panelId}>
          <Picker end="a" value={a} places={places} onPick={onPick} label="From" />
          <button
            type="button"
            className="campusmap__dist-swap"
            {...tip('Swap the two ends')}
            onClick={onSwap}
          >
            <span aria-hidden="true">⇅ </span>Swap
          </button>
          <Picker end="b" value={b} places={places} onPick={onPick} label="To" />

          {loading && <div className="campusmap__dist-note">Working out the route…</div>}

          {!loading && !route && (
            <div className="campusmap__dist-note">Pick both ends to measure.</div>
          )}

          {!loading && route && (
            <>
              <div className="campusmap__dist-read">
                <span className="campusmap__dist-big" {...tip(TIME_TIP)}>
                  {minutes(route.seconds)}
                </span>
                <span className="campusmap__dist-sub" {...tip(near ? NEAR_TIP : DIST_TIP)}>
                  {near ? 'Next door — no outdoor leg to draw' : distanceText(route)}
                  {route.stepsRuns > 0 && ` · ${flights(route.stepsRuns)}`}
                  {route.ascent >= CLIMB_M && ` · ${Math.round(route.ascent)} m climb`}
                </span>
              </div>

              <div className="campusmap__dist-modes" role="group" aria-label="Travel mode">
                {PROFILE_ORDER.map((key) => {
                  const spec = PROFILES[key];
                  const r = results?.[key];
                  // A mode with no result at all cannot be walked into: picking
                  // it would blank the readout with no way to see why.
                  const dead = results !== null && r === undefined;
                  const time = r ? minutes(r.seconds) : null;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`campusmap__dist-mode${key === profile ? ' is-on' : ''}`}
                      aria-pressed={key === profile}
                      disabled={dead}
                      aria-label={`${spec.label}${time ? `, ${time}` : ''}${
                        spec.estimated ? ', estimated' : ''
                      }`}
                      {...tip(
                        dead
                          ? `No ${spec.label.toLowerCase()} route between these two`
                          : spec.estimated
                            ? `Estimated: OSM tags too little of UCSD to route a ${spec.label.toLowerCase()} properly`
                            : false,
                      )}
                      onClick={() => onProfile(key)}
                    >
                      {spec.label}
                      {time && <> {time}</>}
                      {spec.estimated && <span className="campusmap__dist-est"> est</span>}
                    </button>
                  );
                })}
              </div>

              <div className="campusmap__dist-foot">
                <span>
                  {route.degraded
                    ? 'Route unclear — straight-line estimate, no line drawn'
                    : 'Door to door, along real walking paths'}
                </span>
                {b?.place && (
                  <a
                    className="campusmap__dist-link"
                    href={googleMapsLink(b.place)}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`Open ${b.place} in Google Maps`}
                  >
                    Open in Google Maps ↗
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
