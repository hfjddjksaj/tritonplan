# Full (no-seat) sections — design (2026-08-09, user-approved)

## Goal

Make "this section has no seats left" impossible to miss, in all three places a
section shows up: its row in the section list, the course card when the whole
course is full, and the blocks on the calendars.

Today the only signal is small: in `OptionPicker`, a section with
`seatsAvailable <= 0` renders its seat count in red and labels it `waitlist`
instead of `seats`. That stays; everything below is layered on top of it.

Pure web. `seatsAvailable` has been captured and pushed by the extension since
0.2.x, so existing user data lights this up on first load — no extension
release, no re-browsing.

## What counts as full

- **A section is full** when `seatsAvailable` is a known number `<= 0`.
- **Seats unknown is never full.** `seatsAvailable === undefined` (older
  captures, some decoded links) means we don't know — painting "unknown" as
  "no seats left" would be a lie the user can act on.
- **A course is full** when it has at least one option and *every* option is
  full by the rule above. A single option with unknown seats makes the course
  not-full — conservative on purpose.

Both live in a new `web/src/lib/seats.ts` as pure functions, so one rule feeds
all three layers:

```ts
export function optionFull(option: SectionOption): boolean;
export function courseFull(course: CourseOffering): boolean;
```

## Data flow

The calendars render from flattened instances that today carry no seat
information. Each gets one boolean, set from the **selected** option:

- `lib/plan.ts`
  - `MeetingInstance` (in `lib/layout.ts`) gains `full: boolean`;
    `meetingInstances()` sets it from `optionFull(selected option)`.
    `PositionedBlock extends MeetingInstance`, so weekly blocks inherit it.
  - `FinalItem` and `MidtermItem` each gain `full: boolean`, set the same way
    in `finalsSorted()` / `midtermsSorted()`. `MidtermTbdItem` does **not** —
    TBD items never reach a calendar, and the row lists are out of scope
    (below), so the field would have no consumer.
- `lib/layout.ts`
  - `FinalInstance` gains `full: boolean`; `FinalsCalendar` copies it through
    when it maps items into instances. `layoutFinalsWeek` passes it along
    untouched (it only positions).

No new state, no new persistence, nothing on the wire: the flag is derived at
render time from data the plan already holds. Share links, QR codes, JSON
export and the received/read-only view all keep working unchanged, and a
shared plan shows the sender's captured seat counts exactly as it shows them
today.

## Visual treatment

**Section row** — `.opt--full` on the row button:
- Row text (code, instructor, schedule summary) drops to `--text-faint`.
- The selected row keeps its accent ring and radio color. Grey must not swallow
  "this is the one you picked".
- The seat count keeps its existing red `0/15` + `waitlist` label.

**Collapsed section row** — when the list is collapsed and the *selected*
section is full, the section code shown on the toggle row (`.picker__selected`)
greys out too. Without this, a user whose selected section is full sees a grey
calendar block and nothing at all on the card, because the list defaults to
collapsed.

**Course card** — `.course-card--full`, only when the whole course is full:
- A red `Full` badge immediately right of the course code (`CSE-008A  Full`),
  in the existing `.tag` family, styled like `tag--conflict`.
- Course code and title text drop to a muted tone; the left accent spine goes
  grey.
- `open in TSS`, `book section`, `prerequisites` and the remove button keep
  their normal appearance and behaviour — a full course is exactly when the
  user most needs to click into TSS for the waitlist.

**Calendar block** — `.block--full`, driven by the *selected* section (so a
block greys out even when other sections of that course still have room):
- Overrides the four block color tokens (`--b-fill`, `--b-border`, `--b-text`,
  `--b-spine`) with a grey ramp, replacing the course hue.
- `.block--conflict` keeps winning on the border/warning glyph: a block that is
  both full and conflicting must still read as conflicting.
- Applies on the weekly Calendar, the Midterms calendar and the Finals calendar
  (same component), and in both `fit` and `scroll` mobile variants.

**Mobile block sheet** — `BlockSheet` shows a `Full` marker next to the course
code, matching the card badge, since on mobile the block sheet is how you
inspect a block.

## Out of scope

- **The Finals / Midterms row lists.** Only the calendars inside those views
  grey out. Those rows already carry their own markers (TBD, "Overlaps another
  midterm"); a third overlay would crowd them, and the user asked for the
  calendar blocks.
- Waitlist counts. `SectionOption.waitlist` exists in the model but has never
  been verified against live TSS data for meaning or freshness; showing a
  number we haven't confirmed is worse than showing none.
- Sorting, filtering or hiding full sections. Greying is a signal, not a
  policy — the user still picks whatever they want.
- Any change to conflict detection, unit totals, or what a full course
  contributes to them. A full course is still in your plan.

## Testing

- `seats.test.ts` — `optionFull` / `courseFull` across: undefined seats, 0,
  negative, positive, no options at all, and mixed (one unknown among full
  ones → not full).
- `plan.test.ts` — `meetingInstances` / `finalsSorted` / `midtermsSorted` carry
  `full` from the selected option, and switching to a non-full section clears
  it.
- Puppeteer E2E on the dev server: a plan holding one fully-booked course and
  one course whose *selected* section is full while others have room. Assert
  the `Full` badge appears only on the first, the grey classes land on the
  right rows/blocks, a conflicting-and-full block still shows its conflict
  border, and the Finals/Midterms blocks match. Screenshots for eyeball review.

## Release

Web only; no extension version bump. Ships on the next push to `main` (Pages
auto-deploys), after the local dev-server walkthrough the user reviews first.
