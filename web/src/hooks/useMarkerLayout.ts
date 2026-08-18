/**
 * Where the marker overlay's dots and chips are, in canvas pixels, for the
 * camera as it stands right now.
 *
 * One implementation, three callers: `MapMarkers` draws from it, `CampusMap`
 * hit-tests against it when MapLibre reports a click or a mousemove on the
 * canvas underneath, and the marker card grows out of the chip box it reports
 * for the open marker. They have to agree exactly — a chip you can see but not
 * click is worse than no chip — so the geometry lives here rather than being
 * derived twice. Both memoize on the same inputs; the work is a projection and
 * a small greedy collision pass over a dozen markers, so computing it in both
 * places is cheaper than threading a mutable layout between them.
 *
 * This is the SLOW path, and deliberately so: it re-runs on the rAF-throttled
 * `tick`, which is a frame behind the GL canvas. Nothing here positions a
 * marker on screen — `MapMarkers` writes the dot transforms synchronously from
 * MapLibre's own `move` event, and the chip and card ride along as children of
 * the dot. What this hook decides is which SIDE of the dot a chip sits on, and
 * that may lag a frame without anyone noticing.
 */
import { useMemo } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { chipSize, inside, placeLabels, type PinGroup, type PlacedMarker } from '../lib/map-labels';

export function useMarkerLayout(
  map: MapLibreMap | null,
  /** Bumped by `useMapLibre` on every camera move — the reason to re-project. */
  tick: number,
  groups: readonly PinGroup[],
  bounds: { w: number; h: number },
): PlacedMarker[] {
  return useMemo(() => {
    if (!map) return [];
    const projected = groups
      .map((g) => ({ g, pt: map.project([g.lng, g.lat]), size: chipSize(g.pins) }))
      .filter(({ pt }) => inside(pt.x, pt.y, bounds.w, bounds.h));
    const placed = new Map(
      placeLabels(
        projected.map(({ g, pt, size }) => ({ key: g.key, x: pt.x, y: pt.y, w: size.w, h: size.h })),
        bounds,
      ).map((p) => [p.key, p]),
    );
    return projected.map(({ g, pt, size }) => {
      const label = placed.get(g.key)!;
      return {
        group: g,
        x: pt.x,
        y: pt.y,
        chip: { x: label.x, y: label.y, w: size.w, h: size.h, side: label.side },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tick, groups, bounds.w, bounds.h]);
}
