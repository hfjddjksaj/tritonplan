import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { WalkPlace } from '../lib/walk-places';
import type { WalkState } from './useWalkRoute';

/**
 * The two loaders are wrapped, NOT replaced: the point of these cases is that
 * the real 15.6k-node graph and the real 608 bundled footprints route
 * end to end. The counters exist only to prove the other half of the contract
 * — that a half-filled Distance bar downloads neither of them (spec §7.6) —
 * and `failNext` to prove a load that blows up degrades instead of throwing.
 */
const probe = vi.hoisted(() => ({ graph: 0, geo: 0, failNext: false }));

vi.mock('../lib/walk-graph', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/walk-graph')>();
  return {
    ...real,
    loadWalkGraph: () => {
      probe.graph++;
      return probe.failNext ? Promise.reject(new Error('graph unavailable')) : real.loadWalkGraph();
    },
  };
});

vi.mock('../lib/campus-geo', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/campus-geo')>();
  return {
    ...real,
    loadCampusGeo: () => {
      probe.geo++;
      return real.loadCampusGeo();
    },
  };
});

import { loadCampusGeo } from '../lib/campus-geo';
import { loadWalkGraph } from '../lib/walk-graph';
import { useWalkRoute } from './useWalkRoute';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------------ fixtures */

/** Coordinates are the official GIS records in `ucsd-buildings.json`. */
const place = (
  id: string,
  name: string | null,
  coords: { lat: number; lng: number } | null,
): WalkPlace => ({
  id,
  courseCode: 'CSE 11',
  label: 'LE',
  hue: 200,
  place: name ?? undefined,
  coords,
  disabled: coords === null,
});

const CENTER = place('a', 'Center Hall', { lat: 32.87804, lng: -117.23686 });
const GEISEL = place('b', 'Geisel Library', { lat: 32.88117, lng: -117.23758 });
/**
 * Scripps, on the shore — inside the campus geometry, outside the walk graph's
 * bbox, so its footprint snaps to zero doors. This is not a contrived case:
 * 182 of the 608 bundled footprints behave exactly like this.
 */
const HUBBS = place('c', 'Hubbs Hall', { lat: 32.86743, lng: -117.2534 });
const NOWHERE = place('d', 'Remote', null);

/* ------------------------------------------------------------------- harness */

interface Harness {
  result: { current: WalkState };
  /** Synchronous on purpose — see the stale-result case. */
  render: (a: WalkPlace | null, b: WalkPlace | null) => void;
  unmount: () => void;
}

/**
 * A local `renderHook`. This workspace has no @testing-library/react; the
 * repo's other hook tests drive `createRoot` + `act` directly, and so does
 * this one.
 */
function mount(): Harness {
  const result = { current: { loading: false, results: null, error: null } as WalkState };
  function Probe({ a, b }: { a: WalkPlace | null; b: WalkPlace | null }) {
    result.current = useWalkRoute(a, b);
    return null;
  }
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return {
    result,
    render: (a, b) => {
      act(() => {
        root.render(createElement(Probe, { a, b }));
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const tick = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
};

/** Pump until the hook stops loading. Generous: a cold decode is ~140 ms. */
async function settle(h: Harness, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (h.result.current.loading) {
    if (Date.now() > deadline) throw new Error('useWalkRoute never stopped loading');
    await tick();
  }
}

// Warmed once so every case below resolves on microtasks: the stale-result
// case in particular has to know the work is still in flight when it rerenders.
beforeAll(async () => {
  await Promise.all([loadWalkGraph(), loadCampusGeo()]);
}, 60_000);

afterEach(() => {
  probe.failNext = false;
});

/* --------------------------------------------------------------------- cases */

describe('useWalkRoute', () => {
  it('is idle with nothing selected, and downloads nothing', async () => {
    const before = { ...probe };
    const h = mount();
    h.render(null, null);
    await tick();
    expect(h.result.current).toEqual({ loading: false, results: null, error: null });
    expect(probe.graph).toBe(before.graph);
    expect(probe.geo).toBe(before.geo);
    h.unmount();
  });

  it('stays idle — and still downloads nothing — with only one end picked', async () => {
    const before = { ...probe };
    const h = mount();
    h.render(CENTER, null);
    await tick();
    expect(h.result.current.results).toBeNull();
    expect(h.result.current.loading).toBe(false);
    h.render(null, GEISEL);
    await tick();
    expect(h.result.current.results).toBeNull();
    expect(probe.graph).toBe(before.graph);
    expect(probe.geo).toBe(before.geo);
    h.unmount();
  });

  it('has nothing to say when both ends are the same place', async () => {
    const h = mount();
    h.render(CENTER, { ...CENTER });
    await tick();
    expect(h.result.current.results).toBeNull();
    expect(h.result.current.error).toBeNull();
    h.unmount();
  });

  it('produces a result for every profile once both ends are picked', async () => {
    const h = mount();
    h.render(CENTER, GEISEL);
    expect(h.result.current.loading).toBe(true);
    await settle(h);

    const results = h.result.current.results;
    expect(results).not.toBeNull();
    expect(Object.keys(results!).sort()).toEqual(['bike', 'scooter', 'walk']);
    expect(h.result.current.error).toBeNull();

    // Every entry knows which key it is filed under.
    for (const [key, r] of Object.entries(results!)) expect(r!.profile).toBe(key);

    const walk = results!.walk!;
    // Measured 2026-08-21 over the real bundled graph: 268 m, ~307 s. Banded
    // rather than pinned so an OSM refetch that nudges the path a few metres
    // does not fail the build — but tight enough to catch a lat/lng swap or a
    // unit slip, both of which land orders of magnitude away.
    expect(walk.degraded).toBe(false);
    expect(walk.metres).toBeGreaterThan(200);
    expect(walk.metres).toBeLessThan(400);
    expect(walk.seconds).toBeGreaterThan(150);
    expect(walk.seconds).toBeLessThan(600);
    expect(walk.path).not.toBeNull();
    expect(walk.path!.length).toBeGreaterThan(2);
    // Path is [lon, lat] — a swap would put UCSD in the Indian Ocean.
    for (const [lon, lat] of walk.path!) {
      expect(lon).toBeLessThan(-117);
      expect(lat).toBeGreaterThan(32);
    }
    h.unmount();
  }, 30_000);

  it('degrades to a labelled estimate for a building the graph has no doors for', async () => {
    const h = mount();
    h.render(CENTER, HUBBS);
    await settle(h);

    const results = h.result.current.results;
    expect(results).not.toBeNull();
    expect(h.result.current.error).toBeNull();
    for (const profile of ['walk', 'bike', 'scooter'] as const) {
      const r = results![profile]!;
      expect(r.degraded).toBe(true);
      if (!r.degraded) throw new Error('unreachable');
      expect(r.reason).toBe('no-snap');
      // No line on the map for a route we could not compute (spec §6).
      expect(r.path).toBeNull();
      expect(r.metres).toBeGreaterThan(1000); // Revelle to the shore, roughly
      expect(r.seconds).toBeGreaterThan(0);
    }
    h.unmount();
  }, 30_000);

  it('computes nothing, and loads nothing, when a place has no coordinates', async () => {
    const before = { ...probe };
    const h = mount();
    h.render(NOWHERE, GEISEL);
    await tick();
    expect(h.result.current.loading).toBe(false);
    expect(h.result.current.results).toBeNull();
    expect(h.result.current.error).toBeNull();
    // Not even a straight line exists without two coordinates, so nothing is
    // worth downloading for it.
    expect(probe.graph).toBe(before.graph);
    expect(probe.geo).toBe(before.geo);
    h.unmount();
  });

  it('drops a result the reader has already selected away from', async () => {
    const h = mount();
    // Both renders are synchronous, with no await between them: the first
    // run's continuation is still queued when the second selection lands.
    h.render(CENTER, GEISEL);
    h.render(null, null);
    for (let i = 0; i < 5; i++) await tick();
    // Without the run token the in-flight Center→Geisel answer would land here
    // and repopulate a bar the reader has cleared.
    expect(h.result.current.results).toBeNull();
    expect(h.result.current.loading).toBe(false);
    h.unmount();
  }, 30_000);

  it('reports a failed load as an error instead of throwing', async () => {
    probe.failNext = true;
    const h = mount();
    h.render(CENTER, GEISEL);
    await settle(h);
    expect(h.result.current.error).toBe('graph unavailable');
    expect(h.result.current.results).toBeNull();
    expect(h.result.current.loading).toBe(false);
    h.unmount();
  }, 30_000);
});
