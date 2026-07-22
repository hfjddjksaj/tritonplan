# TSS (Triton Student System) — Reverse-Engineering Notes

Captured **2026-07-21** by passively intercepting the SAP Fiori app's own `fetch`/`XHR` traffic
on the **Schedule of Classes** app. No requests were issued by us — we only `response.clone()`'d
what the page already fetched (this is the exact technique the shipped extension will use; see the
"no-ban / passive-only" red line in the plan). Term captured: **Fall 2026** (`AcYear=2026`, `AcPeriod=2`).

## Platform
- TSS is **SAP Student Lifecycle Management (SLcM)** behind a **SAPUI5 / Fiori launchpad**.
  - App URL pattern: `https://tss.ucsd.edu/fiori#YSchedule-view?...`
  - Login: `sis.ucsd.edu` (SSO) → launchpad at `tss.ucsd.edu/fiori`.
- Data is served via **OData v4**. Root service for the Schedule of Classes:
  `https://tss.ucsd.edu/sap/opu/odata4/sap/yucsd_con_module_sb/srvd/sap/yucsd_con_module_servicedef/0001/`
  (referred to below as `{SVC}`). Requests carry `?sap-client=500`.
- `{SVC}$metadata` returns the full schema (~111 KB) if the parser ever needs exact types.

## Key endpoints observed

| Purpose | Call |
|---|---|
| Academic-year dropdown | `GET {SVC}YUCSD_I_PERYRT_SOC` |
| Term dropdown | `GET {SVC}YUCSD_I_PERIDT_SOC` |
| Min/max units | `GET {SVC}YUCSD_I_MINMAXUNITS?$filter=Peryr eq '2026' and Perid eq '2'` |
| **Course search (list)** | `POST {SVC}$batch` → entity `YUCSD_CON_MODULE` (server pages 30 at a time) |
| Course title | `GET {SVC}YUCSD_I_SM_TITLE(Smobjid='8461',Peryr='2026',Perid='2')` |
| **Sections of a course** | `GET {SVC}YUCSD_CON_MODULE(AcademicYear='2026',AcademicPeriod='2',ModuleID='8461')/_sections?$skip=0&$top=N` |

Course search and some reads go through OData **`$batch`** (multipart/mixed containing embedded JSON
`{"@odata.context":..., "value":[...]}`). The **sections** call is a plain GET returning JSON directly.

## Entity: `YUCSD_CON_MODULE` (course / "module" — the search-results row)
Fields: `AcademicYear`, `AcademicPeriod`, `ModuleID`, `AcademicLevel`, `DepartmentAbbr`,
`DepartmentText`, `CourseAbbr` (e.g. `"CSE-003"`), `CourseTitle`, `CreditsDisplay`, `incrementDisplay`.
- `ModuleID` (e.g. `"8461"`) is the key used to fetch sections.
- Course-code format is **`SUBJ-NNN[suffix]`** with a hyphen and zero-padded number: `CSE-003`, `CSE-008A`, `CSE-110`.
- Search input accepts a whole department (`"CSE"` → 73 courses) or a specific code. `"CSE 100"` (space) returned nothing; use the dept or exact `CSE-###` form.

## Entity: `_sections` navigation (THE important one)
The response `value[]` is **DENORMALIZED: one row per (Event × EventPackage) pair.** A row combines a
teaching **Event** (a lecture/discussion/lab meeting) with an **EventPackage** (a bookable combination
of events students actually book — e.g. lecture + one specific lab). The same lecture Event therefore
repeats across every package it belongs to.

Per-row fields we keep (see `fixtures/cse-sections-normalized.json` for real captured data):

**Event (the meeting component):**
- `EventID` (e.g. `"E 00000958"`) — stable id of the meeting component (dedupe key)
- `EventKey` (e.g. `"001"`), `EventAbbr` (e.g. `"001-000-LE"`, `"001-003-LA"`, `"001-001-DI"`)
- `TeachingMethod` = `LE` | `DI` | `LA` | `SE` | … ; `TeachingMethod_Text` = `Lecture`/`Discussion`/`Laboratory`/…
- `InstructorName` (e.g. `"Leo Porter"`), `InstructorEmail` (e.g. `"mailto: LEPORTER@UCSD.EDU"`)
- `LocationText` = campus only (`"UC San Diego"`) — **the real building/room is inside `Sched`, not here**
- `Status` (`"Scheduled"`), `Limit` (component capacity)
- `BeginDate`, `EndDate` = quarter start/end for that component (ISO `YYYY-MM-DD`)
- **`Sched`** = pre-formatted human string with days/time/modality/room + optional final exam ⭐ (grammar below)

**EventPackage (the bookable option):**
- `EventPkgOtjid` / `EventPkgDisplayID` (e.g. `"SE00154302"`) — the enrollment/booking code
- `EventPkgText` (e.g. `"CSE-008A (P-001-001)"`) — human label
- `EventPkgLimit`, `EventPkgSeatsAvailable`, `EventPkgNumOnWaitl`, `EventPkgStatusText`

> **Parser step 1:** group rows by `EventPkgOtjid` → each package = a bookable option whose member
> Events (deduped by `EventID`) are what should be drawn on the calendar together, e.g.
> `Lecture 001-000-LE` + `Lab 001-004-LA` + `Discussion 001-001-DI`.

## ⭐ `Sched` string grammar (the core parsing job)
Either the literal `"Schedule Not Defined"` (TBA/async — see below), OR one or more lines
separated by `\n`. Two line kinds:

**1. Meeting line:** `<Days> <StartTime> - <EndTime> <Modality>[ @ <Location>]`
- `<Days>` = comma+space separated abbreviations from `{M, Tu, W, Th, F}` (expect `Sa`, `Su` too). Examples: `Tu, Th` / `M, W` / `W` / `F` / `Th`.
- `<StartTime>`/`<EndTime>` = 12-hour `h:mm AM|PM` (e.g. `11:00 AM`, `12:20 PM`).
- `<Modality>` = `In Person` | `Live Online` (Modality filter also lists `Online`, `Other`). **Multi-word — do not assume one token.**
- **`@ <Location>` is OPTIONAL** — present for In-Person, ABSENT for `Live Online` (e.g. `"W 09:00 AM - 09:50 AM Live Online"`). Parse location only if `" @ "` is present.
- `<Location>` = free text like `Galbraith Hall Room 242`, `Center Hall Room 105`, `Computer Science and Engineering Buildin Room B260`.
  - ⚠ Building names can be **truncated in the source data** (`"Buildin"` for "Building"). Store the raw string; do NOT try to "correct" it.
  - Parse room as the substring after the last `" Room "` if present; keep the rest as building.
- Robust parse: split modality/location off the END (find `" @ "` → location; the trailing known-modality phrase → modality), then the head is `<Days> <Start> - <End>`. Don't split modality by first space.

**2. Final-exam line:** `Final Examination <MM/DD/YYYY> <StartTime> - <EndTime> <Modality>`
- Present on most in-person **Lecture (`LE`)** rows, but **OPTIONAL even on lectures** (async/online lectures have none).
- Date is US `MM/DD/YYYY` (e.g. `12/09/2026`); times are 12-hour.

**TBA / async:** `Sched === "Schedule Not Defined"` → the component has no placeable time (e.g. an
async online lecture; `LocationText` is then `"MC Online"`). Put these in an **"unscheduled/TBA" list**,
NOT on the calendar grid. `LocationText` is `"UC San Diego"` for in-person and `"MC Online"` for online —
a weak hint only; the authoritative schedule signal is `Sched`.

See `fixtures/sched-edge-cases.json` for real online/TBA samples.

### All 19 distinct real `Sched` values captured (use as parser test cases)
```
Tu, Th 11:00 AM - 12:20 PM In Person @ Galbraith Hall Room 242\nFinal Examination 12/09/2026 11:30 AM - 02:29 PM In Person
W 09:00 AM - 09:50 AM In Person @ Computer Science and Engineering Buildin Room B260
W 10:00 AM - 10:50 AM In Person @ Computer Science and Engineering Buildin Room B260
W 11:00 AM - 11:50 AM In Person @ Computer Science and Engineering Buildin Room B260
W 12:00 PM - 12:50 PM In Person @ Computer Science and Engineering Buildin Room B260
W 01:00 PM - 01:50 PM In Person @ Computer Science and Engineering Buildin Room B260
W 02:00 PM - 02:50 PM In Person @ Computer Science and Engineering Buildin Room B260
W 03:00 PM - 03:50 PM In Person @ Computer Science and Engineering Buildin Room B260
W 04:00 PM - 04:50 PM In Person @ Computer Science and Engineering Buildin Room B260
W 05:00 PM - 05:50 PM In Person @ Computer Science and Engineering Buildin Room B260
F 08:00 AM - 08:50 AM In Person @ Galbraith Hall Room 242
Tu, Th 02:00 PM - 03:20 PM In Person @ Center Hall Room 105\nFinal Examination 12/10/2026 03:00 PM - 05:59 PM In Person
W 07:00 PM - 07:50 PM In Person @ Center Hall Room 214
Tu, Th 09:30 AM - 10:50 AM In Person @ Galbraith Hall Room 242\nFinal Examination 12/10/2026 08:00 AM - 10:59 AM In Person
M, W 06:30 PM - 07:50 PM In Person @ Center Hall Room 115\nFinal Examination 12/07/2026 07:00 PM - 09:59 PM In Person
Th 05:00 PM - 05:50 PM In Person @ Warren Lecture Hall Room 2005
W 01:00 PM - 01:50 PM In Person @ Center Hall Room 214
W 02:00 PM - 02:50 PM In Person @ Center Hall Room 214
W 04:00 PM - 04:50 PM In Person @ Center Hall Room 109
```
(`\n` shown literally above = a real newline inside the field.)

## Day-abbreviation → Weekday map
`M`→Mon, `Tu`→Tue, `W`→Wed, `Th`→Thu, `F`→Fri, `Sa`→Sat, `Su`→Sun.

## Coverage captured so far
- **Undergrad in-person**: lecture + N labs + discussion, multiple lecture sections, with finals (CSE-008A/011/030).
- **Online**: `Live Online` meetings (no room) and `Schedule Not Defined` async (ETHN-001R). `LocationText` = `MC Online`.
- **Graduate** (CSE-209A, CSE-229A): coded as `TeachingMethod = LE` (even "Seminar"-titled ones), typically ONE weekly meeting, **no final-exam line**. Confirms finals are optional even on in-person lectures.

## NOT yet captured (edge cases to handle defensively / capture later before wide release)
- Sections with **multiple meeting lines** of different times (assume meeting lines joined by `\n` before any final-exam line; parser should accept N meeting lines).
- `Modality = Online` / `Other` wording (only `In Person` + `Live Online` seen in real `Sched` so far); Hybrid.
- Non-`LE`/`DI`/`LA` teaching methods (e.g. `SE` seminar, `IN` independent study, `LA` vs `ST` studio).
- Multi-instructor sections; cross-listed courses; 0-unit / variable-unit; Saturday/Sunday meetings; summer sessions.

## DOM selectors for the "+ TritonPlan" injection (VERIFIED LIVE 2026-07-21)
The extension injects a "+ TritonPlan" button per bookable package in the course-detail
**Class Sections** view. TSS uses stable UCSD-custom `soc*` classes (the SAP-generated
`.sapM*` classes do NOT reliably match). Verified on CSE-008A (9 packages → 9 cards):

| Selector | Meaning | Example |
|---|---|---|
| `.socClassSections` | the whole Class Sections area | |
| `.socPkgBlock` | **one card per bookable package** (iterate these) | 9 for CSE-008A |
| `.socPkgHeader` / `.socPkgHeaderMain` / `.socPkgHeaderRight` | card header / its right cell | inject next to Go To Booking |
| `.socPkgName` | package label | `CSE-008A (P-001-001)` |
| `.socPkgId` | enroll code (→ `option.enrollCode`) | `SE00154302` |
| `.socRegisterBtn` | the "Go To Booking" button | (do NOT click — no-ban) |
| `.socEventTable` / `.socSectionId` | the per-section events table | |

Map a card → our option by `card.querySelector('.socPkgId').textContent` === `option.enrollCode`
(fallback: `.socPkgName` "(P-###-###)" === `option.code`). Implemented in `extension/src/content/tss-inject.ts`.

## Deep link back to a course (VERIFIED LIVE 2026-07-21)
`https://tss.ucsd.edu/fiori#YSchedule-view?sap-app-origin-hint=&/YUCSD_CON_MODULE(AcademicYear='<yr>',AcademicPeriod='<per>',ModuleID='<id>')`
**resolves directly to the course detail WITHOUT the `sap-iapp-state` session token** — confirmed by
navigating to CSE-008A (ModuleID 8461) cold; it loaded the course + Class Sections. So the planner's
`tssDeepLink` (which omits the token) works. The open-course hash always contains
`YUCSD_CON_MODULE(AcademicYear=…,AcademicPeriod=…,ModuleID=…)`; the extension extracts those via regex.

## Reproducing a capture (for future sessions, requires user's TSS login)
1. Log into `sis.ucsd.edu`, open **Schedule of Classes**.
2. Install interceptor (page context): hook `fetch` + `XHR`, on load `response.clone().text()` for URLs containing `/odata`, push to `window.__cap`.
3. Search a dept, click a course row → read the `/_sections` response body from `window.__cap`.
4. The MCP `read_network_requests` tool shows URLs/status only (no bodies); bodies must come from the injected interceptor. Tool output truncates ~1 KB, so page-side slice large payloads.
