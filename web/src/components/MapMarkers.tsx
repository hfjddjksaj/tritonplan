/**
 * DOM overlay drawn on top of the MapLibre GL canvas: one focusable marker
 * per visible pin group, with its label chip beside it unless the marker is
 * the one currently open (the card takes over its chip's job, same as the
 * old SVG renderer). Positions come from `map.project()`, so they track the
 * GL camera exactly; the caller re-renders this on every `tick` from
 * `useMapLibre` so a pan or zoom re-projects every marker in step with the
 * map underneath it.
 *
 * Click / keyboard / focus-ring behaviour mirrors the SVG marker it replaces
 * (see `CampusMapCanvas.tsx`): click toggles selection and stops the click
 * from reaching the map background; Enter and Space do the same from the
 * keyboard; a pointerdown is prevented so a mouse click never leaves a focus
 * ring on the dot.
 */
import { useMemo } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { colorsForHue } from '../lib/colors';
import { CHIP_H, chipWidth, inside, markerLabel, placeLabels, type PinGroup } from '../lib/map-labels';

interface Props {
  map: MapLibreMap | null;
  /** Bumped (rAF-throttled) by `useMapLibre` on every camera move — re-projects markers on change. */
  tick: number;
  groups: readonly PinGroup[];
  bounds: { w: number; h: number };
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

export function MapMarkers({ map, tick, groups, bounds, selectedKey, onSelect }: Props): JSX.Element | null {
  // Re-projected whenever the map, the camera (tick), the pin set, or the
  // canvas size changes — not on every unrelated re-render of the parent.
  const projected = useMemo(() => {
    if (!map) return [];
    return groups
      .map((g) => ({ g, pt: map.project([g.lng, g.lat]) }))
      .filter(({ pt }) => inside(pt.x, pt.y, bounds.w, bounds.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tick, groups, bounds.w, bounds.h]);

  const labels = useMemo(() => {
    const placed = placeLabels(
      projected.map(({ g, pt }) => ({ key: g.key, x: pt.x, y: pt.y, w: chipWidth(g.pins), h: CHIP_H })),
      bounds,
    );
    return new Map(placed.map((p) => [p.key, p]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projected, bounds.w, bounds.h]);

  if (!map) return null;

  return (
    <div className="campusmap__overlay" aria-hidden={false}>
      {projected.map(({ g, pt }) => {
        const c = colorsForHue(g.pins[0]!.hue);
        const booked = g.pins.some((p) => p.booked);
        const open = selectedKey === g.key;
        // The open marker's chip is replaced by the card the shell draws over the map.
        const label = open ? undefined : labels.get(g.key);
        const first = g.pins[0]!;
        const chipLabel = g.pins.length === 1 ? first.label : `+${g.pins.length - 1}`;
        return (
          <div
            key={g.key}
            className={`campusmap__marker${booked ? ' campusmap__marker--booked' : ''}${open ? ' campusmap__marker--open' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={markerLabel(g)}
            aria-pressed={open}
            style={{ transform: `translate(${pt.x}px, ${pt.y}px)` }}
            // A mouse press must not focus the marker: the browser would then paint a
            // focus ring around the dot for as long as the card is open. Cancelling
            // pointerdown drops the compat mousedown — and the focus move with it —
            // while the click still fires; Tab / Enter focus is unaffected.
            onPointerDown={(e) => e.preventDefault()}
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
            {label && (
              <span className="campusmap__chip" style={{ left: label.x - pt.x, top: label.y - pt.y }}>
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
