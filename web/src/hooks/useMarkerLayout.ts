/**
 * Where the marker overlay's dots and chips are, in canvas pixels, for the
 * camera as it stands right now.
 *
 * One implementation, two callers: `MapMarkers` draws from it, and `CampusMap`
 * hit-tests against it when MapLibre reports a click or a mousemove on the
 * canvas underneath. They have to agree exactly — a chip you can see but not
 * click is worse than no chip — so the geometry lives here rather than being
 * derived twice. Both memoize on the same inputs; the work is a projection and
 * a small greedy collision pass over a dozen markers, so computing it in both
 * places is cheaper than threading a mutable layout between them.
 */
import { useMemo } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { CHIP_H, chipWidth, inside, placeLabels, type PinGroup, type PlacedMarker } from '../lib/map-labels';

export function useMarkerLayout(
  map: MapLibreMap | null,
  /** Bumped by `useMapLibre` on every camera move — the reason to re-project. */
  tick: number,
  groups: readonly PinGroup[],
  bounds: { w: number; h: number },
  /** The open marker: its chip is `null`, because the card stands in for it. */
  selectedKey: string | null,
): PlacedMarker[] {
  return useMemo(() => {
    if (!map) return [];
    const projected = groups
      .map((g) => ({ g, pt: map.project([g.lng, g.lat]) }))
      .filter(({ pt }) => inside(pt.x, pt.y, bounds.w, bounds.h));
    const placed = new Map(
      placeLabels(
        projected.map(({ g, pt }) => ({ key: g.key, x: pt.x, y: pt.y, w: chipWidth(g.pins), h: CHIP_H })),
        bounds,
      ).map((p) => [p.key, p]),
    );
    return projected.map(({ g, pt }) => {
      const label = g.key === selectedKey ? undefined : placed.get(g.key);
      return {
        group: g,
        x: pt.x,
        y: pt.y,
        chip: label ? { x: label.x, y: label.y, w: chipWidth(g.pins), h: CHIP_H } : null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tick, groups, bounds.w, bounds.h, selectedKey]);
}
