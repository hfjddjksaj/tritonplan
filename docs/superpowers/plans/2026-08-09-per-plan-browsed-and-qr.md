# Per-plan Browsed List + Scannable QR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each plan's browsed list its own (hiding a course in one plan leaves the others alone), and make the share QR big and crisp enough that a phone can actually scan it.

**Architecture:** The browsed pool stays global; each `NamedPlan` gains a `hidden` id list that filters what that plan's browsed list shows. The QR moves out of the 272px dropdown into a centered modal sized to a whole number of pixels per module.

**Tech Stack:** React 18 + TypeScript + Vite, Vitest, `qrcode-generator`, plain CSS with tokens in `web/src/styles/tokens.css`.

## Global Constraints

- Web workspace only. Do NOT touch `extension/` or `shared/` — no extension release comes out of this work.
- `hidden` lives on `NamedPlan`, never inside `PlanState`. `PlanState` is what share links, QR codes and JSON exports carry; a local list preference must not travel to whoever opens your link.
- `hidden` is optional. Absent means nothing hidden, so stored data from before this change needs no migration and no user's list changes on upgrade.
- The QR modal's code area stays black-on-white regardless of theme — scanners need the quiet zone to actually be light.
- QR error-correction level stays `'L'`. Raising it means less capacity, a higher version and *smaller* modules — the wrong direction.
- User-facing copy stays English.
- Spec: `docs/superpowers/specs/2026-08-09-per-plan-browsed-and-qr-design.md`.

Run all commands from the repo root `G:\vc\plan`.

---

### Task 1: `hidden` on NamedPlan

**Files:**
- Modify: `web/src/lib/plans.ts` (`NamedPlan` ~line 13, `duplicatePlan` ~line 138)
- Test: `web/src/lib/plans.test.ts`

**Interfaces:**
- Produces: `NamedPlan.hidden?: string[]`; `activeHidden(state: PlansState): ReadonlySet<string>`; `hideInActivePlan(state: PlansState, ids: string[], now: string): PlansState`. Task 2 consumes all three.

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/plans.test.ts` (check the existing imports at the top and add `activeHidden` / `hideInActivePlan` to the import from `./plans`):

```ts
describe('per-plan hidden browsed courses', () => {
  /** Two plans, the first active. */
  function twoPlans(): PlansState {
    const base = migratePlans(null, null, '2026-08-09T00:00:00.000Z');
    return createPlan(base, '2026-08-09T00:01:00.000Z', 'Plan B');
  }

  it('starts with nothing hidden', () => {
    expect(activeHidden(migratePlans(null, null, 'now')).size).toBe(0);
  });

  it('hides only in the active plan', () => {
    const two = twoPlans(); // active is "Plan B"
    const next = hideInActivePlan(two, ['CSE-008A|2026|2'], 'now');
    expect(activeHidden(next).has('CSE-008A|2026|2')).toBe(true);
    // …and the other plan is untouched
    const other = next.plans.find((p) => p.id !== next.activeId)!;
    expect(other.hidden ?? []).toEqual([]);
  });

  it('accumulates without duplicating', () => {
    let s = migratePlans(null, null, 'now');
    s = hideInActivePlan(s, ['A'], 'now');
    s = hideInActivePlan(s, ['A', 'B'], 'now');
    expect([...activeHidden(s)].sort()).toEqual(['A', 'B']);
  });

  it('is a no-op that preserves identity when nothing new is hidden', () => {
    const s = hideInActivePlan(migratePlans(null, null, 'now'), ['A'], 'now');
    expect(hideInActivePlan(s, ['A'], 'later')).toBe(s);
    expect(hideInActivePlan(s, [], 'later')).toBe(s);
  });

  it('follows the active plan when you switch', () => {
    const two = twoPlans();
    const hidden = hideInActivePlan(two, ['X'], 'now');
    const back = switchActive(hidden, hidden.plans[0]!.id);
    expect(activeHidden(back).size).toBe(0);
  });

  it('carries hidden into a duplicated plan', () => {
    // duplicatePlan hand-builds the NamedPlan — hidden does not come along for free.
    const s = hideInActivePlan(migratePlans(null, null, 'now'), ['X'], 'now');
    const dup = duplicatePlan(s, s.activeId, 'now');
    expect(activeHidden(dup).has('X')).toBe(true);
    // …as a copy, not the same array
    const source = dup.plans.find((p) => p.id !== dup.activeId)!;
    const copy = dup.plans.find((p) => p.id === dup.activeId)!;
    expect(copy.hidden).not.toBe(source.hidden);
  });

  it('treats stored data with no hidden key as nothing hidden', () => {
    const stored = migratePlans(null, null, 'now');
    expect(stored.plans[0]!.hidden).toBeUndefined();
    expect(activeHidden(stored).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run plans --root web`
Expected: FAIL — `activeHidden is not a function`.

- [ ] **Step 3: Add the field**

In `web/src/lib/plans.ts`, inside `interface NamedPlan`, after `updatedAt: string;`:

```ts
  /**
   * Browsed courses this plan does not want listed (course ids). Absent means
   * nothing hidden. Deliberately on NamedPlan and not inside PlanState: share
   * links, QR codes and JSON exports carry PlanState, and this is a local
   * list preference, not part of the schedule.
   */
  hidden?: string[];
```

- [ ] **Step 4: Add the two functions**

In `web/src/lib/plans.ts`, after `updateActivePlan`:

```ts
/** Course ids the active plan hides from its browsed list. */
export function activeHidden(state: PlansState): ReadonlySet<string> {
  return new Set(activePlan(state).hidden ?? []);
}

/** Hide course ids in the ACTIVE plan only; same state back when nothing is new. */
export function hideInActivePlan(state: PlansState, ids: string[], now: string): PlansState {
  if (ids.length === 0) return state;
  const current = activePlan(state);
  const before = current.hidden ?? [];
  const next = [...new Set([...before, ...ids])];
  if (next.length === before.length) return state;
  return {
    ...state,
    plans: state.plans.map((p) => (p.id === current.id ? { ...p, hidden: next, updatedAt: now } : p)),
  };
}
```

- [ ] **Step 5: Carry `hidden` through duplicate**

`duplicatePlan` hand-builds its `NamedPlan`, so the field is dropped unless added. In `web/src/lib/plans.ts`, inside the `copy` object literal (after the `plan:` line):

```ts
    ...(source.hidden ? { hidden: [...source.hidden] } : {}),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run plans --root web && npm run typecheck`
Expected: all plans tests PASS (7 new), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/plans.ts web/src/lib/plans.test.ts
git commit -m "feat(web): give each plan its own hidden-browsed list"
```

---

### Task 2: Wire hiding into the browsed list

**Files:**
- Modify: `web/src/hooks/usePlan.ts` (`removeFromPool` ~line 309, `clearBrowsed` ~line 319, `browsedNotAdded` ~line 397, the `plans.ts` import block ~line 31)
- Modify: `web/src/lib/bridge.ts` (delete `postForgetCourses`)
- Modify: `web/src/lib/bridge.test.ts` (delete its tests)

**Interfaces:**
- Consumes: `activeHidden`, `hideInActivePlan` from Task 1.
- Produces: no signature changes — `ctl.removeFromPool(courseId)` and `ctl.clearBrowsed()` keep their shapes, only their meaning narrows to the active plan.

- [ ] **Step 1: Rewrite the two removal actions**

In `web/src/hooks/usePlan.ts`, add `activeHidden` and `hideInActivePlan` to the existing import from `../lib/plans`, and drop `postForgetCourses` from the `../lib/bridge` import.

Replace `removeFromPool` and `clearBrowsed` with:

```tsx
  /**
   * Drop a browsed course from THIS plan's list. The pool itself is the global
   * record of what you browsed in TSS and is left alone — another plan still
   * lists the course. Plan entries keep their own course copy, so an added
   * course is unaffected either way.
   */
  const removeFromPool = useCallback((courseId: string) => {
    setPlansState((s) => hideInActivePlan(s, [courseId], new Date().toISOString()));
  }, []);

  /** Hide every browsed course that isn't in the plan — this plan only. */
  const clearBrowsed = useCallback(() => {
    const added = new Set(plan.entries.map((e) => e.course.id));
    const ids = pool.filter((c) => !added.has(c.id)).map((c) => c.id);
    setPlansState((s) => hideInActivePlan(s, ids, new Date().toISOString()));
  }, [plan, pool]);
```

- [ ] **Step 2: Filter the browsed list by the active plan's hidden set**

Still in `usePlan.ts`, the `browsedNotAdded` memo currently reads:

```tsx
    return pool.filter((c) => !added.has(c.id));
```

Change that memo's body to also drop hidden courses, and add `plansState` to its dependency array:

```tsx
    const hidden = activeHidden(plansState);
    return pool.filter((c) => !added.has(c.id) && !hidden.has(c.id));
```

- [ ] **Step 3: Delete the extension forget path from the web side**

In `web/src/lib/bridge.ts`, delete the whole `postForgetCourses` function and its doc comment. Do NOT touch anything under `extension/` — the message, the service-worker handler and `CaptureStore.forgetModules` all stay.

In `web/src/lib/bridge.test.ts`, delete the tests that exercise `postForgetCourses` and remove it from that file's import list.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test -w @triton/web`
Expected: typecheck clean; all web tests pass. If typecheck reports `postForgetCourses` still imported somewhere, remove that import too — no caller should remain.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/usePlan.ts web/src/lib/bridge.ts web/src/lib/bridge.test.ts
git commit -m "feat(web): scope browsed removal to the active plan"
```

---

### Task 3: QR generation — module count, quiet zone, shorter format

**Files:**
- Modify: `web/src/lib/qr.ts`
- Test: `web/src/lib/qr.test.ts`

**Interfaces:**
- Produces: `qrSvg(url: string): { svg: string; moduleCount: number }` (**changed** from returning a plain string) and `qrScale(moduleCount: number, available: number): number`. `qrShareForPlan(plan, requested)` keeps its signature and `QrShare` shape.

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/qr.test.ts` (add `qrSvg`, `qrScale` to the import from `./qr`):

```ts
describe('qr rendering inputs', () => {
  it('reports the module count alongside the markup', () => {
    const out = qrSvg('https://plan.example/#p=abc');
    expect(out.svg.startsWith('<svg')).toBe(true);
    // Smallest QR is 21x21; anything real is bigger and always odd-sized.
    expect(out.moduleCount).toBeGreaterThanOrEqual(21);
  });

  it('grows the module count with the payload', () => {
    const small = qrSvg('https://plan.example/#p=' + 'x'.repeat(100)).moduleCount;
    const big = qrSvg('https://plan.example/#p=' + 'x'.repeat(1500)).moduleCount;
    expect(big).toBeGreaterThan(small);
  });

  it('carries a 4-module quiet zone, as the spec requires', () => {
    // createSvgTag emits viewBox "0 0 <total> <total>" where total = modules + 2*margin.
    const { svg, moduleCount } = qrSvg('https://plan.example/#p=abc');
    const box = /viewBox="0 0 (\d+) \1"/.exec(svg);
    expect(box).not.toBeNull();
    expect(Number(box![1]) - moduleCount).toBe(8);
  });
});

describe('qrScale', () => {
  it('gives whole pixels per module', () => {
    expect(qrScale(133, 820)).toBe(6);
    expect(qrScale(177, 820)).toBe(4);
    expect(qrScale(81, 820)).toBe(10);
  });

  it('never drops below 2, even when the viewport is tiny', () => {
    expect(qrScale(177, 200)).toBe(2);
  });
});
```

Also append, to the existing format-choice describe block:

```ts
  it('carries whichever format is actually shorter', () => {
    // Full (deflate) often beats Lite on real plans; fewer bytes = lower version
    // = bigger modules, so the QR should take the shorter one either way.
    const plan = planWithCourses(4);
    const full = shareUrl(plan, 'full');
    const lite = shareUrl(plan, 'lite');
    const picked = qrShareForPlan(plan, 'full')!;
    expect(picked.url.length).toBe(Math.min(full.length, lite.length));
    expect(picked.mode).toBe(full.length <= lite.length ? 'full' : 'lite');
  });
```

Check `qr.test.ts` for the helper that builds a multi-course plan (the file already has one for the degrade-to-lite test) and use that name in place of `planWithCourses(4)`; if it takes different arguments, match them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run qr --root web`
Expected: FAIL — `out.svg` undefined (qrSvg still returns a string) and `qrScale is not a function`.

- [ ] **Step 3: Rewrite qr.ts**

Replace the bodies of `qrShareForPlan` and `qrSvg` in `web/src/lib/qr.ts`, and add `qrScale`:

```ts
/**
 * Pick the link that makes the easiest-to-scan code: whichever of the two
 * formats is shorter and fits, preferring the requested one on a tie. Fewer
 * characters means a lower QR version, which means larger modules.
 */
export function qrShareForPlan(plan: PlanState, requested: ShareFormat): QrShare | null {
  const candidates: QrShare[] = [
    { url: shareUrl(plan, 'full'), mode: 'full' },
    { url: shareUrl(plan, 'lite'), mode: 'lite' },
  ].filter((c) => c.url.length <= QR_URL_BUDGET);
  if (candidates.length === 0) return null;
  const shortest = Math.min(...candidates.map((c) => c.url.length));
  const best = candidates.filter((c) => c.url.length === shortest);
  return best.find((c) => c.mode === requested) ?? best[0]!;
}

/**
 * Scalable SVG for a URL, plus the module count the caller needs to size it in
 * whole pixels. `margin: 4` is the quiet zone the QR spec requires — with less,
 * a scanner cannot lock onto the finder patterns.
 */
export function qrSvg(url: string): { svg: string; moduleCount: number } {
  const qr = qrcode(0, 'L'); // typeNumber 0 = auto-size
  qr.addData(url);
  qr.make();
  return {
    svg: qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true }),
    moduleCount: qr.getModuleCount(),
  };
}

/**
 * Whole pixels per module that fit in `available`. A fractional scale puts
 * module edges mid-pixel, where antialiasing greys them out and the camera
 * stops resolving them — so this floors, and never goes below 2.
 */
export function qrScale(moduleCount: number, available: number): number {
  return Math.max(2, Math.floor(available / moduleCount));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run qr --root web`
Expected: PASS. The existing `ShareMenu` still consumes the old string return and will fail typecheck — Task 4 fixes that; do not patch `ShareMenu` here.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/qr.ts web/src/lib/qr.test.ts
git commit -m "feat(web): report QR module count, widen the quiet zone, pick the shorter link"
```

---

### Task 4: The QR modal

**Files:**
- Create: `web/src/components/QrPopover.tsx`
- Modify: `web/src/components/ShareMenu.tsx`
- Modify: `web/src/styles/app.css` (new `.qrpop*` rules near `.mappop`, ~line 1543; delete `.menu__qr`, `.menu__qr-box` and `.menu__qr-box svg`, ~line 1033)

**Interfaces:**
- Consumes: `qrShareForPlan`, `qrSvg`, `qrScale` from Task 3; the `.mappop__backdrop` / `.mappop__close` classes already in `app.css`.
- Produces: `<QrPopover plan={plan} format={format} onClose={() => void} />`.

- [ ] **Step 1: Write the component**

Create `web/src/components/QrPopover.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PlanState } from '@triton/shared';
import { qrShareForPlan, qrSvg, qrScale } from '../lib/qr';
import type { ShareFormat } from '../lib/share';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { X } from './icons';

/** Widest the code is allowed to get; past this, bigger stops buying clarity. */
const MAX_PX = 820;

/** Room for the code: bounded by width on a phone, by height on a short screen. */
function availablePx(): number {
  return Math.min(window.innerWidth * 0.92, window.innerHeight * 0.78, MAX_PX);
}

interface Props {
  plan: PlanState;
  format: ShareFormat;
  onClose: () => void;
}

/**
 * Full-size share QR. It lives in a centered modal rather than in the Share
 * dropdown because the dropdown is 272px wide — a realistic plan is ~133 modules,
 * which came out at 1.68px per module there and would not scan.
 *
 * Portaled to <body>: the topbar is a positioned ancestor, and a fixed overlay
 * inside it would be constrained by it.
 */
export function QrPopover({ plan, format, onClose }: Props) {
  useEscapeKey(onClose);
  const [available, setAvailable] = useState(availablePx);
  useEffect(() => {
    const onResize = () => setAvailable(availablePx());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const qr = useMemo(() => qrShareForPlan(plan, format), [plan, format]);
  const code = useMemo(() => (qr ? qrSvg(qr.url) : null), [qr]);
  const sizePx = code ? code.moduleCount * qrScale(code.moduleCount, available) : 0;

  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop qrpop"
        role="dialog"
        aria-modal="true"
        aria-label="Share this plan by QR code"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
        <div className="eyebrow">Scan to open this plan</div>
        {code ? (
          <>
            {/* qrSvg output is generated locally by qrcode-generator — trusted markup */}
            <div
              className="qrpop__code"
              style={{ width: sizePx, height: sizePx }}
              dangerouslySetInnerHTML={{ __html: code.svg }}
            />
            {qr!.mode === 'lite' && format === 'full' && (
              <p className="qrpop__note">
                Plan too large for a full QR — this code carries the Lite version. Use Copy link to
                send everything.
              </p>
            )}
          </>
        ) : (
          <p className="qrpop__note">
            This plan is too large for a QR code — use Copy link instead.
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Add the styles**

In `web/src/styles/app.css`, immediately after the `.mappop { ... }` rule:

```css
/* The share QR needs far more room than a normal popover: a realistic plan is
   ~133 modules, and anything under ~3 device pixels per module stops scanning.
   Width is set inline from the module count so every module lands on whole
   pixels — the box just centers it. */
.qrpop {
  width: auto;
  max-width: min(92vw, 860px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.qrpop__code {
  /* White stays white in every theme — scanners need the quiet zone light. */
  background: #fff;
  border-radius: var(--r-sm);
  overflow: hidden;
}
.qrpop__code svg {
  display: block;
  width: 100%;
  height: 100%;
}
.qrpop__note {
  margin: 0;
  max-width: 44ch;
  text-align: center;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--gold-ink);
}
```

Then delete the now-unused `.menu__qr`, `.menu__qr-box` and `.menu__qr-box svg` rules (~line 1033). Keep `.menu__qr-note` only if something still uses it after Step 3 — if not, delete it too.

- [ ] **Step 3: Point ShareMenu at the modal**

In `web/src/components/ShareMenu.tsx`:
- Import `QrPopover` and drop the now-unused `qrShareForPlan` / `qrSvg` imports along with the `qr` and `qrMarkup` memos.
- Keep the `qrOpen` state; the "QR code" menu item toggles it as before.
- Delete the whole `{qrOpen && (qr ? ... : ...)}` block that rendered the inline code and its notes.
- Render `{qrOpen && <QrPopover plan={plan} format={format} onClose={() => setQrOpen(false)} />}` as the last child of the component's root element, outside the menu's `<div>`, so closing the menu does not unmount it mid-render.
- The existing handler that closes the menu on click-away must not fire while the modal is open — verify by opening the modal and clicking inside it; if the menu closes and takes the modal with it, hoist `qrOpen` handling so the modal survives (the modal is portaled, so a click inside it does not bubble to the menu's click-away listener; only fix this if you actually observe the problem).

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test -w @triton/web && npm run build -w @triton/web`
Expected: all clean. Typecheck is what catches any leftover use of the old string-returning `qrSvg`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/QrPopover.tsx web/src/components/ShareMenu.tsx web/src/styles/app.css
git commit -m "feat(web): show the share QR full size in a modal"
```

---

### Task 5: End-to-end verification

**Files:**
- Create: `<scratchpad>/browsed-qr-e2e.js` (scratchpad, not the repo)
- Modify: `PROGRESS.md`

- [ ] **Step 1: Check the dev server**

A dev server may already be running at http://localhost:5173/. Check first (`curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/`); start `npm run dev -w @triton/web` only if it is not up.

- [ ] **Step 2: Write the E2E script**

`puppeteer-core` is installed in the session scratchpad; Chrome is at `C:/Program Files/Google/Chrome/Application/chrome.exe`. Model the script on the existing ones in that directory (they add courses through the UI, then rewrite `localStorage` and reload).

Assertions, all of which must be real — fix the source, never the assertion, if one fails:

```js
// Part 1 — per-plan browsed list
// 1. Dev build seeds 3 sample courses into the browsed pool. Count the rows.
// 2. Click the × on the first browsed row. Assert the row count drops by 1.
// 3. Reload. Assert it is STILL gone (this is the "deleted, then it came back" bug).
// 4. Create a new plan via the plan switcher. Assert the new plan's browsed list
//    shows ALL the original courses, including the one hidden in plan 1.
// 5. Switch back to plan 1. Assert the hidden course is still absent there.
// 6. Duplicate plan 1. Assert the copy also hides it.

// Part 2 — QR
// 7. Add enough courses that the share URL is ~1000+ chars, open Share ▾ → QR code.
// 8. Assert a .qrpop is in the DOM and .menu__qr-box is NOT (it moved out of the menu).
// 9. Read the rendered code's box width and the SVG viewBox. Derive
//    moduleCount = viewBox - 8 (the 4-module quiet zone on each side), then
//    assert width / moduleCount is a WHOLE number and >= 5 at 1440x900.
// 10. Assert the code box's computed background-color is white.
// 11. Resize to 1366x768, reopen, assert ratio is a whole number >= 3 AND that
//     document.documentElement.scrollHeight <= window.innerHeight (no overflow).
```

- [ ] **Step 3: Run it and read the screenshots**

Run the script; capture a screenshot of the QR modal at 1440×900 and at 1366×768, and read both with the Read tool. Confirm by eye that the code looks crisp (hard black edges, no grey fringing) and the modal fits on screen.

- [ ] **Step 4: Scan check**

The point of this task is a code that scans. Report the measured px-per-module for a realistic plan so the user can judge, and say plainly that an actual phone scan is the one check only they can perform.

- [ ] **Step 5: Full gate**

Run: `npm run typecheck && npm test && npm run build -w @triton/web`
Expected: typecheck clean, all workspaces' tests pass, build succeeds.

- [ ] **Step 6: Update PROGRESS.md**

Add a dated section at the top of the entries (below the header block) in Chinese, matching the file's style: the per-plan `hidden` model and why it sits on `NamedPlan`; that the web side no longer calls `postForgetCourses` (extension side untouched, v1.0.2 unaffected); the QR numbers before and after (1.68 px/module at 224px → the measured value); test counts; web-only, no extension release.

- [ ] **Step 7: Commit and hand back**

```bash
git add PROGRESS.md
git commit -m "docs: record the per-plan browsed + QR round"
```

`PROGRESS.md` is gitignored, so this commit may be empty — expected; skip it if git reports nothing to commit. Leave the dev server running and tell the user to look at http://localhost:5173/ before anything is pushed. Do NOT push.

---

## Self-Review

**Spec coverage:** pool stays global + `hidden` on `NamedPlan` (Task 1); hide/clear scoped to active plan, new plan sees everything, browsed filter (Task 2); `postForgetCourses` deleted web-side, extension untouched (Task 2 Step 3); duplicate carries `hidden` (Task 1 Step 5); migration-free optional field (Task 1 Step 3 + test); QR module count, 4-module quiet zone, shorter-format pick (Task 3); centered modal, whole-pixel sizing, `min(92vw, 78vh, 820px)`, white background (Task 4); the measurement assertions (Task 5). Out-of-scope items (share formats, URL shortening, EC level, QR download) have no task, by design.

**Type consistency:** `hidden?: string[]` on `NamedPlan`; `activeHidden(state) → ReadonlySet<string>`; `hideInActivePlan(state, ids, now) → PlansState`; `qrSvg(url) → { svg, moduleCount }`; `qrScale(moduleCount, available) → number`; `QrPopover` props `{ plan, format, onClose }`; classes `.qrpop`, `.qrpop__code`, `.qrpop__note`.
