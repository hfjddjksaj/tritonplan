# Full (no-seat) Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grey out sections that have no seats left — in the section list, on the course card when the whole course is full, and on every calendar block.

**Architecture:** One pure rule in a new `web/src/lib/seats.ts` decides "is this full". `lib/plan.ts` stamps a `full: boolean` onto the flattened instances the calendars already render from, so no component recomputes anything. Everything else is CSS driven by one class per layer.

**Tech Stack:** React 18 + TypeScript + Vite, Vitest, plain CSS with design tokens in `web/src/styles/tokens.css`.

## Global Constraints

- Web workspace only. Do **not** touch `extension/` or `shared/` — no extension release comes out of this work.
- `seatsAvailable === undefined` is **never** full. Unknown ≠ zero.
- A course is full only when it has ≥1 option and **every** option is full.
- Conflict styling always wins over grey: a block that is both full and conflicting must still read as conflicting.
- Grey uses existing tokens (`--text-faint`, `--line`, `--line-strong`, `--surface-2`). No new hex values — the tokens carry theming.
- User-facing copy stays English. The badge word is exactly `Full`.
- Spec: `docs/superpowers/specs/2026-08-09-full-sections-design.md`.

Run all commands from the repo root `G:\vc\plan`.

---

### Task 1: The `full` rule

**Files:**
- Create: `web/src/lib/seats.ts`
- Test: `web/src/lib/seats.test.ts`

**Interfaces:**
- Consumes: `SectionOption`, `CourseOffering` from `@triton/shared`.
- Produces: `optionFull(option: SectionOption): boolean`, `courseFull(course: CourseOffering): boolean`. Every later task imports from `../lib/seats`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/seats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { CourseOffering, SectionOption } from '@triton/shared';
import { optionFull, courseFull } from './seats';

/** A section option carrying only what the seat rule looks at. */
function opt(seatsAvailable?: number): SectionOption {
  return {
    id: 'SE1',
    code: 'P-001-001',
    enrollCode: 'SE1',
    components: [],
    ...(seatsAvailable === undefined ? {} : { seatsAvailable }),
  };
}

function course(...options: SectionOption[]): CourseOffering {
  return {
    id: 'CSE-008A|2026|2',
    moduleId: '8461',
    subject: 'CSE',
    number: '008A',
    courseCode: 'CSE-008A',
    title: 'Introduction to Programming',
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    options,
  };
}

describe('optionFull', () => {
  it('is full at zero seats and below', () => {
    expect(optionFull(opt(0))).toBe(true);
    expect(optionFull(opt(-3))).toBe(true); // TSS has been seen reporting overfill
  });

  it('is not full with seats left', () => {
    expect(optionFull(opt(1))).toBe(false);
    expect(optionFull(opt(15))).toBe(false);
  });

  it('is NOT full when the seat count is unknown', () => {
    // Older captures and some decoded links carry no seat count. Painting
    // "we don't know" as "no seats left" would be a claim the user acts on.
    expect(optionFull(opt(undefined))).toBe(false);
  });
});

describe('courseFull', () => {
  it('is full only when every section is full', () => {
    expect(courseFull(course(opt(0), opt(0)))).toBe(true);
    expect(courseFull(course(opt(0), opt(4)))).toBe(false);
  });

  it('is not full when any section has an unknown seat count', () => {
    expect(courseFull(course(opt(0), opt(undefined)))).toBe(false);
  });

  it('is not full with no sections at all', () => {
    expect(courseFull(course())).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @triton/web -- seats`
Expected: FAIL — `Failed to resolve import "./seats"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/seats.ts`:

```ts
/**
 * "Has this section run out of seats?" — one rule, read by the section list,
 * the course card and every calendar block.
 *
 * Seat counts are snapshots of the last TSS browse (see `capturedAt`); this
 * module only interprets what was captured, it never fetches.
 */
import type { CourseOffering, SectionOption } from '@triton/shared';

/**
 * A section whose known seat count has run out.
 *
 * An unknown count (`seatsAvailable === undefined`, e.g. older captures) is
 * NOT full — showing "no seats left" for data we never had would be a claim
 * the user acts on.
 */
export function optionFull(option: SectionOption): boolean {
  return option.seatsAvailable !== undefined && option.seatsAvailable <= 0;
}

/**
 * Every one of this course's sections is full. A course with no sections, or
 * with any section whose seat count is unknown, is not full — conservative on
 * purpose, for the same reason as above.
 */
export function courseFull(course: CourseOffering): boolean {
  return course.options.length > 0 && course.options.every(optionFull);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @triton/web -- seats`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/seats.ts web/src/lib/seats.test.ts
git commit -m "feat(web): add the full-section seat rule"
```

---

### Task 2: Carry `full` onto calendar instances

**Files:**
- Modify: `web/src/lib/layout.ts` (`MeetingInstance` ~line 25, `FinalInstance` ~line 209)
- Modify: `web/src/lib/plan.ts` (`meetingInstances` ~line 78, `FinalItem` ~line 108, `finalsSorted` ~line 124, `MidtermItem` ~line 141, `midtermsSorted` ~line 164)
- Modify: `web/src/lib/layout.test.ts` (two fixture factories, ~line 21 and ~line 165)
- Test: `web/src/lib/plan.test.ts`

**Interfaces:**
- Consumes: `optionFull` from Task 1.
- Produces: `MeetingInstance.full: boolean`, `FinalInstance.full: boolean`, `FinalItem.full: boolean`, `MidtermItem.full: boolean` — all **required**, all meaning "the section this came from is full". `PositionedBlock extends MeetingInstance`, so weekly blocks get `block.full` for free. `MidtermTbdItem` deliberately does NOT get the field.

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/plan.test.ts`:

```ts
describe('full-section flag on calendar instances', () => {
  /** A plan with one course whose selected option has `seats` seats left. */
  function planWithSeats(seats: number | undefined): PlanState {
    const course = makeCourse('CSE-008A|2026|2', 'CSE-008A');
    const option = course.options[0]!;
    if (seats !== undefined) option.seatsAvailable = seats;
    option.components = [
      {
        id: 'E1',
        type: 'LE',
        typeText: 'Lecture',
        sectionCode: '001-000-LE',
        instructors: ['Leo Porter'],
        meetings: [{ days: ['Mon'], start: '09:00', end: '09:50', modality: 'In Person' }],
        unscheduled: false,
        rawSched: 'M 09:00 AM - 09:50 AM In Person\nFinal Examination 12/09/2026 11:30 AM - 2:29 PM In Person\nMidterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person',
      },
    ];
    option.final = { date: '2026-12-09', start: '11:30', end: '14:29' };
    return {
      version: 1,
      term: course.term,
      entries: [{ course, selectedOptionId: option.id, color: '231' }],
    };
  }

  it('marks weekly meetings, finals and midterms of a full section', () => {
    const plan = planWithSeats(0);
    expect(meetingInstances(plan).every((m) => m.full)).toBe(true);
    expect(finalsSorted(plan)[0]!.full).toBe(true);
    expect(midtermsSorted(plan).dated[0]!.full).toBe(true);
  });

  it('leaves them unmarked when seats remain', () => {
    const plan = planWithSeats(12);
    expect(meetingInstances(plan).some((m) => m.full)).toBe(false);
    expect(finalsSorted(plan)[0]!.full).toBe(false);
    expect(midtermsSorted(plan).dated[0]!.full).toBe(false);
  });

  it('leaves them unmarked when the seat count is unknown', () => {
    const plan = planWithSeats(undefined);
    expect(meetingInstances(plan).some((m) => m.full)).toBe(false);
    expect(finalsSorted(plan)[0]!.full).toBe(false);
  });
});
```

Check the imports at the top of `plan.test.ts` — add whichever of `meetingInstances`, `finalsSorted`, `midtermsSorted`, `makeCourse`, and the `PlanState` type are not already imported there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @triton/web -- plan`
Expected: FAIL — TypeScript/assertion errors about `full` not existing.

- [ ] **Step 3: Add the field to the instance types**

In `web/src/lib/layout.ts`, inside `interface MeetingInstance`, after `day: Weekday;`:

```ts
  /** The section this meeting belongs to has no seats left. */
  full: boolean;
```

And inside `interface FinalInstance` (after its `hue: number;` line):

```ts
  /** The section this exam belongs to has no seats left. */
  full: boolean;
```

- [ ] **Step 4: Stamp the flag in plan.ts**

In `web/src/lib/plan.ts`, add to the imports at the top:

```ts
import { optionFull } from './seats';
```

In `meetingInstances`, after `const hue = entryHue(plan, entry);`:

```ts
    const full = optionFull(option);
```

and add `full,` to the object pushed into `out` (next to `day,`).

In `interface FinalItem` and `interface MidtermItem`, add to each:

```ts
  /** The selected section has no seats left. */
  full: boolean;
```

Leave `MidtermTbdItem` alone — TBD items never reach a calendar.

In `finalsSorted`, add to the pushed object:

```ts
      full: optionFull(option),
```

In `midtermsSorted`, after `const option = findOption(entry.course, entry.selectedOptionId);`:

```ts
    const full = option ? optionFull(option) : false;
```

and add `full,` to the object pushed into `dated` (alongside `midterm`).

- [ ] **Step 5: Fix the two test fixture factories**

`full` is required, so `web/src/lib/layout.test.ts` no longer compiles. Add `full: false,` to the defaults in the `inst(...)` factory (~line 21, next to `day: 'Mon',`) and in the `fin(...)` factory (~line 165, next to `end: '10:59',`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @triton/web && npm run typecheck`
Expected: all web tests PASS (3 new), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/layout.ts web/src/lib/layout.test.ts web/src/lib/plan.ts web/src/lib/plan.test.ts
git commit -m "feat(web): carry a full-section flag onto calendar instances"
```

---

### Task 3: Grey out full section rows

**Files:**
- Modify: `web/src/components/OptionPicker.tsx`
- Modify: `web/src/styles/app.css` (near `.opt--readonly`, ~line 1087)

**Interfaces:**
- Consumes: `optionFull` from Task 1.
- Produces: CSS classes `.opt--full` and `.picker__selected--full`. No new props.

- [ ] **Step 1: Apply the class to full rows**

In `web/src/components/OptionPicker.tsx`, replace the existing local:

```tsx
          const seatsFull = opt.seatsAvailable !== undefined && opt.seatsAvailable <= 0;
```

with a call to the shared rule (add `import { optionFull } from '../lib/seats';` at the top):

```tsx
          const seatsFull = optionFull(opt);
```

Then add the class to the row button's `className`, after the `opt--active` segment:

```tsx
              className={`opt${active ? ' opt--active' : ''}${seatsFull ? ' opt--full' : ''}${readOnly ? ' opt--readonly' : ''}`}
```

- [ ] **Step 2: Grey the collapsed toggle row when the selected section is full**

Still in `OptionPicker.tsx`, right after `const selected = findOption(course, selectedOptionId);`:

```tsx
  // With the list collapsed, this code is the only trace of the chosen section —
  // grey it too, or a full pick shows up nowhere but the calendar.
  const selectedFull = selected ? optionFull(selected) : false;
```

and change the collapsed code span to:

```tsx
          {collapsed && selected && (
            <span className={`picker__selected mono${selectedFull ? ' picker__selected--full' : ''}`}>
              {selected.code}
            </span>
          )}
```

- [ ] **Step 3: Add the styles**

In `web/src/styles/app.css`, immediately after the `.opt--readonly:hover { ... }` rule:

```css
/* Out of seats: the row recedes, but a selected row keeps its accent ring —
   grey must never swallow "this is the one you picked". The red seat count
   and its "waitlist" label are styled above and stay as they are. */
.opt--full .opt__code,
.opt--full .opt__instructor,
.opt--full .opt__summary {
  color: var(--text-faint);
}
.opt--full .opt__summary-kind {
  color: var(--text-faint);
}
.picker__selected--full {
  color: var(--text-faint);
}
```

- [ ] **Step 4: Verify**

Run: `npm test -w @triton/web && npm run typecheck`
Expected: PASS and clean (this task changes rendering only; existing tests must not break).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/OptionPicker.tsx web/src/styles/app.css
git commit -m "feat(web): grey out section rows with no seats left"
```

---

### Task 4: `Full` badge and muted course card

**Files:**
- Modify: `web/src/components/CourseCard.tsx`
- Modify: `web/src/styles/app.css` (near `.course-card--conflict`, ~line 505, and `.tag--conflict`, ~line 572)

**Interfaces:**
- Consumes: `courseFull` from Task 1.
- Produces: CSS classes `.course-card--full`, `.tag--full`, `.course-card__codeline`.

- [ ] **Step 1: Render the badge next to the course code**

In `web/src/components/CourseCard.tsx`, add the import:

```tsx
import { courseFull } from '../lib/seats';
```

After `const { course } = entry;`:

```tsx
  // Every section is taken. Says so next to the code, where the eye lands first.
  const full = courseFull(course);
```

Replace the code line:

```tsx
          <div className="course-card__code">{course.courseCode}</div>
```

with:

```tsx
          <div className="course-card__codeline">
            <span className="course-card__code">{course.courseCode}</span>
            {full && (
              <span className="tag tag--full" title="Every section of this course is full">
                Full
              </span>
            )}
          </div>
```

And add the modifier to the root `<section>`'s className, after the conflict segment:

```tsx
      className={`course-card${conflicted ? ' course-card--conflict' : ''}${full ? ' course-card--full' : ''}${flash ? ' course-card--flash' : ''}`}
```

- [ ] **Step 2: Add the styles**

In `web/src/styles/app.css`, right after the `.course-card__code { ... }` rule:

```css
/* code + optional "Full" badge share one line */
.course-card__codeline {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
```

After the `.course-card--conflict { ... }` rule:

```css
/* Every section taken: the card recedes and the accent spine goes neutral.
   The action buttons keep their normal look — a full course is exactly when
   you most need to click into TSS for the waitlist. */
.course-card--full {
  --c-spine: var(--line-strong);
}
.course-card--full .course-card__code {
  color: var(--text-muted);
}
.course-card--full .course-card__title {
  color: var(--text-faint);
}
```

After the `.tag--conflict { ... }` rule:

```css
.tag--full {
  background: var(--conflict-soft);
  color: var(--conflict-ink);
  border-color: transparent;
}
```

- [ ] **Step 3: Verify**

Run: `npm test -w @triton/web && npm run typecheck`
Expected: PASS and clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/CourseCard.tsx web/src/styles/app.css
git commit -m "feat(web): mark a fully-booked course on its card"
```

---

### Task 5: Grey out calendar blocks

**Files:**
- Modify: `web/src/components/CourseBlock.tsx`
- Modify: `web/src/components/FinalsCalendar.tsx` (instance mapping, ~line 42)
- Modify: `web/src/components/MidtermsView.tsx` (`FinalsCalendar` props, ~line 118)
- Modify: `web/src/components/BlockSheet.tsx`
- Modify: `web/src/styles/app.css` (near `.block--conflict`, ~line 1415)

**Interfaces:**
- Consumes: `PositionedBlock.full` and `FinalItem.full` / `MidtermItem.full` from Task 2.
- Produces: CSS classes `.block--full`, `.blocksheet__full`.

- [ ] **Step 1: Pass the flag through both exam calendars**

In `web/src/components/FinalsCalendar.tsx`, inside the `finals.map((f) => ({ ... }))` that builds `FinalInstance[]`, add:

```tsx
      full: f.full,
```

In `web/src/components/MidtermsView.tsx`, inside the `dated.map((m) => ({ ... }))` passed as `finals`, add:

```tsx
              full: m.full,
```

- [ ] **Step 2: Apply the class on the block**

In `web/src/components/CourseBlock.tsx`, extend the `<article>` className — put `block--full` **before** `block--conflict` reads in CSS, but source order here does not matter since the CSS below is ordered:

```tsx
      className={`block${block.full ? ' block--full' : ''}${block.conflict ? ' block--conflict' : ''}${compact ? ' block--sm' : ''}${onDetail || onFocusCourse ? ' block--focusable' : ''}`}
```

Also extend the `title` tooltip so the state is readable without color. Change the `title={...}` expression's tail from:

```tsx
${block.conflict ? '\n⚠ Time conflict' : ''}`}
```

to:

```tsx
${block.conflict ? '\n⚠ Time conflict' : ''}${block.full ? '\nNo seats left in this section' : ''}`}
```

- [ ] **Step 3: Mark it on the mobile block sheet**

In `web/src/components/BlockSheet.tsx`, right after the `<div className="blocksheet__code mono">{block.courseCode}</div>` line:

```tsx
        {block.full && <div className="blocksheet__full">No seats left in this section</div>}
```

- [ ] **Step 4: Add the styles**

In `web/src/styles/app.css`, immediately BEFORE the `.block--conflict { ... }` rule (so conflict's border wins the cascade):

```css
/* No seats left in the section this block belongs to: drop the course hue for
   a neutral ramp. Declared before .block--conflict so a block that is both
   full and conflicting still reads as conflicting. */
.block--full {
  --b-spine: var(--line-strong);
  --b-fill: var(--surface-2);
  --b-border: var(--line);
  --b-text: var(--text-faint);
}
```

And near the other `.blocksheet__*` rules:

```css
.blocksheet__full {
  margin-top: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--conflict-ink);
}
```

- [ ] **Step 5: Verify**

Run: `npm test -w @triton/web && npm run typecheck`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/CourseBlock.tsx web/src/components/FinalsCalendar.tsx web/src/components/MidtermsView.tsx web/src/components/BlockSheet.tsx web/src/styles/app.css
git commit -m "feat(web): grey out calendar blocks for full sections"
```

---

### Task 6: End-to-end verification

**Files:**
- Create: `<scratchpad>/full-sections-e2e.js` (scratchpad, not the repo)
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: everything above, running against the dev server.
- Produces: nothing the app imports.

- [ ] **Step 1: Start the dev server**

Run in the background: `npm run dev -w @triton/web` (serves http://localhost:5173/). The dev build seeds three sample CSE courses into the browsed pool.

- [ ] **Step 2: Write the E2E script**

`puppeteer-core` is installed in this session's scratchpad; Chrome is at `C:/Program Files/Google/Chrome/Application/chrome.exe`. The sample courses all have seats, so the script edits seat counts through the page's own bridge-free path: it adds courses via the UI, then rewrites the persisted plan in `localStorage` and reloads.

```js
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const check = (name, pass, extra = '') => {
  out.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.browse-row');

  // Add the first two browsed courses.
  await page.click('.browse-row');
  await wait(400);
  await (await page.$$('.browse-row'))[0].click();
  await wait(600);

  // Course 0: every section full. Course 1: only the selected section full.
  await page.evaluate(() => {
    const key = 'triton-planner:plans:v1';
    const state = JSON.parse(localStorage.getItem(key));
    const plan = state.plans.find((p) => p.id === state.activeId).plan;
    plan.entries[0].course.options.forEach((o) => { o.seatsAvailable = 0; });
    const e1 = plan.entries[1];
    e1.course.options.forEach((o, i) => { o.seatsAvailable = i === 0 ? 0 : 9; });
    e1.selectedOptionId = e1.course.options[0].id;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(700);

  const cards = await page.$$eval('.course-card', (els) =>
    els.map((el) => ({
      code: el.querySelector('.course-card__code')?.textContent ?? '',
      full: el.classList.contains('course-card--full'),
      badge: el.querySelector('.tag--full')?.textContent?.trim() ?? '',
      collapsedGrey: !!el.querySelector('.picker__selected--full'),
    })),
  );
  check('fully-booked course: card muted + Full badge',
    cards[0]?.full === true && cards[0]?.badge === 'Full', JSON.stringify(cards[0]));
  check('partly-full course: no card badge',
    cards[1]?.full === false && cards[1]?.badge === '', JSON.stringify(cards[1]));
  check('partly-full course: collapsed section code greyed', cards[1]?.collapsedGrey === true);

  const blocks = await page.$$eval('.cal-scroll .block', (els) => els.length);
  const fullBlocks = await page.$$eval('.cal-scroll .block--full', (els) => els.length);
  check('every calendar block is greyed (both selected sections are full)',
    blocks > 0 && blocks === fullBlocks, `${fullBlocks}/${blocks}`);

  // Expand the partly-full course's sections and confirm only the full row greys.
  await (await page.$$('.picker__toggle'))[1].click();
  await wait(300);
  const rows = await page.$$eval('.course-card:nth-of-type(2) .opt', (els) =>
    els.map((el) => el.classList.contains('opt--full')),
  );
  check('only the zero-seat rows grey out',
    rows.length > 1 && rows[0] === true && rows.slice(1).every((r) => r === false),
    JSON.stringify(rows));

  await page.screenshot({ path: 'full-sections-desktop.png', fullPage: false });

  // Finals + Midterms calendars use the same block component.
  for (const [tab, label] of [['Midterms', 'midterms'], ['Finals', 'finals']]) {
    const clicked = await page.evaluate((t) => {
      const b = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === t);
      if (b) b.click();
      return !!b;
    }, tab);
    if (!clicked) { check(`${label} tab found`, false); continue; }
    await wait(500);
    const n = await page.$$eval('.block', (els) => els.length);
    const g = await page.$$eval('.block--full', (els) => els.length);
    check(`${label} blocks greyed`, n === 0 || n === g, `${g}/${n}`);
    await page.screenshot({ path: `full-sections-${label}.png` });
  }

  await browser.close();
  const failed = out.filter((p) => !p).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run it**

Run: `node full-sections-e2e.js` from the scratchpad directory.
Expected: all checks PASS. If a check fails, fix the source (not the assertion) and re-run.

- [ ] **Step 4: Look at the screenshots**

Open `full-sections-desktop.png`, `full-sections-midterms.png`, `full-sections-finals.png` with the Read tool. Confirm by eye: the greyed blocks are clearly recessive but still readable, the `Full` badge sits right of the course code, and a conflicting block (if any) still shows its red border.

- [ ] **Step 5: Full suite + builds**

Run: `npm run typecheck && npm test && npm run build -w @triton/web`
Expected: typecheck clean, all workspaces' tests pass, web build succeeds.

- [ ] **Step 6: Update PROGRESS.md**

Add a dated section at the top of the entries (below the header block) in Chinese, following the file's existing style: what shipped, the `seatsAvailable === undefined` ≠ full rule, the three layers, the test count, and that it is web-only with no extension release.

- [ ] **Step 7: Commit**

```bash
git add PROGRESS.md
git commit -m "docs: record the full-sections round"
```

Note `PROGRESS.md` is gitignored, so this commit may be empty — that is expected; skip it if git reports nothing to commit.

- [ ] **Step 8: Hand back for review**

Leave the dev server running and tell the user to look at http://localhost:5173/ before anything is pushed. Do **not** push — that is the user's call (see the release convention in CLAUDE.md).

---

## Self-Review

**Spec coverage:** the full rule (Task 1), instance flags incl. `MidtermTbdItem` exclusion (Task 2), section row + collapsed row (Task 3), card badge + muting with buttons untouched (Task 4), weekly/midterm/finals blocks + conflict precedence + block sheet (Task 5), tests and the dev-server walkthrough (Task 6). Out-of-scope items (waitlist counts, exam row lists, sorting/filtering) have no task, by design.

**Type consistency:** `optionFull` / `courseFull` are the only names used everywhere; `full` is the field name on `MeetingInstance`, `FinalInstance`, `FinalItem`, `MidtermItem`; classes are `.opt--full`, `.picker__selected--full`, `.course-card--full`, `.tag--full`, `.course-card__codeline`, `.block--full`, `.blocksheet__full`.
