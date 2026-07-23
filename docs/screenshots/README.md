# Screenshots

Marketing/store screenshots for TritonPlan. Referenced from the root `README.md` /
`README.zh-CN.md` and used in the Chrome Web Store listing.

All shots use a staged demo plan (5 realistic Fall 2026 courses; CSE-008A is real
captured TSS data) with a deliberate Wed 11:00 time conflict (CSE-008A lab × HUM-1
lecture) and a deliberate finals overlap (CSE-008A × MATH-20A, both 12/09 11:30 AM).
To re-shoot: regenerate the share URL with the scripts noted below, open it in a
fresh browser context, and capture at deviceScaleFactor 2.

Current shots:

- `calendar.png` (3360×2240 @2x) — weekly calendar, conflict banner + red Wed pair.
- `finals.png` (3360×2850 @2x) — Finals list with flagged 12/09 overlap + finals-week glance calendar (incl. Saturday final).
- `building-popover.png` (3360×2240 @2x) — building location popover (Pepper Canyon Hall) with Google Maps / campus-map links.
- `section-switch.gif` (1120×746) — 3-frame demo: conflict → open section options → switch to the 12:00 lab, conflict clears.
- `store/calendar-1280x800.png`, `store/finals-1280x800.png` — Chrome Web Store size (must be exactly **1280×800** or **640×400**, see `docs/deployment.md`).

- `tss-button.png` (1360×246 @1x) — a real TSS section card (CSE-008A, logged-in
  session, Class Sections in fullscreen layout) with the injected "+ TritonPlan"
  button next to the native Limit/Available/Booking chips. Cropped to exclude any
  personal info. Source was a 1440-wide extension screenshot (JPEG), so this one
  is 1x — re-shoot on a larger window if a crisper version is ever needed.

Demo-plan generator + GIF assembly scripts live in `docs/tools/`
(`make-demo-plan.mjs` regenerates the share URL; `make-gif.mjs` + `crop-top.mjs`
need `gifenc` and `pngjs` installed ad hoc — they are deliberately not repo deps).
