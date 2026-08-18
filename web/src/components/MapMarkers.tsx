/**
 * DOM overlay drawn on top of the MapLibre GL canvas: one focusable marker
 * per visible pin group, with its label chip beside it unless the marker is
 * the one currently open (the card takes over its chip's job). Positions come
 * from `useMarkerLayout`, so they track the GL camera exactly; the caller
 * re-renders this on every `tick` from `useMapLibre` so a pan or zoom
 * re-projects every marker in step with the map underneath it.
 *
 * POINTER-TRANSPARENT, deliberately. This overlay is a SIBLING of the GL
 * container, so anything it takes, MapLibre never sees. Markers used to be
 * `pointer-events: auto` (and to cancel `pointerdown` on top of that, to keep a
 * mouse press from leaving a focus ring), which made every chip and dot a dead
 * zone: press and drag on one and the map did not move, did not zoom, and no
 * card opened either — the gesture simply vanished, over as much as 4 % of the
 * canvas on a phone (QA I1). Now the whole overlay is transparent to the
 * pointer: every press, drag, pinch and wheel reaches MapLibre untouched, and
 * `CampusMap` opens the card from MapLibre's own `click` via `hitMarker()` —
 * which also means a drag that starts on a chip pans without opening anything,
 * because MapLibre does not fire `click` after a drag.
 *
 * Keyboard and assistive tech are unaffected, and must stay that way:
 * `pointer-events: none` does not touch the tab order, so Tab still reaches
 * every marker and Enter / Space still open its card, and a screen reader
 * activating this `role="button"` dispatches a synthetic `click` straight at
 * the element, which `onClick` below still answers. The focus ring the
 * cancelled `pointerdown` was there to suppress cannot happen any more — a
 * mouse can no longer focus a marker at all — and the `:focus` / `:focus-visible`
 * pair in app.css keeps keyboard focus visible.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { colorsForHue } from '../lib/colors';
import { markerLabel, type PinGroup } from '../lib/map-labels';
import { useMarkerLayout } from '../hooks/useMarkerLayout';

interface Props {
  map: MapLibreMap | null;
  /** Bumped (rAF-throttled) by `useMapLibre` on every camera move — re-projects markers on change. */
  tick: number;
  groups: readonly PinGroup[];
  bounds: { w: number; h: number };
  selectedKey: string | null;
  /** The marker the pointer is over, from `CampusMap`'s hit test — see the note above. */
  hoverKey?: string | null;
  onSelect: (key: string | null) => void;
}

export function MapMarkers({ map, tick, groups, bounds, selectedKey, hoverKey = null, onSelect }: Props): JSX.Element | null {
  const placed = useMarkerLayout(map, tick, groups, bounds, selectedKey);

  if (!map) return null;

  return (
    <div className="campusmap__overlay" aria-hidden={false}>
      {placed.map(({ group: g, x, y, chip }) => {
        const c = colorsForHue(g.pins[0]!.hue);
        const booked = g.pins.some((p) => p.booked);
        const open = selectedKey === g.key;
        const first = g.pins[0]!;
        const chipLabel = g.pins.length === 1 ? first.label : `+${g.pins.length - 1}`;
        return (
          <div
            key={g.key}
            className={`campusmap__marker${booked ? ' campusmap__marker--booked' : ''}${open ? ' campusmap__marker--open' : ''}${hoverKey === g.key ? ' campusmap__marker--hover' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={markerLabel(g)}
            aria-pressed={open}
            style={{ transform: `translate(${x}px, ${y}px)` }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(open ? null : g.key);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault(); // Space would scroll the overlay
              e.stopPropagation();
              onSelect(open ? null : g.key);
            }}
          >
            <span
              className="campusmap__dot"
              style={{ background: booked ? c.spine : '#fff', borderColor: c.spine }}
            />
            {chip && (
              <span className="campusmap__chip" style={{ left: chip.x - x, top: chip.y - y }}>
                <span className="campusmap__chip-dot" style={{ background: c.spine }} />
                <span className="campusmap__chipcode">{first.courseCode}</span>
                <span className="campusmap__chiplabel">{chipLabel}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
