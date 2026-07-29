# Midterms view — design (2026-07-29, user-approved)

## Goal

A third planner view, **Midterms**, placed between Calendar and Finals, using the
Finals view's layout: a date-ordered row timeline on top and an "at a glance"
week calendar below. Courses whose midterm time is visible in TSS data show with
real times; courses without a known midterm time appear only in the row list as
**TBD** and are absent from the calendar.

## Route A: no extension release needed (approved)

TSS `Sched` strings contain midterm lines of the exact same shape as final lines
(`Midterm Examination <MM/DD/YYYY> <Start> - <End> <Modality>`, see
tss-api-notes.md §Sched grammar #3). The 2026-07-24 parser fix rejects these
lines from weekly-meeting parsing (into `unparsedLines`) but the **raw text
survives in `Component.rawSched`**, which is present in all captured data
(localStorage plans/pool, JSON imports). So the web derives midterms from
`rawSched` at render time — existing user data works immediately, no extension
release, no re-browsing. Same precedent as the ghost-meeting web fallback.

The extension is untouched this round.

## Data model

- **shared**
  - `MidtermExam` = same shape as `FinalExam` (date ISO, start/end "HH:MM",
    modality?). Type alias.
  - `SectionOption.midterms?: MidtermExam[]` — populated only by v3 share decode
    (and potentially future extension captures). `undefined` = derive from
    rawSched.
  - `midtermsFromSched(sched)` — pure grammar helper (regex mirrors the final
    line, times via `parse12h`). Lives in shared so the grammar is written once.
  - `optionMidterms(option)` — `option.midterms ?? ` derive from all components'
    rawSched, dedupe by `date|start|end`, sorted by date then start.
- **web `lib/plan.ts`**
  - `midtermsSorted(plan)` → `{ dated: MidtermItem[], tbd: MidtermTbdItem[] }`.
    Per entry: selected option's `optionMidterms`; non-empty → dated items
    (label "Midterm N" when a course has more than one), else a TBD row.
    Dated sorted by date+start; TBD sorted by course code.
  - `midtermOverlapKeys(dated)` → Set of `${courseId}|${date}|${start}` for
    items overlapping a *different* course's midterm on the same date.
    View-local only — midterm overlaps do NOT enter the global conflict
    banner/count (that stays weekly + finals).

## Views

- Desktop toolbar tabs: **Calendar | Midterms | Finals**. Mobile bottom bar
  becomes 4 tabs (Courses | Calendar | Midterms | Finals), Midterms has no
  badge. Mobile Week/Days toggle (`CalViewToggle`) also shows on Midterms.
- `MidtermsView` mirrors `FinalsView` markup/classes (`final-row` etc.):
  - Dated rows: date block + course + time range + modality; overlap flag
    "Overlaps another midterm".
  - TBD rows: muted (`final-row--tbd`), time cell shows **TBD** with subtext
    "Not announced in TSS yet". ("TBA" stays reserved for unscheduled
    components in option rows.)
  - Calendar: reuse `FinalsCalendar`/`layoutFinalsWeek` via new optional
    `examLabel` prop (block typeText "Midterm"); only dated items are passed,
    so all-TBD plans render rows without a calendar. Empty plan → same empty
    state pattern as Finals.
- Received read-only view works unchanged (derives from the viewed plan).

## Share compatibility

- **v3 full**: `WireOpt` gains a 7th positional element
  `midterms: WireFinal[] | 0`, filled at encode time from `optionMidterms`
  (so the sender derives from rawSched and the receiver — who has no
  rawSched — reads `option.midterms`). Old tokens → element undefined → TBD.
  Old decoders ignore the extra element. Both directions compatible.
- **v2 lite**: frozen, unchanged — lite recipients see all-TBD (it's the
  degraded format by design).
- JSON imports keep rawSched → derivation just works.

## Testing

- shared: grammar tests driven by the real CHEM-043A line; multiple midterms;
  none; garbage lines; `optionMidterms` dedupe/priority.
- web: `midtermsSorted` (dated/TBD split, labels, sorting, overlap keys);
  share-v3 round-trip with midterms + old-token (6-element opt) compat.
- E2E (puppeteer): plan containing CHEM-043A raw data → three tabs, dated row +
  calendar block, TBD rows, overlap flag.
