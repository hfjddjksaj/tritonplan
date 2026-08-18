import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * QA C1: `maplibre-gl@6` guesses its worker URL from `import.meta.url`, which
 * points at a file Rollup never emits — so the worker 404s, the map never
 * starts, and MapLibre raises no error while it happens. Nothing noticed.
 *
 * Two halves of that are testable here — that the bundler resolves the worker
 * to a URL at all, and that the URL is handed to MapLibre before any map is
 * built. The third half (that the URL a PRODUCTION build points at actually
 * exists in `dist/`) cannot be reached from jsdom at all, because it is a
 * property of the emitted directory rather than of the module graph; that one
 * is covered by `scripts/verify-build.mjs`, which `npm run build` runs.
 */
const setWorkerUrl = vi.fn();
vi.mock('maplibre-gl', () => ({ setWorkerUrl }));

describe('map worker wiring', () => {
  beforeEach(() => {
    setWorkerUrl.mockClear();
    vi.resetModules();
  });

  it('resolves the worker through the bundler rather than leaving MapLibre to guess', async () => {
    const { MAP_WORKER_URL } = await import('./map-worker');
    expect(typeof MAP_WORKER_URL).toBe('string');
    expect(MAP_WORKER_URL.length).toBeGreaterThan(0);
    // Whatever the bundler names it, it must stay a path on our own origin —
    // the zero-runtime-external-requests red line covers the worker too.
    expect(MAP_WORKER_URL).not.toMatch(/^[a-z]+:\/\//i);
    expect(MAP_WORKER_URL).toMatch(/worker/i);
  });

  it('hands that URL to MapLibre, once, however many maps are built', async () => {
    const { configureMapWorker, MAP_WORKER_URL } = await import('./map-worker');
    configureMapWorker();
    expect(setWorkerUrl).toHaveBeenCalledWith(MAP_WORKER_URL);
    configureMapWorker();
    expect(setWorkerUrl).toHaveBeenCalledTimes(1);
  });
});
