/**
 * Where MapLibre's own web worker comes from.
 *
 * `maplibre-gl@6` resolves its worker at runtime, from the bundle chunk it
 * happens to be sitting in: `new URL('./maplibre-gl-worker.mjs', import.meta.url)`,
 * and that worker in turn statically imports its sibling `./maplibre-gl-shared.mjs`.
 * Neither file is part of the module graph Rollup sees, so neither is emitted and
 * neither is copied — the worker URL 404s (a hard 404 on GitHub Pages, an
 * `index.html` SPA fallback under a dev/preview server), the map never starts,
 * and — because a worker that fails to load raises no MapLibre `error` event —
 * it fails silently. See `task-10-qa-report.md` C1.
 *
 * The fix is to stop letting MapLibre guess. `?worker&url` hands the worker
 * entry to Vite as a worker: Vite gives it its OWN Rollup build, which pulls
 * `maplibre-gl-shared.mjs` in with it, emits ONE self-contained file into the
 * output, and hands back its URL — so there is no sibling import left to
 * resolve. (A plain `?url` import would copy the file verbatim under a hashed
 * name, leaving its `./maplibre-gl-shared.mjs` import dangling.) Dev is covered
 * by the same import: Vite's dev server serves the worker entry itself.
 *
 * Zero-runtime-external-requests red line: the URL Vite produces is relative to
 * the emitting chunk (`base: './'` in vite.config.ts), so it is always the page's
 * own origin and always correct under the GitHub Pages subpath — the same
 * property `assetBase()` gives the glyph URLs.
 */
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

/** The bundled worker's URL, as Vite emitted it. Exported for the wiring test. */
export const MAP_WORKER_URL: string = workerUrl;

let done = false;

/**
 * Points `maplibre-gl` at the worker Vite emitted. Idempotent, and must run
 * before the first `new Map(...)` — MapLibre reads the URL when it spins up its
 * worker pool, which happens inside the Map constructor.
 */
export function configureMapWorker(): void {
  if (done) return;
  done = true;
  setWorkerUrl(MAP_WORKER_URL);
}
