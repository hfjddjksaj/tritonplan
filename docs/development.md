# Developer Guide — TritonPlan

Documentation for people working on the codebase. User-facing docs live in the
[README](../README.md).

## Repository layout

```
plan/
├── shared/         Shared TypeScript: the normalized data model + conflict/time logic
│   └── src/types.ts     The contract between extension and website
├── web/            The planner website (React + Vite, static)
│   └── src/             Calendar UI, planner state, share/export, TSS deep links
├── extension/      The Chrome/Edge MV3 extension
│   └── src/             Passive interceptor, TSS parser, background worker, popup
└── docs/           TSS reverse-engineering notes + README screenshots
```

npm workspaces monorepo (`shared`, `web`, `extension`). Both `web` and `extension` consume
`@triton/shared` directly from its TS source via bundler aliases.

## Prerequisites

Node.js ≥ 20 and npm.

## Commands

```sh
npm install                          # once, at the repo root

npm run dev -w @triton/web           # planner dev server → http://localhost:5173
npm run build -w @triton/web         # static build → web/dist (vite base './', subpath-safe)

npm run build -w @triton/extension   # PRODUCTION extension build → extension/dist
npm run build:dev -w @triton/extension  # DEV build targeting http://localhost:5173
npm run watch -w @triton/extension   # watch mode (implies --dev)

npm test                             # vitest across all workspaces
npm run typecheck                    # tsc --noEmit across all workspaces
```

### Extension dev vs production builds

The source `manifest.json` and the default build are **production-only** (planner =
`https://hfjddjksaj.github.io/tritonplan/`). A `--dev` build targets the local Vite server
instead: `build.mjs` `define`s the planner URL constants into the bundles
(`extension/src/config.ts`) and injects the `http://localhost:5173/*` matches into the
**dist** manifest only — so the store zip never contains localhost permissions or URLs.

Local dev loop: run the planner dev server, `npm run watch -w @triton/extension`, then
load `extension/dist` unpacked (`chrome://extensions` → Developer mode → Load unpacked).

## Architecture / data flow

The extension is a **pure passive observer** of TSS ("NO-BAN red line", restated in every
runtime file): it only clones OData responses the TSS page itself fetched, and never
issues, replays, retries, prefetches, or automates anything.

1. **Capture** (`extension/src/content/interceptor.ts`, MAIN world on `tss.ucsd.edu`):
   hooks the page's own `fetch`/`XHR`, `response.clone()`s OData responses, and posts
   `{url, status, body}` to the isolated-world relay (`tss-relay.ts`), which forwards it
   to the background service worker (`tp:ingest`).
2. **Store & normalize** (`background/service-worker.ts` + `lib/capture-to-courses.ts`):
   a persisted `CaptureStore` classifies each body by row shape (module rows vs section
   rows, plain JSON or multipart `$batch`), groups the denormalized Event × EventPackage
   rows into bookable `SectionOption`s, and parses SAP's `Sched` string into weekly
   meetings + an optional final (`parser/`). Paged continuations (`$skip>0`) merge into
   the held rows; a fresh browse replaces them.
3. **Inject** (`content/tss-inject.ts`): adds the "+ TritonPlan" ghost button to each
   booking-package card (UCSD's `soc*` DOM classes, verified live 2026-07-21). A click
   resolves the card to a captured `SectionOption` and queues a `tp:plan-add`.
4. **Bridge** (`content/planner-bridge.ts`, runs on the planner origin): pushes the
   captured pool (`courses`) and queued adds (`plan-add`) into the planner page via
   `window.postMessage`, targeted at the page's own origin. The page-side contract and
   validation live in `web/src/lib/bridge.ts` (same-window + same-origin checked).
   The bridge is two-way: the page can post `open-tss` / `open-booking` requests
   (source `triton-planner-page`). `open-tss` focuses the tab already showing that
   exact module (ModuleID match), else opens a new tab — other TSS tabs are never
   repurposed. `open-booking` reuses the one `#ZUSModule-display` booking tab
   (reloading it when already on the same section), else opens one. Without the
   extension the page falls back to a plain `window.open`.
5. **Plan** (`web/`): `usePlan` merges incoming courses, computes conflicts
   (`shared/src/conflicts.ts`), renders the calendar/finals views, and persists to
   `localStorage`. Sharing lz-string-compresses the whole plan into the URL hash;
   export/import is plain JSON.

The normalized model shared by both halves is `shared/src/types.ts`
(`CourseOffering → SectionOption → Component → Meeting/FinalExam`, plus `PlanState`).

### Campus map (MapLibre GL)

`web/src/components/CampusMap.tsx` is a lazy route (`lazy(() => import('./components/CampusMap'))`
in `App.tsx`) and must stay one — it pulls in MapLibre GL plus the campus GeoJSON, together
roughly 980 kB / gzip 260 kB, which nobody who never opens the map should have to download.

**No tile server.** The map is MapLibre GL rendering bundled GeoJSON, with the only raster in it
(the elevation DEM) shipped as files under `web/public/map/terrain/` — there is no tile service and
no API key. Every URL the style references (glyphs, DEM tiles, and the worker below) is built from
`assetBase()` in `map-style.ts`, which resolves relative to the page's own origin (`import.meta.env.BASE_URL`
against `document.baseURI`), so the map stays same-origin and keeps working under the GitHub
Pages subpath without knowing what that subpath is. This is the hardest constraint in the whole
feature — nothing here may ever point off-origin, and it's worth re-checking after any change to
the style or its data URLs.

**The three data scripts.** All hit the network and are run **by hand**; their output is
committed, and the app itself never fetches anything at runtime:

- `npm run fetch:campus-map -w @triton/web` — UCSD's ground surfaces (grass, paths, parking,
  sports fields, …), trees, the campus boundary and OSM park/wood/beach land use, into
  `web/src/data/ucsd-campus-map.json`; and building footprints with heights joined from UCSD's
  3D building layer, named districts, and roads/named walkways/coastline from OpenStreetMap
  (Overpass API; ODbL — the map draws the "© OpenStreetMap contributors" credit), into
  `web/src/data/ucsd-campus-geo.json`.
- `npm run fetch:buildings -w @triton/web` — building centre points, into
  `web/src/data/ucsd-buildings.json` (feeds the non-map building popover; hand overrides for
  TSS-only names live in `web/src/lib/building-aliases.ts` — extend it when an unmatched name
  shows up there).

- `npm run fetch:terrain -w @triton/web` — 58 terrarium-encoded elevation tiles (Mapzen /
  AWS Open Data, USGS-derived) at z13–14 over ~12 × 11 km around campus, into
  `web/public/map/terrain/{z}/{x}/{y}.png` (4.0 MB). They are what the hillshade layer shades
  from in 2D and what `setTerrain` lifts the ground with in 3D. z14 is the deepest level on
  purpose: a DEM is sampled, not drawn, and MapLibre overzooms its deepest level, so z15 would
  quadruple the payload for shading nobody can see. `map-terrain.test.ts` walks the box the
  style declares and fails on the first tile the script did not fetch — a gap there is a 404
  storm and a hole in the shading, not a graceful degradation. Provenance and licence:
  `web/public/map/terrain/README.md`.

The first two share Ramer–Douglas–Peucker simplification and integer/delta wire encoding
(`web/scripts/geo-encode.mjs`). Rerun the relevant script and commit when campus geometry,
ground surfaces, trees, building heights or land use change.

**Fonts — two separate pipelines, don't confuse them.**

- `web/public/map/fonts/` holds the SDF glyph PBFs MapLibre's text layers read (`Inter-Regular`
  and `Inter-SemiBold`, ranges `0-255` and `256-511`), generated by
  `npm run build:map-glyphs -w @triton/web` (`web/scripts/build-map-glyphs.mjs`) — a from-scratch
  rasterizer, since the usual native toolchain (`node-fontnik`, needs cmake/ninja) wasn't
  available in this environment. Provenance, the exact algorithm and the licence (OFL, with the
  required licence text alongside) are in `web/public/map/fonts/README.md`.
- `web/src/assets/fonts/inter-latin.woff2` is the app UI's own copy of Inter — a *different*
  build from a *different* source (Google Fonts' hosted build vs. the GitHub release TTFs),
  fetched by `npm run fetch:ui-font -w @triton/web`. Regenerating one does not regenerate or
  re-license the other; see `web/src/assets/fonts/README.md` for its own provenance note.

**The worker.** `maplibre-gl` resolves its own web worker from `import.meta.url` at runtime by
default, which Vite does not emit — this shipped a map that silently never started for the whole
of Phase 1's implementation (no console error, no MapLibre `error` event; found in browser QA,
not by the type checker or the 451 unit tests passing at the time). `web/src/lib/map-worker.ts`
instead imports the worker with Vite's `?worker&url`,
so Vite gives it its own Rollup build (bundling in its sibling `maplibre-gl-shared.mjs` rather
than leaving a dangling import) and hands back a same-origin URL; `useMapLibre` calls the
exported `configureMapWorker()` immediately before constructing the `Map`, because MapLibre reads
the worker URL inside its own constructor. `web/scripts/verify-build.mjs`, wired into
`npm run build`, checks the worker asset is actually emitted, self-contained, and referenced by
something in the built output.

That build check guards **emission, not wiring** — worth stating plainly since the map failing
here is silent. A mutation that moves the `configureMapWorker()` call to *after* `new Map(...)`
still emits and references the file, so `verify-build.mjs` and the build stay green while the map
hangs forever. What actually guards the call site is a unit test in `useMapLibre.test.tsx` that
asserts `configureMapWorker()` ran, and ran *before* the first map was constructed. Keep both
checks, and don't let the build check stand in for the unit test again.

**How the pieces fit.** `web/src/lib/campus-geo.ts` decodes the bundled, delta-encoded data;
`map-data.ts` turns it into MapLibre GeoJSON sources (`buildSources`); `map-names.ts` holds the
naming rules (district → college labels, which roads get labels, landmark list, building-name
abbreviation); `map-style.ts` is the full style plus `applyHosts` (course-colour fills on booked
buildings) and `applyMode` (the 2D ⇄ 3D swap the `3D` button drives: flat fills give way to
extrusions at real heights, flat tree circles to the billboard sprite from `tree-sprite.ts`, and
the DEM becomes real terrain). `useMapLibre` owns the `Map` instance and the camera — home fit,
zoom/pan/reset helpers, and an rAF-throttled `tick` counter.

**Two framing boxes, and they are not the same box.** `coreBounds` is what the camera opens on
(the academic core's districts, minus North Campus — its polygon is mostly canyon and playing
fields, and because a wide canvas fits that box by its HEIGHT the empty band both pushed the
camera north and forced the view wider). `mappedBounds` is every district the basemap draws, and
that is what decides whether a class counts as being *on the map* at all. Keep them separate: they
were the same box once, and every class the opening frame happened to miss was then reported to
the student as "outside the mapped area" — false about a building the map draws and a drag away,
and on a phone false about most of campus.

**`MapMarkers` is a DOM overlay, not part of the GL canvas**, and how it is positioned is
load-bearing. Each marker's dot transform is written **synchronously inside MapLibre's own
`move` event** — the same mechanism MapLibre's built-in `Marker` uses — so the overlay lands in
the frame the GL canvas paints. Driving it from the rAF-throttled `tick` instead (a React state
bump, so a re-render a frame later) is what made every pin visibly swim behind the basemap during
a drag. `tick` still drives the things that may settle a frame late without anyone seeing:
which markers exist, and which side of its dot each chip sits on. The chip is a child of its
marker and the open marker's card rides in `.campusmap__cardlayer` pinned by the same writer, so
one transform carries all three. Because the layout can be a frame behind what is drawn,
`hitMarker` takes a live projection function — a marker you can see has to be a marker you can
click.

## Reference material

- [`docs/tss-recon/tss-api-notes.md`](./tss-recon/tss-api-notes.md) — TSS/SAP OData
  reverse-engineering notes (endpoints, the `Sched` grammar, DOM selectors), with real
  captured fixtures in [`docs/tss-recon/fixtures/`](./tss-recon/fixtures/) that drive the
  parser tests.
- The planner website deploys automatically: every push to `main` runs
  [`deploy-pages.yml`](../.github/workflows/deploy-pages.yml) and publishes `web/dist`
  to GitHub Pages.
