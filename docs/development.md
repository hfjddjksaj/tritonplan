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

## Reference material

- [`docs/tss-recon/tss-api-notes.md`](./tss-recon/tss-api-notes.md) — TSS/SAP OData
  reverse-engineering notes (endpoints, the `Sched` grammar, DOM selectors), with real
  captured fixtures in [`docs/tss-recon/fixtures/`](./tss-recon/fixtures/) that drive the
  parser tests.
- The planner website deploys automatically: every push to `main` runs
  [`deploy-pages.yml`](../.github/workflows/deploy-pages.yml) and publishes `web/dist`
  to GitHub Pages.
