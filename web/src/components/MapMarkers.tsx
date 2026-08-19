/**
 * DOM overlay drawn on top of the MapLibre GL canvas: one focusable marker per
 * visible pin group — a dot on the building, and beside it a chip naming every
 * course that meets there. The marker the student has open shows the card in
 * place of its chip, in a layer pinned to that marker's dot (see below).
 *
 * GLUED TO THE MAP, and that is the reason this component writes DOM styles by
 * hand instead of leaving positions to React. Every marker's dot transform is
 * written synchronously from MapLibre's own `move` event, the way MapLibre's
 * built-in `Marker` does it: `move` fires while the camera change is still
 * being processed, so the overlay lands in the SAME frame the GL canvas paints.
 * Driving the transforms off the rAF-throttled `tick` instead — a React state
 * bump, so a re-render one frame later — is exactly what made the pins swim
 * behind the basemap during a drag. `tick` still drives everything else
 * (which markers exist, which side of the dot each chip sits on): those may
 * settle a frame late without anyone seeing it, positions may not.
 *
 * The chip is a CHILD of its marker, offset from the dot in local pixels rather
 * than placed in canvas coordinates, so the one transform carries both. The
 * card rides in a layer of its own, pinned to the open marker's dot by the same
 * writer — a sibling, not a child, because inside the marker its clicks and
 * Enter presses bubbled into the marker's own toggle handler and closing the
 * card was the first thing "Directions" did.
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
 * because MapLibre does not fire `click` after a drag. The card itself takes
 * the pointer back (app.css), because it holds a real button.
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
import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { colorsForHue } from '../lib/colors';
import { chipRows, markerLabel, type PinGroup, type PlacedMarker } from '../lib/map-labels';
import { useMarkerLayout } from '../hooks/useMarkerLayout';

interface Props {
  map: MapLibreMap | null;
  /** Bumped (rAF-throttled) by `useMapLibre` on every camera move — re-runs the chip layout. */
  tick: number;
  groups: readonly PinGroup[];
  bounds: { w: number; h: number };
  selectedKey: string | null;
  /** The marker the pointer is over, from `CampusMap`'s hit test — see the note above. */
  hoverKey?: string | null;
  /** The open marker's card. Drawn in its own layer, pinned to that marker's dot. */
  card?: ReactNode;
  onSelect: (key: string | null) => void;
}

export function MapMarkers({
  map,
  tick,
  groups,
  bounds,
  selectedKey,
  hoverKey = null,
  card = null,
  onSelect,
}: Props): JSX.Element | null {
  const placed = useMarkerLayout(map, tick, groups, bounds);

  // The marker elements, by group key, and the layout the position writer reads
  // — a ref, so binding the `move` listener once per map survives every
  // re-render that changes what is on screen.
  const els = useRef(new Map<string, HTMLDivElement>());
  const cardEl = useRef<HTMLDivElement | null>(null);
  const layout = useRef<PlacedMarker[]>(placed);
  layout.current = placed;

  const writePositions = useCallback(() => {
    if (!map) return;
    for (const m of layout.current) {
      const el = els.current.get(m.group.key);
      const layerEl = m.group.key === selectedKey ? cardEl.current : null;
      if (!el && !layerEl) continue;
      const pt = map.project([m.group.lng, m.group.lat]);
      const at = `translate(${pt.x}px, ${pt.y}px)`;
      if (el) el.style.transform = at;
      if (layerEl) layerEl.style.transform = at;
    }
  }, [map, selectedKey]);

  // Once per commit (a marker that just mounted has no transform yet), and then
  // on every event that can change where a pin belongs on screen.
  //
  // `move` is the camera, and it has to stay: writing inside MapLibre's own move
  // event is what puts the dot on the same frame as the GL canvas instead of a
  // frame behind it.
  //
  // But the camera is not the only input to `project()`. With terrain on, a
  // pin's screen position depends on the DEM elevation UNDER it, and that
  // elevation arrives late — the tiles are still loading when the 2D → 3D ease
  // ends. When it lands, the ground moves and NO move event fires, so a
  // move-only writer leaves every pin frozen at the position it computed for
  // flat ground. Measured on this map: toggle terrain off and back on without
  // touching the camera and the pins do not budge while `project()` answers
  // 342 px away — the pin floating beside the building it is marking.
  // MapLibre's own Marker has the same three subscriptions for the same reason.
  useLayoutEffect(writePositions);
  useEffect(() => {
    if (!map) return;
    // `render` is the belt to `terrain`'s braces: setTerrain fires `terrain`, but a
    // DEM tile finishing its download only repaints, and a repaint is exactly
    // when the ground under a pin can have moved. Writing the same transform
    // twice costs a string assignment.
    const events = ['move', 'terrain', 'render'] as const;
    for (const e of events) map.on(e, writePositions);
    return () => {
      for (const e of events) map.off(e, writePositions);
    };
  }, [map, writePositions]);

  if (!map) return null;

  return (
    <div className="campusmap__overlay" aria-hidden={false}>
      {placed.map(({ group: g, x, y, chip }) => {
        const c = colorsForHue(g.pins[0]!.hue);
        const booked = g.pins.some((p) => p.booked);
        const open = selectedKey === g.key;
        const rows = chipRows(g.pins);
        return (
          <div
            key={g.key}
            ref={(el) => {
              if (el) els.current.set(g.key, el);
              else els.current.delete(g.key);
            }}
            className={`campusmap__marker${booked ? ' campusmap__marker--booked' : ''}${open ? ' campusmap__marker--open' : ''}${hoverKey === g.key ? ' campusmap__marker--hover' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={markerLabel(g)}
            aria-pressed={open}
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
            {/* Hidden while the card is open: the card stands in for it, and grows
                out of the very box the chip was holding (the card layer below). */}
            {!open && (
              <span
                className={`campusmap__chip${rows.length > 1 ? ' campusmap__chip--stack' : ''}`}
                style={{ left: chip.x - x, top: chip.y - y }}
              >
                {rows.map((r) => (
                  <span key={r.courseId} className="campusmap__chiprow">
                    <span className="campusmap__chip-dot" style={{ background: colorsForHue(r.hue).spine }} />
                    <span className="campusmap__chipcode">{r.courseCode}</span>
                  </span>
                ))}
              </span>
            )}
          </div>
        );
      })}
      {/* The open marker's card, pinned to that marker's dot by the same writer
          and drawn after every chip. Its own layer rather than a child of the
          marker: the card holds real controls, and inside the marker their
          clicks and key presses bubbled into the marker's toggle — pressing
          "Directions" closed the card on the way to opening the popover. */}
      {card && placed.some((m) => m.group.key === selectedKey) && (
        <div className="campusmap__cardlayer" ref={cardEl}>
          {card}
        </div>
      )}
    </div>
  );
}
