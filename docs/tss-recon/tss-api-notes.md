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

### ⭐ Collection vs single-entity responses (verified live 2026-08-10)

The same entity comes back in **two different shapes** depending on how the user got there:

| Path into a course | Module row shape |
|---|---|
| Course **search list** | collection — `{"@odata.context":"…", "value":[ …rows… ]}` |
| **Deep link** to one course (`#YSchedule-view?…/YUCSD_CON_MODULE(…ModuleID='14502')`) | **single entity** — `@odata.context` ends in **`/$entity`**, the row's fields sit at the **top level, with no `value` array** |

Full request sequence observed on a deep-link open of PHYS-002CL (ModuleID `14502`), passive
page-hook capture, logged-in session:

```
$metadata · $batch ×2 · Currencies
YUCSD_I_SM_TITLE(Smobjid='14502',Peryr='2026',Perid='2')   ← title only, NO credits
YUCSD_I_PERYRT_SOC · YUCSD_I_PERIDT_SOC · YUCSD_I_MINMAXUNITS
$batch  ← contains the single-entity YUCSD_CON_MODULE: CourseAbbr, CourseTitle, CreditsDisplay "2.00"
_sections  ← 20 section rows, 23 fields, NO credits field anywhere
```

Two consequences worth remembering:

- **Credits live only on `YUCSD_CON_MODULE`.** Neither `_sections` (23 fields, checked
  exhaustively) nor `YUCSD_I_SM_TITLE` carries units. A course captured from sections alone can
  never have its unit count filled in.
- `YUCSD_I_SM_TITLE` returns `Smobjid`, `Short` (course code), `Stext` (short name), `Title` (full
  name), `acLevel`, `isPAE`, `search` — useful for a title, useless for credits.

Until 2026-08-10 `extract-odata.ts` only accepted documents with a `value` array, so every
single-entity response was silently dropped — a deep-linked course arrived with sections but no
title and no units. Any new shape check must handle both forms.

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

### Re-verified 2026-08-10 (CHEM-043A, ModuleID 2117, Fall 2026 — fully booked course)

The page's own `_sections` GET now uses this `$select` (63 rows / 21 packages returned in ONE page,
`$top=1000`): `AcPeriod,AcYear,EventAbbr,EventID,EventPkgDisable,EventPkgDisplayID,EventPkgLimit,
EventPkgNumOnWaitl,EventPkgObjid,EventPkgOtjid,EventPkgSeatsAvailable,EventPkgSemanticColorCapacity,
EventPkgStatusText,EventPkgText,InstructorEmail,InstructorName,ModuleID,Sched,Status,StatusSemantic,
TeachingMethod,TeachingMethod_Text,locationText`. Notes against the 2026-07-21 fixtures:

- **Numbers, not strings**: `EventPkgLimit: 23`, `EventPkgSeatsAvailable: 0`, `EventPkgNumOnWaitl: 0`,
  `StatusSemantic: 0|2`, `EventPkgSemanticColorCapacity: 1` all arrive as JSON numbers. The 07-21
  captures had limit/seats as strings — `toNum` in the parser accepts both
  (regression: `extension/src/lib/capture-numeric-seats.test.ts`, real captured rows).
- **Field set is `$select`-dependent**: this feed has `locationText` (lowercase) and NO `EventKey` /
  `BeginDate` / `EndDate` / `LocationText` / `Limit`. Treat all of those as optional.
- **Fullness has TWO looks in the TSS UI** (all 21 packages had `EventPkgSeatsAvailable: 0`):
  - `EventPkgStatusText: "Waitlist Only"` + `EventPkgDisable: "X"` (13 pkgs) — the UI **hides** the
    `Limit` / `Available` badges entirely and shows only ⚠ `Waitlist Only`; the member Event that is
    waitlist-gated carries `Status: "Waitlist Only"`, `StatusSemantic: 2`.
  - `EventPkgStatusText: ""` + `EventPkgDisable: ""` (8 pkgs) — the UI shows `Limit: 23` and a red
    `Available: 0`. So "no seats" in the UI is `seats === 0`, with or without a status text.
- **UI5 model caching (why seat counts can look frozen)**: `_sections` is fetched once per full page
  load of the course view. In-app navigation afterwards — switching detail tabs, closing/reopening
  the panel, re-running the search — renders from the cached OData model and does NOT refetch, so
  nothing new is emitted for the extension to capture. Only a full page (re)load (F5, new tab, deep
  link) produces a fresh `_sections` response.

> **Parser step 1:** group rows by `EventPkgOtjid` → each package = a bookable option whose member
> Events (deduped by `EventID`) are what should be drawn on the calendar together, e.g.
> `Lecture 001-000-LE` + `Lab 001-004-LA` + `Discussion 001-001-DI`.

## ⭐ `Sched` string grammar (the core parsing job)
Either the literal `"Schedule Not Defined"` (TBA/async — see below), OR one or more lines
separated by `\n`. Three line kinds:

**1. Meeting line:** `<Days> <StartTime> - <EndTime> <Modality>[ @ <Location>]`
- `<Days>` = comma+space separated abbreviations from `{M, Tu, W, Th, F}` (expect `Sa`, `Su` too). Examples: `Tu, Th` / `M, W` / `W` / `F` / `Th`.
- `<StartTime>`/`<EndTime>` = 12-hour `h:mm AM|PM` (e.g. `11:00 AM`, `12:20 PM`).
- `<Modality>` = `In Person` | `Live Online` (Modality filter also lists `Online`, `Other`). **Multi-word — do not assume one token.**
- **`@ <Location>` is OPTIONAL** — present for In-Person, ABSENT for `Live Online` (e.g. `"W 09:00 AM - 09:50 AM Live Online"`). Parse location only if `" @ "` is present.
- `<Location>` = free text like `Galbraith Hall Room 242`, `Center Hall Room 105`, `Computer Science and Engineering Buildin Room B260`.
  - ⚠ Building names can be **truncated in the source data** (`"Buildin"` for "Building"). Store the raw string; do NOT try to "correct" it.
  - Parse room as the substring after the last `" Room "` if present; keep the rest as building.
- Robust parse: split modality/location off the END (find `" @ "` → location; the trailing known-modality phrase → modality), then the head is `<Days> <Start> - <End>`. Don't split modality by first space.

**2. Final-exam line:** `Final Examination <MM/DD/YYYY> <StartTime> - <EndTime> <Modality>[ @ <Location>]`
- Present on most in-person **Lecture (`LE`)** rows, but **OPTIONAL even on lectures** (async/online lectures have none).
- Date is US `MM/DD/YYYY` (e.g. `12/09/2026`); times are 12-hour.
- ⚠ **`@ <Location>` tail appeared later** (real line seen 2026-08-11:
  `Final Examination 12/05/2026 11:30 AM - 02:29 PM In Person @ York Hall Room 2622`) —
  all 19 rows of the 2026-07 corpus below predate it and have none. Peel it exactly like a
  meeting line's location; assume `Midterm Examination` lines can carry the same tail.

**3. Midterm-exam line (2026-07-24, user TSS screenshot of CHEM-043A):** `Midterm Examination <MM/DD/YYYY> <StartTime> - <EndTime> <Modality>`
- Seen on the CHEM-043A Lecture row between the meeting line and the final-exam line:
  `F 09:00 AM - 09:50 AM In Person @ York Hall Room 2622\nMidterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person\nFinal Examination 12/05/2026 11:30 AM - 02:29 PM In Person`
- **NOT a weekly meeting** — parser must not surface it as one (it used to become a phantom
  `days: []` meeting). We drop it (kept in `unparsedLines` diagnostics only). Guard generically:
  a meeting line's `<Days>` part must consist solely of day tokens, so any other dated one-off
  (e.g. a hypothetical `Makeup Examination …`) is rejected the same way.

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

## Entity: `YUCSD_I_PREREQ_TREE` — enrollment requirements ⭐ (VERIFIED LIVE 2026-07-24)

The course-detail page has three anchor sections: **Notes | Enrollment Requirements | Class
Sections** (the "Enrollment Requirements" anchor is absent when a course has none). The
requirement data arrives **automatically while the course detail loads** — inside a `$batch`
response (multipart, embedded JSON) fired by the page itself, alongside `YUCSD_I_SM_TITLE`
and before `/_sections`. No extra user action needed → our passive interceptor already
receives it; only the classifier discards it today.

- Embedded JSON `@odata.context` fragment: `YUCSD_I_PREREQ_TREE(moduleid='<ModuleID>',keydate=<YYYY-MM-DD>)/Set`
  — **the moduleid lives in the context string, NOT in the rows**, so the classifier must
  parse the context to attribute rows to a course. `keydate` looked like the term start (2026-09-21).
- Row shape: `{ id, parent_id, text }` — a **flat tree**:
  - roots (`parent_id: ""`, id like `RM10015958`) = requirement groups, text `"1 of the following:"`
  - children (id = parent id + suffix) = alternatives, display-ready text like
    `"CHEM-007L - General Chemistry Laboratory with a 'D' or higher"`
  - multiple roots = AND of groups; children within a group = OR alternatives.
- CHEM-043A (ModuleID **2117**): 7 rows — 2 groups (CHEM-7L/7LM; CHEM-41A/40A/40AH), each "with a 'D' or higher".
- ETHN-001R (ModuleID **5147**): the SAME request still fires and returns `rows: 0` (and the UI
  drops the anchor). Absence of requirements = empty set, not a missing call.
- Fixture: `fixtures/prereq-tree-chem43a.json` (transcribed from the live capture same day).

## Service: `ysd_appttimes` — My Appointment Times ⭐ (VERIFIED LIVE 2026-07-25)

The launchpad's **My Appointment Times** tile (`#YStudent-apptTimes`, listed right under
Schedule of Classes) opens a small Fiori app showing the student's enrollment windows
(First Pass / Second Pass / Instruction Session Enrollment cards with Opens/Closes/Unit
Cap/Waitlists). It is a **separate OData v4 service** from the Schedule of Classes one:

`https://tss.ucsd.edu/sap/opu/odata4/sap/ysb_appttime/srvd/sap/ysd_appttimes/0001/` (`?sap-client=500`)

- All data arrives via **`$batch` POST** (multipart, embedded JSON) fired by the app itself on
  open — URL contains `/odata` → **our passive interceptor already receives it**; only the
  classifier discards it today. Two batches observed: one with the dropdown sets
  (`#defaults`, `#acadYear(...)`, `#acadSess(...)`), one with the payload set
  `#apptPeriods(appointmentTimes(),maxUnits())`.
- `apptPeriods.value[0]` is a per-student row: `academicYear`, `academicSession` (same codes
  as course data — Fall = `'2'`), `keyDate` (term start), `holdLevel`, plus **PII we must
  never store/forward**: `studentObjid`, `studyObjid`, `studentNumber`, `programObjid`.
- `appointmentTimes[]` (expanded nav) — one row per enrollment window ⭐:
  - `timelimit` (code) + `timelimit_Text` (display name). Observed: `9625` "First Pass",
    `9626` "Second Pass" (**TWICE, different date ranges** — window count is variable, never
    hardcode first+second), `9627` "Instruction Session Enrollment". `9624` exists only in
    the maxUnits table (4.00 units) — meaning unknown, never seen as a window.
  - `beginDate`/`beginTime` + `endDate`/`endTime` = **local Pacific wall-clock**;
    `beginTimestamp`/`endTimestamp` = **UTC instants** (authoritative; PT wall-clock 14:00 =
    21:00Z). UI shows "PT" explicitly.
  - `timelimitStatus`: `'U'` (= the UI's "Upcoming" badge) is the only value observed;
    $metadata says just `Edm.String MaxLength=1` (no enum) → open/past codes unverified.
    **Compute status from the timestamps instead of trusting this field.**
  - `waitlists`: display-ready text (`"Allowed"` / `"Not Allowed"`).
- `maxUnits[]` (expanded nav) = lookup table keyed by (`Perid`, `Timelimit`) → `MaxUnits`
  (e.g. Perid 2 × 9625 → `"11.50"`); the UI joins it to each card's Unit Cap. Rows repeat
  per session (Perid 3, 4… same caps for this student).
- Dropdowns for this student contained only 2026/2027 + Fall Quarter → captures are per
  (year, session) shown; re-opening the tile after TSS publishes new terms yields new rows.
- Fixture: `fixtures/appt-times-fall2026.json` (transcribed same day, PII redacted).

## Service: `BC_OVP_BOOKED_MODULES_SRV` — homepage "Booked Courses" ⭐ (VERIFIED LIVE 2026-08-11)

The launchpad homepage (`#YStudent-Overview`, OVP app `yucsd.ovp.student`) shows a
**Booked Courses** card — the student's own enrolled modules. Its data source:

`GET https://tss.ucsd.edu/sap/opu/odata/ited/BC_OVP_BOOKED_MODULES_SRV/ModuleSet` (OData v2)

- Fired on every **full page load** of the homepage only (UI5 SPA — in-page navigation
  re-renders from the cached model; same staleness model as `_sections`).
- **URL 确认（2026-08-19，用户实测）**：首页就是 `https://tss.ucsd.edu/fiori#YStudent-Overview`。
  裸域名 `https://tss.ucsd.edu/` **打不开**。planner 的 "Check bookings" 按钮跳的就是这个 URL；
  一度被改成裸域名（把用户说的"直接打开 tss"误读成裸域名），已改回。**别再动它。**
- URL contains `/odata` → **our passive interceptor already receives it**; the classifier
  discards it today (rows lack `EventPkgOtjid`/`Sched`).
- $metadata: single entity set `ModuleSet`, entity `Module`, key `ModregId`, 15 flat
  properties, **no navigation properties** → strictly module-level, no section/enrollCode
  info anywhere in this service.
- Row shape (live capture, 3 booked courses, Fall 2026):
  - `SmShort: "CHEM-114A"` — exactly our `courseCode` format; `SmStext` = course title.
  - `SmObjid: "00002077"` — **zero-padded** ModuleID; strip leading zeros → the `ModuleID`
    used by `_sections` / deep links.
  - `AcademicYear: "2026"` + `AcademicSession: "002"` (`AcademicSessionText: "Fall
    Quarter"`, `AcademicYearText: "2026/2027"`) — strip zeros from the session → the same
    period code as course data (Fall = `'2'`); year matches `_sections`.
  - `ModregId` = booking-record GUID (row key). Also `Credits`/`CreditUnit` (`"4.00"`/
    `"CRH"`), `ConditionalBooking` (bool — semantics unverified, do not interpret),
    `ScObjid`/`AssignedCg`/`AssignedCgTop` (program/course-group ids — ignore).
- Waitlisted-vs-booked distinction unverified (this student had plain bookings only).
- **⚠ 2026-08-18 发现的分类器盲区（已修）**：这条 feed 是 v2，而 `extractV2Results` 原来只认"整个 body 就是那份 v2 文档"。
  SAP Fiori launchpad 默认把 v2 读操作打包进 **`$batch`**（multipart），那种 body 以 `--batch_…` 开头，
  于是**批量里的 v2 文档整个看不见**——首页明明发了 feed，store 里却永远是空的。v4 那条路径
  （`extractODataCollections`）一直是会扫 `$batch` 的，只有 v2 漏了。现在两边对称了。
  尚未在真机上确认首页到底走的是裸 GET 还是 `$batch`（2026-08-11 那次抓到的是裸 GET）；两种都能吃了。
- **⚠ 2026-08-19 归属规则（batch 里的行必须自证出身）**：`$batch` 的每个 response part **不带请求 URL**，
  所以在 batch 里只能靠**行的形状**认人——而首页同时批了别的服务（已知线索：`EVENT_TIMETABLE_SRV/EventListSet`），
  邻居的行只要碰巧也有 `ModregId`/`SmShort`/`SmObjid` 就会被当成 booked 行，又因为缺 `AcademicYear`/`AcademicSession`
  而全部解析失败 → 写成"空列表"，学生的选课就凭空归零。现在用 OData v2 每行都带的
  `__metadata.type`（`ITED.BC_OVP_BOOKED_MODULES_SRV.Module`）做归属：**有这个字段就以它为准，没有才退回形状判断**（2026-08-11
  那次裸 GET 是有的）。配套规则：**"读到了行但一行都读不懂" ≠ "你没有选课"** —— 只有"读懂了至少一行"或
  "权威来源（整包 v2 + URL 指名 ModuleSet）确实返回零行"才允许写入 `booked`/`bookedAt`。
## Service: `EVENT_TIMETABLE_SRV` — the student's own timetable ⭐ (VERIFIED LIVE 2026-08-19)

`GET /sap/opu/odata/ited/EVENT_TIMETABLE_SRV/EventListSet?$filter=(EventDate ge datetime'2025-01-01T00:00:00' and EventDate le datetime'2027-12-31T00:00:00')` (OData v2)

**这是唯一能回答"我 book 的是哪个 section"的 feed。** booked feed 只到 module 级(15 个字段没有任何
section/package/enrollCode)。这条给的是学生**真正选上的 event**:

- 与 booked feed **同在首页整页加载时触发**(实测同一次 load 里两条都发),所以 planner 的 `Check bookings`
  不需要多开任何页面就能同时拿到两半。进 `#ZUSModule-display …/MyModules` 应用时也会重发一次。
- **一行 = 一次上课**(126 行 / 一个学生 / 2025-2027),同一门周课重复约 10 行 → 去重后才是 event 集合。
- 关键字段:`EventId` `ModuleId`(都是零填充)、`EventName`(`"CHEM-114A-LE (002-000)"`,课号+方式+**section 码**)、
  `EventIsExam`(考试是独立 event,不属于任何 package,必须排除)、`TeachingMethod`(是 `"Lecture"` 这种**显示文本**,
  不是 `LE` 代码)、`StartTime`/`EndTime` 是 `"PT10H00M00S"`,`EventDate` 是 `"/Date(1790294400000)/"`。
- **🔑 `Component.id` === `"E " + EventId`** —— 同一个对象,我们的 section 抓取带类型前缀,课表这边不带。
  2026-08-19 在真实账号上对过两门:CHEM-114A 选的 `E 00001078` ↔ 课表 `00001078`(`002-000-LE`)、
  CHEM-152 `E 00001085` ↔ `00001085`。planner 侧按**数字**比对(`web/src/lib/booked-section.ts`),
  两边谁带前缀都不影响。
- 匹配规则:某门课的"已选 event 集合" ∩ "这门课我们已知的 event" == 某个 package 的 component 集合 → 那就是他 book 的
  package。**只有唯一命中才发声**;多个 package 共用一节 lecture(实测 CHEM-114A 有 8 个 package 共用 2 节 lecture),
  所以只有 lecture 时必然歧义 → 沉默。
- Fixture:`fixtures/timetable-fall2026.json`(第 1-2 行实录,第 3 行按同 schema 合成)。

## Page: `#ZUSModule-display?TileType=MYMOD&…&/MyModules` — "My Courses"(2026-08-19 用户发现)

首页 Booked Courses 卡片可以点进去,进的就是这一页。UI 上**直接写着 book 的包号**:
`CHEM-114A (P-002-004)` + `Fall Quarter 2026/2027` + `Booked` —— 正是我们 `SectionOption.code` 的原文,
比 event 匹配更直接。**但没抓到它的线格式**:模块列表只在 app 冷启动时请求一次,之后走缓存,页面内
hash 跳转和点详情都不再发;而 document_start 那一发抢不到(注入工具会等 load 完)。
所以本轮走的是 `EVENT_TIMETABLE_SRV` 那条路(数据同样跟着首页来,且已实测对齐)。
**若以后要拿这一页**:需要在扩展里加日志,或在 SW 里记录 `ZUSModule` 相关 URL 的响应。

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
