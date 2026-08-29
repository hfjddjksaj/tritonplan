/**
 * Orchestration for the Distance bar: lazy-load the graph and the campus
 * geometry, turn two places into two sets of doors, and route all three modes.
 *
 * Nothing here runs — and nothing downloads — until BOTH ends are picked. That
 * is what keeps opening the map itself unchanged in cost: the
 * graph and the geometry are dynamic imports behind memoized loaders, so a
 * reader who never fills in the second select never pays a byte for either.
 *
 * Every failure below degrades instead of throwing. Routing over
 * real data fails for ordinary reasons — 182 of the 608 bundled footprints sit
 * outside the walk graph's bbox and get no doors at all — so a caller that had
 * to handle exceptions would be handling the common case.
 */
import { useEffect, useRef, useState } from 'react';
import { type CampusShape, loadCampusGeo } from '../lib/campus-geo';
import { PROFILE_ORDER, type Profile } from '../lib/walk-cost';
import { type WalkGraph, loadWalkGraph } from '../lib/walk-graph';
import type { WalkPlace } from '../lib/walk-places';
import { type WalkResult, routeBetween, straightLineEstimate } from '../lib/walk-route';
import { type Portal, buildPortals, resampleOutline } from '../lib/walk-snap';

export interface WalkState {
  loading: boolean;
  /** One entry per mode; `null` when there was nothing to compute at all. */
  results: Partial<Record<Profile, WalkResult>> | null;
  error: string | null;
}

/**
 * Shared instance, not a fresh literal: an effect that re-decides "still
 * nothing selected" then hands `setState` a value React can bail out on
 * instead of scheduling another render.
 */
const IDLE: WalkState = { loading: false, results: null, error: null };

/**
 * ⚠ The two halves of this file speak different axis names, and mixing them up
 * would still typecheck while producing garbage. `WalkPlace.coords` is
 * `{ lat, lng }` because it comes from `MapPin`, which speaks MapLibre's
 * `lng`; everything under `lib/walk-*` speaks `{ lat, lon }`. Every crossing
 * goes through this function — never spread one shape into the other.
 */
const asLatLon = (c: { lat: number; lng: number }): { lat: number; lon: number } => ({
  lat: c.lat,
  lon: c.lng,
});

/**
 * The footprint names a place claims. A COMPLEX match carries `parts` — the
 * official names of its wings — and its `place` is then only their shared
 * label, which matches no polygon on its own (see `buildings.ts`).
 */
const namesOf = (p: WalkPlace): readonly string[] => p.parts ?? (p.place ? [p.place] : []);

/**
 * Identity by CONTENT, not by object. `walkPlaces()` re-derives its list from
 * the plan on every render, so a caller that maps a stored id back through
 * that list hands us a fresh object each time — and an effect keyed on object
 * identity would re-route on every render, forever.
 */
function keyOf(p: WalkPlace | null): string {
  if (!p) return '';
  // JSON, not a joined string: `WalkPlace.id` is itself a delimiter-joined
  // triple (`walk-places.ts`), so any separator we picked would already be
  // living inside one of the fields we are separating.
  return JSON.stringify([p.id, p.place ?? '', namesOf(p), p.coords]);
}

/**
 * Doors, remembered per (graph, place). Flipping through one dropdown re-snaps
 * only the end that changed; the other building's outline is already walked.
 * Keyed on the same content key as the effect, so a place whose coordinates
 * moved gets fresh doors rather than the old ones.
 */
const portalCache = new WeakMap<WalkGraph, Map<string, Portal[]>>();

function buildDoors(g: WalkGraph, shapes: Map<string, CampusShape>, p: WalkPlace): Portal[] {
  if (!p.coords) return [];
  const centroid = asLatLon(p.coords);
  const rings = namesOf(p).flatMap((n) => shapes.get(n)?.rings ?? []);
  if (rings.length === 0) {
    // No polygon under that name — TSS can name a place the GIS layer has no
    // footprint for, and an alias in `building-aliases.ts` may carry
    // coordinates without one. Snap around the point we do have instead of
    // giving up: the doors are then the nodes near the centroid, and the
    // indoor leg is zero because there is no outline to walk out along.
    const point: [number, number][] = [[centroid.lat, centroid.lon]];
    return buildPortals(g, point, centroid);
  }
  return buildPortals(g, resampleOutline(rings), centroid);
}

function portalsFor(
  g: WalkGraph,
  shapes: Map<string, CampusShape>,
  p: WalkPlace,
  key: string,
): Portal[] {
  let byKey = portalCache.get(g);
  if (!byKey) portalCache.set(g, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const built = buildDoors(g, shapes, p);
  byKey.set(key, built);
  return built;
}

export function useWalkRoute(a: WalkPlace | null, b: WalkPlace | null): WalkState {
  const [state, setState] = useState<WalkState>(IDLE);

  /**
   * A run token, not a cancel flag. The loads are memoized module-side and
   * a Dijkstra cannot be interrupted, so there is nothing to abort — what
   * matters is that a slow FIRST load cannot land its answer on screen after
   * the reader has already changed a selection. Each run remembers the token
   * it was born with and drops its result once a newer run has bumped it.
   */
  const token = useRef(0);

  const keyA = keyOf(a);
  const keyB = keyOf(b);

  /** Lets the effect read the current places without depending on their identity. */
  const latest = useRef({ a, b });
  latest.current = { a, b };

  useEffect(() => {
    const mine = ++token.current;
    const from = latest.current.a;
    const to = latest.current.b;
    // Property narrowing does not survive into the closure below, so the two
    // coordinates are pinned to consts here.
    const fromAt = from?.coords ?? null;
    const toAt = to?.coords ?? null;

    // Two distinct, locatable ends or nothing. Anything less has no answer —
    // not even a degraded one, which needs two coordinates to draw a straight
    // line between — so we return before touching either loader.
    if (!from || !to || from.id === to.id || !fromAt || !toAt) {
      setState(IDLE);
      return;
    }

    setState({ loading: true, results: null, error: null });

    void (async () => {
      try {
        const [g, geo] = await Promise.all([loadWalkGraph(), loadCampusGeo()]);
        if (token.current !== mine) return; // a newer selection owns the screen

        const shapes = new Map<string, CampusShape>();
        for (const f of geo.footprints) if (!shapes.has(f.name)) shapes.set(f.name, f);

        const doorsA = portalsFor(g, shapes, from, keyA);
        const doorsB = portalsFor(g, shapes, to, keyB);
        const snapped = doorsA.length > 0 && doorsB.length > 0;

        const results: Partial<Record<Profile, WalkResult>> = {};
        for (const profile of PROFILE_ORDER) {
          const route = snapped ? routeBetween(g, doorsA, doorsB, profile) : null;
          // Both real failures land here: a building with no doors (Scripps,
          // Hillcrest and the Regents Road blocks all sit outside the graph's
          // bbox) and an end the network cannot reach in this mode (a bike
          // walled off by stairs). Neither is exceptional, and both answer
          // with a straight-line estimate that says so.
          results[profile] =
            route ??
            straightLineEstimate(
              profile,
              asLatLon(fromAt),
              asLatLon(toAt),
              snapped ? 'unreachable' : 'no-snap',
            );
        }

        setState({ loading: false, results, error: null });
      } catch (err) {
        if (token.current !== mine) return;
        setState({
          loading: false,
          results: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [keyA, keyB]);

  return state;
}
