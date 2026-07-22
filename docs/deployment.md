# Deployment & Publishing — TritonPlan

## Cross-platform / cross-browser (settled)
- The extension is pure web tech (MV3): **one package runs identically on Windows, macOS, Linux, ChromeOS** — no per-OS build.
- **Targets: Chrome + Edge (Chromium).** One package covers both (Edge Add-ons store can reuse the same zip). Firefox (AMO, minor MV3 diffs) and Safari (Xcode `safari-web-extension-converter` + App Store) are optional later targets — NOT in scope now.
- The planner website is a static site — any OS/browser.

## Planner website hosting (settled): GitHub Pages
- Deploy the static build of `web/dist` to **GitHub Pages**. `vite.config.ts` already uses `base: './'` for subpath hosting.
- **Production URL (settled): `https://hfjddjksaj.github.io/tritonplan/`** — GitHub user `hfjddjksaj`, repo `tritonplan`. This is baked into `extension/src/config.ts` (`PLANNER_URL`/`PLANNER_MATCH`) and `extension/manifest.json` (planner-bridge `matches` + `host_permissions`).
- **Dev vs prod builds:** the source manifest and default `npm run build` are production-only. For local work, `npm run watch -w @triton/extension` (or `node build.mjs --dev`) targets `http://localhost:5173` instead — build.mjs `define`s the planner URL into the bundles and injects the localhost matches into the dist manifest, so the store zip never carries localhost permissions or URLs.

## Ordering dependency (important)
Deploy the website → set the real domain in the extension → build/zip the extension → upload to the store. The extension can't be finalized for the store until the planner has a real URL.

## GitHub (settled: PUBLIC repo)
1. `git init`; add `.gitignore` (node_modules, dist, .DS_Store, etc.); first commit.
2. Create the public GitHub repo — either `gh repo create` (needs `gh` installed + `gh auth login`; `gh` appears NOT installed on this machine) or create it on github.com and `git remote add origin <url>`.
3. `git push -u origin main`.
4. Enable GitHub Pages (Settings → Pages → deploy from branch, or a Pages action building `web/dist`).
- ⚠ Pushing is outward-facing — do only with the user's explicit go-ahead. Prefer a GitHub Actions workflow that builds `web/` and publishes `dist` to Pages on push.

## Chrome Web Store (PUBLISHED)
- **Live listing:** https://chromewebstore.google.com/detail/tritonplan/lnchlccmjhhpbbemlfnpldooeehcmjel (v0.1.0)
- Publishing an update: bump `"version"` in `extension/manifest.json` (the store rejects re-uploads of the same version), rebuild, zip `extension/dist`, upload as a new version on the existing item.
- **Account email:** duzijue@gmail.com · **Publisher ID:** `56dcf09c-ed7d-4c5f-8b2e-be4dd35e67f7`
- Steps:
  1. `npm run build -w @triton/extension` → `extension/dist` (manifest at root).
  2. Zip `extension/dist` (manifest.json at the zip root).
  3. Developer Dashboard → **New item** → upload zip.
  4. Fill listing: name **TritonPlan**, summary/description, category (Productivity/Education), **128/48/16 icons**, **screenshots** (1280×800 or 640×400), **privacy policy URL**, permission justifications, and data-use disclosures.
  5. Submit for review (typically a few days).
- **Permission justification** (single-purpose): visualize the student's OWN TSS course data on a weekly calendar. `storage` = save the plan locally; `tabs` = open/focus the planner tab; host access to `tss.ucsd.edu` = passively read the course data already shown to the logged-in student; host access to the planner domain = deliver that data to the planner page. **No data leaves the device** (local-only; no collection) → the privacy policy is simple.

## Who does what
- **Claude can prepare (no account needed):** `.gitignore`, GitHub Actions Pages workflow, 16/48/128 icons, store listing copy, **privacy policy** (local-only, zero collection), bilingual README install docs, and the production extension build with the real planner domain baked in.
- **User must do (account/2FA/legal):** `gh auth login` or create the GitHub repo; approve/trigger the push; Chrome Web Store dashboard login, upload, and the final **Submit for review**; any custom-domain/DNS.

## Notes
- The Publisher ID is an account identifier, not a secret. Account login, 2FA, and any CWS API refresh token stay with the user and are NOT stored in the repo.
