# Per-plan browsed list + a scannable QR — design (2026-08-09, user-approved)

Two unrelated small fixes, shipped as one round. Both are web-only.

---

## Part 1 — the browsed list belongs to each plan

### The problem

Creating a second plan gives you a browsed list that is not really yours: removing
a course there removes it everywhere, because the pool is global **and** the
removal tells the extension to forget the capture outright.

### What stays global

The pool itself. It is the record of what you actually browsed in TSS, and a new
plan should start able to see all of it — otherwise building an alternative
schedule means re-browsing every course in TSS.

### What becomes per-plan

A `hidden` list on each plan: the courses that plan doesn't want to see.

`NamedPlan` gains `hidden?: string[]` (course ids). Optional — absent means
nothing hidden, so existing stored data needs no migration step and no user sees
their list change on upgrade.

It lives on `NamedPlan`, **not** inside `PlanState`. `PlanState` is the unit that
gets shared: it goes into share links, QR codes and JSON. A list-display
preference is local to this browser and must not travel to whoever opens your
link — they have their own browsing history.

### Behaviour

The browsed list renders: **global pool − courses already in the active plan −
the active plan's `hidden`**.

- `×` on a row → add that course id to the active plan's `hidden`. It never comes
  back in this plan, across reloads, even though the extension keeps pushing it.
- `Clear all` → add every currently-visible browsed course to the active plan's
  `hidden`. Same scope: this plan only.
- Switching plans → the other plan's `hidden` applies; a course hidden in plan A
  is still listed in plan B.
- New plan → no `hidden`, so the full browsed list is available immediately.
- Duplicated plan → `hidden` is copied with it (a copy should look like its
  original).
- Adding a course to the plan already behaves per-plan and is unchanged.

### The extension's forget path is dropped from the web side

`removeFromPool` and `clearBrowsed` currently call `postForgetCourses`, which
tells the extension to delete the capture from its store. That is global by
nature and directly contradicts per-plan independence.

`postForgetCourses` is removed from `web/src/lib/bridge.ts` along with its call
sites and its tests — leaving an uncalled function behind is dead code. The
extension side (`MSG.FORGET_COURSES`, the service worker handler,
`CaptureStore.forgetModules`) is **left untouched**: the protocol still works,
restoring the call later is a few lines, and v1.0.2 is already packaged.

The user requirement it originally served — "deleted courses must not come back
after a reload" — is still met, now by `hidden` being persisted per plan.

---

## Part 2 — a QR code that actually scans

### The problem, measured

`ShareMenu` renders the QR inside the dropdown. The menu is 272px wide; after the
menu, wrapper and box padding the SVG gets about **224px**.

Module counts for this planner's share URLs (`qrcode-generator`, EC level L):

| URL length | modules | px/module at 224px | px needed for 3px/module |
|---|---|---|---|
| 543 | 81 | 2.77 | 243 |
| 1043 | 109 | 2.06 | 327 |
| 1548 | 133 | **1.68** | 399 |
| 2043 | 149 | 1.50 | 447 |
| 2943 | 177 | 1.27 | 531 |

A realistic 4-course plan lands at 133 modules and **1.68 px per module** — below
what a phone camera can resolve, and worse than the number suggests because 1.68
is not an integer: every module edge falls mid-pixel and gets antialiased to grey.

Separately, `qrSvg` generates with `margin: 2`. The QR spec requires a quiet zone
of **4 modules**; too little of it and a scanner cannot lock onto the finder
patterns at all.

### The fix

**Move the QR out of the dropdown into a centered modal.** Reuse the existing
portal-to-body modal shell that `BuildingPopover` and `PrereqPopover` already use
(a course card ancestor forms a fixed containing block — rendering inside the
menu is what constrains the size in the first place). The menu item becomes
"QR code" that opens the modal.

**Size it in whole pixels per module.** `qrSvg` also returns the module count.
The modal computes `scale = max(2, floor(availableWidth / moduleCount))` and sets
the SVG to exactly `moduleCount * scale` pixels. Every module then occupies a
whole number of device-independent pixels, so edges stay hard instead of grey.
Available width: `min(90vw, 560px)`, which gives 133 modules 4px each and even a
worst-case 177-module code 3px — against 1.27 today.

**Quiet zone to 4 modules**, per spec.

**Pick the shorter of the two formats.** Today the QR takes Full and falls back
to Lite only when Full exceeds budget. In practice Full is often *shorter* than
Lite (deflate crushes the repeated structure), and fewer bytes means a lower
version, means bigger modules. `qrShareForPlan` picks whichever of the two
actually fits in fewer characters, still preferring the requested format when
they tie, and still reports which one the code carries so the existing "this code
carries the Lite version" note stays accurate.

The "plan too large for any QR" case keeps its current message.

### Out of scope

- Changing the share formats themselves, or shortening the planner URL.
- Raising the error-correction level: higher EC means less data capacity, a
  higher version and *smaller* modules — the wrong direction here.
- Downloading or copying the QR as an image.

---

## Testing

- `plans.test.ts` — hiding on the active plan only; a hidden course still listed
  under another plan; duplicate carries `hidden`; migration of stored data with
  no `hidden` key; new plan starts with nothing hidden.
- `qr.test.ts` — module count is returned and matches the generator; the shorter
  format wins; the scale computation yields whole numbers and never drops below
  2; the too-large case still returns null.
- `bridge.test.ts` — the `postForgetCourses` tests are deleted with the function.
- Puppeteer: two plans side by side — hide a course in one, confirm it is gone
  there and present in the other, and still gone after a reload. Then open the QR
  modal on a realistic plan, measure the rendered SVG's pixel width against its
  module count, and confirm the ratio is a whole number ≥ 3 on desktop.

## Release

Web only, no extension release. Ships on the next push to `main` after the local
dev-server walkthrough.
