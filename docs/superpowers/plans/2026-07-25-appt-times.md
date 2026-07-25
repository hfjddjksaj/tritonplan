# Appointment Times (选课时间) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the student's own enrollment windows (First Pass / Second Pass / …) as a status-aware capsule in the planner topbar, fed by passively-captured TSS `ysd_appttimes` OData.

**Architecture:** Mirror of the prereq pipeline — the extension's classifier learns the `#apptPeriods(` batch payload it already receives, normalizes it to a PII-free `ApptTimes` shape at ingest, stores per term in `CaptureStore`, and pushes over a new `appt-times` bridge message (also on the existing debounced FLUSH). The web app persists it in its own localStorage slot (independent of all plans), and renders a topbar capsule + popover; all status is computed from UTC instants, displayed in `America/Los_Angeles` with a "PT" label.

**Tech Stack:** TypeScript monorepo (npm workspaces, Node ≥ 20), Chrome MV3 extension, React 18 + Vite, Vitest, puppeteer-core (E2E, scratchpad-only).

**Spec:** `docs/superpowers/specs/2026-07-25-appt-times-design.md`. Recon: `docs/tss-recon/tss-api-notes.md` §"Service: ysd_appttimes"; fixture `docs/tss-recon/fixtures/appt-times-fall2026.json`.

## Global Constraints

- ⛔ **NO-BAN red line:** the extension must never issue, replay, retry, prefetch, or poll a request, and never clicks/submits anything on TSS. This feature only classifies response bodies the interceptor already captures. Preserve the red-line comments in every file touched.
- **PII whitelist:** the wire row carries `studentNumber`, `studentObjid`, `studyObjid`, `programObjid` — none of these may reach `CaptureStore`, `chrome.storage`, the bridge, or web localStorage. Normalization builds output field-by-field (whitelist), never by spread.
- **Privacy:** `ApptTimes` never enters `PlanState`, share links, QR codes, or JSON export. It lives only in `CaptureStore` and the web slot `triton-planner:appt:v1`.
- Message names / bridge sources live in `extension/src/config.ts` (`MSG`, `BRIDGE_SOURCE`) and `web/src/lib/bridge.ts` — never inline these strings elsewhere.
- All user-facing product copy is English; the product name stays "TritonPlan".
- **No version bump** (versions change only at packaging, user decides) and **no push** (user-initiated only). Commit after every task.
- Commands: `npm test` (all workspaces), `npm test -w @triton/extension`, `npm test -w @triton/web`, `npm run typecheck`, `npm run build -w @triton/extension`, `npm run build -w @triton/web`.
- Existing test counts before this plan: 173 (shared 10 / web 114 / extension 49). All must stay green.

## File Structure

| File | Responsibility |
|---|---|
| `shared/src/types.ts` | + `ApptWindow`, `ApptTimes` (contract between halves) |
| `extension/src/parser/tss-types.ts` | + raw wire-row types (`TssApptTimeRow`, `TssApptMaxUnitsRow`, `TssApptPeriodsRow`) |
| `extension/src/lib/extract-odata.ts` | + classify `#apptPeriods(` collections |
| `extension/src/parser/normalize.ts` | + `apptPeriodsToApptTimes` (whitelist mapping + maxUnits join + sort) |
| `extension/src/parser/fixtures.ts` | + `apptPeriodsFixture()` loader |
| `extension/src/lib/capture-to-courses.ts` | + `CaptureStore.apptTimes` map, `getApptTimes()`, serialize compat |
| `extension/src/config.ts` | + `MSG.GET_APPT_TIMES` |
| `extension/src/background/service-worker.ts` | + `GET_APPT_TIMES` handler |
| `extension/src/content/planner-bridge.ts` | + `pushApptTimes()` in `syncAll()` |
| `web/src/lib/bridge.ts` | + `ApptTimesMessage`, `isApptTimesMessage`, `installApptTimesListener` |
| `web/src/lib/storage.ts` | + `triton-planner:appt:v1` slot, `isApptTimesList` guard |
| `web/src/lib/appt.ts` (new) | pure status/pick/format logic |
| `web/src/hooks/useApptTimes.ts` (new) | state + persistence + bridge subscription |
| `web/src/components/ApptCapsule.tsx` (new) | topbar capsule (3 states, minute tick, mobile compact) |
| `web/src/components/ApptPopover.tsx` (new) | portal popover listing all windows |
| `web/src/components/icons.tsx` | + `Clock` icon (if absent) |
| `web/src/components/Topbar.tsx` | + `apptSlot` prop rendered before the unit pill |
| `web/src/App.tsx` | wire `useApptTimes` → `<ApptCapsule>` → Topbar |
| `web/src/styles/app.css` | + `.appt-capsule*`, `.apptpop*` |

---

### Task 1: shared `ApptWindow` / `ApptTimes` types

**Files:**
- Modify: `shared/src/types.ts` (insert after `PrereqGroup`, before `CourseOffering`)

**Interfaces:**
- Produces: `ApptWindow { label: string; beginsAt: string; endsAt: string; unitCap?: string; waitlists?: string }`, `ApptTimes { academicYear: string; academicSession: string; yearText: string; sessionText: string; windows: ApptWindow[]; capturedAt: string }` — every later task imports these from `@triton/shared`.

- [ ] **Step 1: Add the types**

```ts
/** One enrollment window from TSS "My Appointment Times" ("First Pass",
 *  "Second Pass", …). Window count is variable — real captures showed TWO
 *  Second Pass rows; never assume exactly first+second. */
export interface ApptWindow {
  label: string;      // timelimit_Text verbatim, e.g. "First Pass"
  beginsAt: string;   // UTC ISO instant, e.g. "2026-08-10T21:00:00Z"
  endsAt: string;     // UTC ISO instant (inclusive end)
  unitCap?: string;   // joined from the maxUnits table, e.g. "11.50"
  waitlists?: string; // "Allowed" | "Not Allowed" (verbatim)
}

/** The student's appointment times for one (academic year, session). PERSONAL
 *  data: kept only in the extension's store and the planner's own localStorage —
 *  never inside plans, share links, QR codes or exports. */
export interface ApptTimes {
  academicYear: string;    // "2026"
  academicSession: string; // "2" — same code space as Term.period
  yearText: string;        // "2026/2027"
  sessionText: string;     // "Fall Quarter"
  windows: ApptWindow[];   // sorted by beginsAt ascending
  capturedAt: string;      // ISO timestamp of the capture
}
```

- [ ] **Step 2: Verify** — Run: `npm run typecheck` → clean; `npm test` → 173 pass (no behavior change).

- [ ] **Step 3: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(shared): ApptWindow/ApptTimes model for enrollment appointment times"
```

---

### Task 2: extension — classify `apptPeriods` captures

**Files:**
- Modify: `extension/src/parser/tss-types.ts`, `extension/src/lib/extract-odata.ts`, `extension/src/parser/fixtures.ts`
- Test: `extension/src/lib/capture.test.ts`

**Interfaces:**
- Consumes: fixture `docs/tss-recon/fixtures/appt-times-fall2026.json` (top-level `{"@odata.context": "$metadata#apptPeriods(appointmentTimes(),maxUnits())", value: [row]}`).
- Produces: `TssApptTimeRow`, `TssApptMaxUnitsRow`, `TssApptPeriodsRow` (tss-types); `classifyCapture()` result gains `apptPeriods: TssApptPeriodsRow[]`; `apptPeriodsFixture(): { context: string; row: TssApptPeriodsRow }` (fixtures).

- [ ] **Step 1: Write the failing tests** — append to `capture.test.ts` (import `apptPeriodsFixture` from `../parser/fixtures.js`):

```ts
/** A $batch part carrying an apptPeriods collection, as the My Appointment Times app fetches it. */
function apptBatchBody(context: string, rows: unknown[]): string {
  const inner = JSON.stringify({ '@odata.context': context, value: rows });
  return (
    '--batch_id\r\nContent-Type: application/http\r\n\r\nHTTP/1.1 200 OK\r\n' +
    'Content-Type: application/json\r\n\r\n' + inner + '\r\n--batch_id--\r\n'
  );
}

describe('appointment-times classification', () => {
  it('classifies the apptPeriods batch part by context', () => {
    const fx = apptPeriodsFixture();
    const res = classifyCapture(apptBatchBody(fx.context, [fx.row]));
    expect(res.apptPeriods).toHaveLength(1);
    expect(res.apptPeriods[0]!.academicYear).toBe('2026');
    expect(res.apptPeriods[0]!.appointmentTimes).toHaveLength(4);
    expect(res.moduleRows).toHaveLength(0);
    expect(res.sectionRows).toHaveLength(0);
  });

  it('does not classify the same service’s dropdown collections as anything', () => {
    const body = JSON.stringify({
      '@odata.context': '$metadata#acadSess(acSess,acSessText)',
      value: [{ acSess: '2', acSessText: 'Fall Quarter' }],
    });
    const res = classifyCapture(body);
    expect(res.apptPeriods).toHaveLength(0);
    expect(res.moduleRows).toHaveLength(0);
    expect(res.sectionRows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -w @triton/extension -- capture` → FAIL (`apptPeriodsFixture` not exported / `apptPeriods` undefined).

- [ ] **Step 3: Implement.** `tss-types.ts` — append:

```ts
/** One row of ysd_appttimes `appointmentTimes` — an enrollment window. */
export interface TssApptTimeRow {
  timelimit: string;             // "9625"
  timelimit_Text: string;        // "First Pass"
  beginTimestamp: string;        // UTC ISO, e.g. "2026-08-10T21:00:00Z" (authoritative)
  endTimestamp: string;
  waitlists?: string;            // "Allowed" | "Not Allowed"
  academicYear?: string;         // "2026"
  academicYear_Text?: string;    // "2026/2027"
  academicSession?: string;      // "2"
  academicSession_Text?: string; // "Fall Quarter"
}

/** One row of ysd_appttimes `maxUnits` — unit cap by (session, window type). */
export interface TssApptMaxUnitsRow {
  Perid: string;     // academicSession code, e.g. "2"
  Timelimit: string; // e.g. "9625"
  MaxUnits: string;  // "11.50"
}

/** The single per-student `apptPeriods` row. The wire row ALSO carries PII
 *  (studentNumber, studentObjid, studyObjid, programObjid) — deliberately NOT
 *  declared here so no code path can read it; normalize whitelists fields. */
export interface TssApptPeriodsRow {
  academicYear: string;
  academicSession: string;
  appointmentTimes?: TssApptTimeRow[];
  maxUnits?: TssApptMaxUnitsRow[];
}
```

`extract-odata.ts` — import `TssApptPeriodsRow` alongside the other tss-types; add next to the prereq regex:

```ts
/** ysd_appttimes payload: `…$metadata#apptPeriods(appointmentTimes(),maxUnits())`.
 *  Like prereqs it's recognized by @odata.context; the row shape is checked too. */
const APPT_CONTEXT_RE = /#apptPeriods\(/i;

function looksLikeApptPeriodsRow(v: unknown): v is TssApptPeriodsRow {
  return (
    !!v && typeof v === 'object' &&
    'appointmentTimes' in v && 'academicYear' in v && 'academicSession' in v
  );
}
```

Extend `ClassifiedCapture` with `apptPeriods: TssApptPeriodsRow[];` and in `classifyCapture` (before the prereq check, after computing `ctx`):

```ts
    if (typeof ctx === 'string' && APPT_CONTEXT_RE.test(ctx)) {
      apptPeriods.push(...((coll.value ?? []).filter(looksLikeApptPeriodsRow)));
      continue;
    }
```

(declare `const apptPeriods: TssApptPeriodsRow[] = [];` beside the other accumulators and include it in the return object).

`fixtures.ts` — import `TssApptPeriodsRow`, append:

```ts
/** The captured ysd_appttimes apptPeriods row (PII pre-redacted in the fixture file). */
export function apptPeriodsFixture(): { context: string; row: TssApptPeriodsRow } {
  const raw = JSON.parse(readFileSync(resolve(FIX_DIR, 'appt-times-fall2026.json'), 'utf8'));
  return { context: raw['@odata.context'] as string, row: raw.value[0] as TssApptPeriodsRow };
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -w @triton/extension` → all pass (49 existing + 2 new). `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add extension/src/parser/tss-types.ts extension/src/lib/extract-odata.ts extension/src/parser/fixtures.ts extension/src/lib/capture.test.ts
git commit -m "feat(extension): classify passively-captured ysd_appttimes apptPeriods payloads"
```

---

### Task 3: extension — `apptPeriodsToApptTimes` normalizer

**Files:**
- Modify: `extension/src/parser/normalize.ts`
- Test: `extension/src/parser/normalize.test.ts`

**Interfaces:**
- Consumes: `TssApptPeriodsRow` (Task 2), `ApptTimes`/`ApptWindow` (Task 1), `apptPeriodsFixture()` (Task 2).
- Produces: `apptPeriodsToApptTimes(row: TssApptPeriodsRow, capturedAt: string): ApptTimes | null`.

- [ ] **Step 1: Write the failing tests** — append to `normalize.test.ts` (import `apptPeriodsToApptTimes` from `./normalize.js`, `apptPeriodsFixture` from `./fixtures.js`, `TssApptPeriodsRow` type from `./tss-types.js`):

```ts
describe('apptPeriodsToApptTimes', () => {
  const fx = apptPeriodsFixture();

  it('maps the fixture row: windows sorted by begin, unit caps joined, texts taken', () => {
    const appt = apptPeriodsToApptTimes(fx.row, '2026-07-25T12:00:00Z');
    expect(appt).not.toBeNull();
    expect(appt!.academicYear).toBe('2026');
    expect(appt!.academicSession).toBe('2');
    expect(appt!.yearText).toBe('2026/2027');
    expect(appt!.sessionText).toBe('Fall Quarter');
    expect(appt!.capturedAt).toBe('2026-07-25T12:00:00Z');
    // fixture order is 08-10, 09-12, 08-21, 09-28 — output must be begin-sorted
    expect(appt!.windows.map((w) => w.beginsAt.slice(5, 10))).toEqual([
      '08-10', '08-21', '09-12', '09-28',
    ]);
    expect(appt!.windows[0]).toEqual({
      label: 'First Pass',
      beginsAt: '2026-08-10T21:00:00Z',
      endsAt: '2026-08-14T05:59:59Z',
      unitCap: '11.50',
      waitlists: 'Not Allowed',
    });
    expect(appt!.windows[3]!.label).toBe('Instruction Session Enrollment');
    expect(appt!.windows[3]!.unitCap).toBe('22.00');
  });

  it('whitelists output — no PII field can survive', () => {
    const dirty = {
      ...fx.row,
      studentNumber: '200355050',
      studentObjid: '355047',
      studyObjid: '170130',
    } as unknown as TssApptPeriodsRow;
    const appt = apptPeriodsToApptTimes(dirty, '2026-07-25T12:00:00Z')!;
    const json = JSON.stringify(appt);
    expect(json).not.toContain('studentNumber');
    expect(json).not.toContain('200355050');
    expect(json).not.toContain('355047');
    expect(json).not.toContain('170130');
    expect(Object.keys(appt).sort()).toEqual([
      'academicSession', 'academicYear', 'capturedAt', 'sessionText', 'windows', 'yearText',
    ]);
  });

  it('keeps an empty windows list and falls back to code-derived texts', () => {
    const appt = apptPeriodsToApptTimes(
      { academicYear: '2026', academicSession: '3' },
      '2026-07-25T12:00:00Z',
    );
    expect(appt).not.toBeNull();
    expect(appt!.windows).toEqual([]);
    expect(appt!.yearText).toBe('2026');
    expect(appt!.sessionText).toBe('Period 3');
  });

  it('rejects a structurally unusable row', () => {
    expect(apptPeriodsToApptTimes({} as TssApptPeriodsRow, 'x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -w @triton/extension -- normalize` → FAIL (not exported).

- [ ] **Step 3: Implement** — append to `normalize.ts` (import `ApptTimes`, `ApptWindow` from `@triton/shared`; `TssApptPeriodsRow` from `./tss-types.js`):

```ts
/** Map a captured ysd_appttimes `apptPeriods` row to the shared ApptTimes shape.
 *  WHITELIST mapping: only the fields below survive — the wire row also carries
 *  student PII (studentNumber etc.) which must never reach storage or the page.
 *  Returns null when the row is structurally unusable. */
export function apptPeriodsToApptTimes(
  row: TssApptPeriodsRow,
  capturedAt: string,
): ApptTimes | null {
  if (!row || typeof row.academicYear !== 'string' || typeof row.academicSession !== 'string') {
    return null;
  }
  const src = Array.isArray(row.appointmentTimes) ? row.appointmentTimes : [];
  const caps = Array.isArray(row.maxUnits) ? row.maxUnits : [];
  const windows: ApptWindow[] = [];
  for (const at of src) {
    if (typeof at.beginTimestamp !== 'string' || typeof at.endTimestamp !== 'string') continue;
    const cap = caps.find(
      (mu) => mu.Perid === row.academicSession && mu.Timelimit === at.timelimit,
    );
    const w: ApptWindow = {
      label: at.timelimit_Text || 'Enrollment window',
      beginsAt: at.beginTimestamp,
      endsAt: at.endTimestamp,
    };
    if (cap?.MaxUnits) w.unitCap = cap.MaxUnits;
    if (at.waitlists) w.waitlists = at.waitlists;
    windows.push(w);
  }
  windows.sort((a, b) => Date.parse(a.beginsAt) - Date.parse(b.beginsAt));
  const first = src[0];
  return {
    academicYear: row.academicYear,
    academicSession: row.academicSession,
    yearText: first?.academicYear_Text || row.academicYear,
    sessionText: first?.academicSession_Text || `Period ${row.academicSession}`,
    windows,
    capturedAt,
  };
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -w @triton/extension` → all pass. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add extension/src/parser/normalize.ts extension/src/parser/normalize.test.ts
git commit -m "feat(extension): normalize apptPeriods to PII-free ApptTimes (maxUnits join, begin-sorted)"
```

---

### Task 4: extension — `CaptureStore` appointment storage

**Files:**
- Modify: `extension/src/lib/capture-to-courses.ts`
- Test: `extension/src/lib/capture.test.ts`

**Interfaces:**
- Consumes: `classifyCapture().apptPeriods` (Task 2), `apptPeriodsToApptTimes` (Task 3), `apptBatchBody` helper (Task 2's test).
- Produces: `CaptureStore.getApptTimes(): ApptTimes[]` (term-sorted); `StoreShape.apptTimes?: Record<string, ApptTimes>` (serialize compat).

- [ ] **Step 1: Write the failing tests** — append to `capture.test.ts`:

```ts
describe('appointment-times store', () => {
  const fx = apptPeriodsFixture();

  it('ingests an apptPeriods batch and exposes normalized, PII-free appt times', () => {
    const store = new CaptureStore();
    expect(store.ingestBody(apptBatchBody(fx.context, [fx.row]))).toBe(true);
    const appts = store.getApptTimes();
    expect(appts).toHaveLength(1);
    expect(appts[0]!.windows).toHaveLength(4);
    expect(JSON.stringify(store.serialize())).not.toContain('studentNumber');
  });

  it('re-capture of the same term replaces it; other terms coexist', () => {
    const store = new CaptureStore();
    store.ingestBody(apptBatchBody(fx.context, [fx.row]));
    store.ingestBody(
      apptBatchBody(fx.context, [{ ...fx.row, academicSession: '3', appointmentTimes: [] }]),
    );
    store.ingestBody(apptBatchBody(fx.context, [fx.row])); // same term again
    const appts = store.getApptTimes();
    expect(appts).toHaveLength(2);
    expect(appts.map((a) => a.academicSession)).toEqual(['2', '3']);
  });

  it('survives serialize/deserialize and tolerates old persisted stores', () => {
    const store = new CaptureStore();
    store.ingestBody(apptBatchBody(fx.context, [fx.row]));
    const revived = CaptureStore.deserialize(store.serialize());
    expect(revived.getApptTimes()).toHaveLength(1);
    expect(revived.getApptTimes()[0]!.windows[0]!.label).toBe('First Pass');
    const old = CaptureStore.deserialize({ modules: {}, sections: {} });
    expect(old.getApptTimes()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -w @triton/extension -- capture` → FAIL (`getApptTimes` missing).

- [ ] **Step 3: Implement** in `capture-to-courses.ts`:
  - Imports: add `ApptTimes` to the `@triton/shared` type import; add `apptPeriodsToApptTimes` to the `../parser/normalize.js` import.
  - `StoreShape`: add `apptTimes?: Record<string, ApptTimes>;  // by "<year>|<session>"; absent in old stores`.
  - Class field: `private apptTimes = new Map<string, ApptTimes>();` (comment: `/** Student's enrollment windows by term — normalized (PII already stripped). */`).
  - In `ingestBody`, destructure `apptPeriods` too, and after the prereq loop:

```ts
    for (const row of apptPeriods) {
      const appt = apptPeriodsToApptTimes(row, new Date().toISOString());
      if (!appt) continue;
      // latest capture of a term wins (the student re-opened the TSS tile)
      this.apptTimes.set(`${appt.academicYear}|${appt.academicSession}`, appt);
      changed = true;
    }
```

  - New method:

```ts
  /** The student's captured appointment times, one per term, term-sorted. */
  getApptTimes(): ApptTimes[] {
    return [...this.apptTimes.values()].sort(
      (a, b) =>
        a.academicYear.localeCompare(b.academicYear) ||
        a.academicSession.localeCompare(b.academicSession),
    );
  }
```

  - `serialize()`: add `apptTimes: Object.fromEntries(this.apptTimes),`.
  - `deserialize()`: add `fillMap(store.apptTimes, shape.apptTimes);`.

- [ ] **Step 4: Run to verify pass** — `npm test -w @triton/extension` → all pass. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/capture-to-courses.ts extension/src/lib/capture.test.ts
git commit -m "feat(extension): CaptureStore keeps per-term ApptTimes (normalized at ingest)"
```

---

### Task 5: extension — `GET_APPT_TIMES` + bridge push

**Files:**
- Modify: `extension/src/config.ts`, `extension/src/background/service-worker.ts`, `extension/src/content/planner-bridge.ts`

**Interfaces:**
- Consumes: `CaptureStore.getApptTimes()` (Task 4).
- Produces: `MSG.GET_APPT_TIMES = 'tp:get-appt-times'`; the page-facing envelope `{ source: BRIDGE_SOURCE, type: 'appt-times', version: 1, payload: ApptTimes[] }` that Task 6's web validator targets. FLUSH re-push comes free: the SW's existing debounced FLUSH triggers `syncAll()` in planner-bridge, which now includes the appt push.

- [ ] **Step 1: `config.ts`** — add to `MSG` (after `GET_COURSES`):

```ts
  /** any → SW: return the captured ApptTimes[] (student's enrollment windows). */
  GET_APPT_TIMES: 'tp:get-appt-times',
```

- [ ] **Step 2: `service-worker.ts`** — add a case after `MSG.GET_COURSES`:

```ts
    case MSG.GET_APPT_TIMES: {
      (async () => {
        try {
          const store = await getStore();
          sendResponse(store.getApptTimes());
        } catch {
          sendResponse([]);
        }
      })();
      return true;
    }
```

- [ ] **Step 3: `planner-bridge.ts`** — extend the shared-type import to `import type { ApptTimes, CourseOffering } from '@triton/shared';`, add after `pushCourses`:

```ts
/** Post the student's own captured appointment times. Personal data: goes only
 *  to our page (same-window/origin postMessage), never into any plan. */
async function pushApptTimes(): Promise<void> {
  try {
    const appt = await chrome.runtime.sendMessage({ type: MSG.GET_APPT_TIMES });
    if (!Array.isArray(appt) || appt.length === 0) return; // nothing captured — never wipe
    window.postMessage(
      {
        source: BRIDGE_SOURCE,
        type: 'appt-times',
        version: BRIDGE_VERSION,
        payload: appt as ApptTimes[],
      },
      TARGET_ORIGIN,
    );
  } catch {
    /* SW asleep or context gone */
  }
}
```

and make `syncAll` push it: `await pushCourses(); await pushApptTimes(); await flushPlanAdds();`. Also extend the file-top doc comment's message list with `appt-times`.

- [ ] **Step 4: Verify** — `npm run typecheck` → clean; `npm test -w @triton/extension` → all pass; `npm run build -w @triton/extension` → succeeds (the wire contract itself is asserted by Task 6's web tests + Task 9's E2E).

- [ ] **Step 5: Commit**

```bash
git add extension/src/config.ts extension/src/background/service-worker.ts extension/src/content/planner-bridge.ts
git commit -m "feat(extension): push appt-times over the planner bridge (incl. FLUSH re-push)"
```

---

### Task 6: web — bridge validator + storage slot

**Files:**
- Modify: `web/src/lib/bridge.ts`, `web/src/lib/storage.ts`
- Test: `web/src/lib/bridge.test.ts`, `web/src/lib/storage.test.ts`

**Interfaces:**
- Consumes: `ApptTimes` (Task 1); the envelope from Task 5.
- Produces: `isApptTimesList(v): v is ApptTimes[]`, `saveApptTimes(a: ApptTimes[])`, `loadApptTimes(): ApptTimes[] | null` (storage); `isApptTimesMessage(data)`, `installApptTimesListener(onApptTimes: (a: ApptTimes[]) => void): () => void` (bridge).

- [ ] **Step 1: Write the failing tests.** Shared test fixture (top of each new describe):

```ts
const APPT: ApptTimes = {
  academicYear: '2026',
  academicSession: '2',
  yearText: '2026/2027',
  sessionText: 'Fall Quarter',
  capturedAt: '2026-07-25T12:00:00Z',
  windows: [
    { label: 'First Pass', beginsAt: '2026-08-10T21:00:00Z', endsAt: '2026-08-14T05:59:59Z', unitCap: '11.50', waitlists: 'Not Allowed' },
    { label: 'Second Pass', beginsAt: '2026-08-21T17:00:00Z', endsAt: '2026-08-27T05:59:59Z', unitCap: '19.50', waitlists: 'Allowed' },
  ],
};
```

`storage.test.ts` — append:

```ts
describe('appointment-times slot', () => {
  it('round-trips through localStorage', () => {
    saveApptTimes([APPT]);
    expect(loadApptTimes()).toEqual([APPT]);
  });

  it('rejects corrupt or wrong-shaped values', () => {
    localStorage.setItem('triton-planner:appt:v1', 'not json');
    expect(loadApptTimes()).toBeNull();
    localStorage.setItem(
      'triton-planner:appt:v1',
      JSON.stringify([{ ...APPT, windows: [{ label: 1 }] }]),
    );
    expect(loadApptTimes()).toBeNull();
  });
});
```

`bridge.test.ts` — append a describe that mirrors the file's existing message-dispatch pattern for `courses` (reuse its post/dispatch helper verbatim):

```ts
describe('appt-times bridge', () => {
  it('accepts a valid appt-times envelope', () => {
    expect(
      isApptTimesMessage({
        source: 'triton-planner-extension',
        type: 'appt-times',
        version: 1,
        payload: [APPT],
      }),
    ).toBe(true);
  });

  it('rejects wrong source/type/payload', () => {
    expect(isApptTimesMessage({ source: 'evil', type: 'appt-times', version: 1, payload: [APPT] })).toBe(false);
    expect(isApptTimesMessage({ source: 'triton-planner-extension', type: 'appt-times', version: 1, payload: [{ nope: 1 }] })).toBe(false);
    expect(isApptTimesMessage({ source: 'triton-planner-extension', type: 'courses', version: 1, payload: [APPT] })).toBe(false);
  });

  it('installApptTimesListener fires on valid messages only', /* async if the file’s
     existing dispatch helper is async */ () => {
    // Mirror the exact same-window/same-origin dispatch used by the courses tests
    // in this file; assert the callback got [APPT] once, and that a forged-source
    // message does not fire it. Unsubscribe and assert no further calls.
  });
});
```

(The third test's body must be real code copied from the file's existing `installBridgeListener` tests — same helper, same async handling — targeting `installApptTimesListener`.)

- [ ] **Step 2: Run to verify failure** — `npm test -w @triton/web -- storage` and `npm test -w @triton/web -- bridge` → FAIL (missing exports).

- [ ] **Step 3: Implement.** `storage.ts` — import `ApptTimes` in the shared type import, append:

```ts
/* ---- appointment times (the student's own enrollment windows) --------------
   Personal data, global to this browser: NOT part of any plan, never included
   in share links, QR codes or exports. Latest extension push wins. */

const APPT_KEY = 'triton-planner:appt:v1';

function isApptWindow(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.label === 'string' && typeof v.beginsAt === 'string' && typeof v.endsAt === 'string'
  );
}

export function isApptTimesList(value: unknown): value is ApptTimes[] {
  return (
    Array.isArray(value) &&
    value.every((a) => {
      if (!a || typeof a !== 'object') return false;
      const v = a as Record<string, unknown>;
      return (
        typeof v.academicYear === 'string' &&
        typeof v.academicSession === 'string' &&
        typeof v.yearText === 'string' &&
        typeof v.sessionText === 'string' &&
        typeof v.capturedAt === 'string' &&
        Array.isArray(v.windows) &&
        v.windows.every(isApptWindow)
      );
    })
  );
}

export function saveApptTimes(appt: ApptTimes[]): void {
  writeJson(APPT_KEY, appt);
}

export function loadApptTimes(): ApptTimes[] | null {
  return readJson(APPT_KEY, isApptTimesList);
}
```

`bridge.ts` — import `ApptTimes` type from `@triton/shared` and `isApptTimesList` from `./storage`, append after the plan-add validator:

```ts
/** Envelope for the student's own appointment times (personal — never part of plans). */
export interface ApptTimesMessage {
  source: typeof BRIDGE_SOURCE;
  type: 'appt-times';
  version: 1;
  payload: ApptTimes[];
}

/** Validate an `appt-times` envelope (payload shape-checked per item). */
export function isApptTimesMessage(data: unknown): data is ApptTimesMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  if (m.source !== BRIDGE_SOURCE || m.type !== 'appt-times' || m.version !== 1) return false;
  return isApptTimesList(m.payload);
}

/** Same-window/same-origin listener for `appt-times` pushes. Separate from
 *  installBridgeListener so the appt hook subscribes independently of usePlan. */
export function installApptTimesListener(
  onApptTimes: (appt: ApptTimes[]) => void,
): () => void {
  const handler = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (isApptTimesMessage(event.data)) onApptTimes(event.data.payload);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -w @triton/web` → all pass. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/bridge.ts web/src/lib/storage.ts web/src/lib/bridge.test.ts web/src/lib/storage.test.ts
git commit -m "feat(web): appt-times bridge message + private localStorage slot"
```

---

### Task 7: web — pure appt logic (`lib/appt.ts`)

**Files:**
- Create: `web/src/lib/appt.ts`
- Test: `web/src/lib/appt.test.ts`

**Interfaces:**
- Produces: `type ApptStatus = 'upcoming' | 'open' | 'ended'`; `apptWindowStatus(w: ApptWindow, now: Date): ApptStatus`; `nextRelevantWindow(appt: ApptTimes, now: Date): ApptWindow | null`; `pickDisplayTerm(list: ApptTimes[], now: Date): ApptTimes | null`; `formatApptInstant(iso: string): string` (PT wall clock, no "PT" suffix — callers append it).

- [ ] **Step 1: Write the failing tests** — `web/src/lib/appt.test.ts` (reuse the `APPT` fixture literal from Task 6):

```ts
import { describe, it, expect } from 'vitest';
import type { ApptTimes } from '@triton/shared';
import { apptWindowStatus, formatApptInstant, nextRelevantWindow, pickDisplayTerm } from './appt';

const W1 = { label: 'First Pass', beginsAt: '2026-08-10T21:00:00Z', endsAt: '2026-08-14T05:59:59Z' };
const W2 = { label: 'Second Pass', beginsAt: '2026-08-21T17:00:00Z', endsAt: '2026-08-27T05:59:59Z' };
const term = (over: Partial<ApptTimes>): ApptTimes => ({
  academicYear: '2026', academicSession: '2', yearText: '2026/2027',
  sessionText: 'Fall Quarter', capturedAt: '2026-07-25T12:00:00Z',
  windows: [W1, W2], ...over,
});

describe('apptWindowStatus', () => {
  it('is inclusive at both bounds', () => {
    expect(apptWindowStatus(W1, new Date('2026-08-10T20:59:59Z'))).toBe('upcoming');
    expect(apptWindowStatus(W1, new Date('2026-08-10T21:00:00Z'))).toBe('open');
    expect(apptWindowStatus(W1, new Date('2026-08-14T05:59:59Z'))).toBe('open');
    expect(apptWindowStatus(W1, new Date('2026-08-14T06:00:00Z'))).toBe('ended');
  });
});

describe('nextRelevantWindow', () => {
  it('features the first not-ended window (open beats later upcoming)', () => {
    expect(nextRelevantWindow(term({}), new Date('2026-07-25T00:00:00Z'))!.label).toBe('First Pass');
    expect(nextRelevantWindow(term({}), new Date('2026-08-11T00:00:00Z'))!.label).toBe('First Pass');
    expect(nextRelevantWindow(term({}), new Date('2026-08-15T00:00:00Z'))!.label).toBe('Second Pass');
    expect(nextRelevantWindow(term({}), new Date('2026-09-01T00:00:00Z'))).toBeNull();
  });
});

describe('pickDisplayTerm', () => {
  const fall = term({});
  const winter = term({
    academicSession: '3', sessionText: 'Winter Quarter', capturedAt: '2026-07-26T12:00:00Z',
    windows: [{ label: 'First Pass', beginsAt: '2026-11-10T22:00:00Z', endsAt: '2026-11-13T22:00:00Z' }],
  });

  it('prefers the term whose next window begins soonest', () => {
    expect(pickDisplayTerm([winter, fall], new Date('2026-07-25T00:00:00Z'))).toBe(fall);
  });
  it('skips all-ended terms while any live one exists', () => {
    expect(pickDisplayTerm([fall, winter], new Date('2026-10-01T00:00:00Z'))).toBe(winter);
  });
  it('falls back to the freshest capture when everything ended', () => {
    expect(pickDisplayTerm([fall, winter], new Date('2027-01-01T00:00:00Z'))).toBe(winter);
    expect(pickDisplayTerm([], new Date())).toBeNull();
  });
});

describe('formatApptInstant', () => {
  it('renders the Pacific wall clock (PDT in August)', () => {
    expect(formatApptInstant('2026-08-10T21:00:00Z')).toBe('8/10 2:00 PM');
    expect(formatApptInstant('2026-08-14T05:59:59Z')).toBe('8/13 10:59 PM');
  });
  it('returns empty on garbage', () => {
    expect(formatApptInstant('nope')).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -w @triton/web -- appt` → FAIL (module missing).

- [ ] **Step 3: Implement** — `web/src/lib/appt.ts`:

```ts
/** Pure logic for the student's enrollment-appointment windows: status by
 *  clock, which term/window the topbar capsule features, PT-anchored display.
 *  Comparisons use the UTC instants; display uses America/Los_Angeles (with an
 *  explicit "PT" label appended by callers) — matching how TSS shows them,
 *  regardless of the device's timezone. Status is computed from timestamps,
 *  never from TSS's timelimitStatus (only 'U' was ever observed). */
import type { ApptTimes, ApptWindow } from '@triton/shared';

export type ApptStatus = 'upcoming' | 'open' | 'ended';

/** Window status at `now` — [beginsAt, endsAt] inclusive is open. */
export function apptWindowStatus(w: ApptWindow, now: Date): ApptStatus {
  const t = now.getTime();
  if (t < Date.parse(w.beginsAt)) return 'upcoming';
  if (t <= Date.parse(w.endsAt)) return 'open';
  return 'ended';
}

/** The window the capsule features: the earliest not-yet-ended one (windows are
 *  begin-sorted, so an open window wins over a later upcoming one). */
export function nextRelevantWindow(appt: ApptTimes, now: Date): ApptWindow | null {
  for (const w of appt.windows) {
    if (apptWindowStatus(w, now) !== 'ended') return w;
  }
  return null;
}

/** Which captured term to show: the one whose next not-ended window begins
 *  soonest; if every term is over (or empty), the most recently captured. */
export function pickDisplayTerm(list: ApptTimes[], now: Date): ApptTimes | null {
  let best: ApptTimes | null = null;
  let bestBegin = Infinity;
  for (const a of list) {
    const next = nextRelevantWindow(a, now);
    if (!next) continue;
    const begin = Date.parse(next.beginsAt);
    if (begin < bestBegin) {
      best = a;
      bestBegin = begin;
    }
  }
  if (best) return best;
  return [...list].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0] ?? null;
}

const PT_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', month: 'numeric', day: 'numeric',
});
const PT_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit',
});

/** "8/10 2:00 PM" — Pacific wall clock; callers append the "PT" label. */
export function formatApptInstant(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${PT_DATE.format(d)} ${PT_TIME.format(d)}`;
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -w @triton/web` → all pass. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/appt.ts web/src/lib/appt.test.ts
git commit -m "feat(web): appt status/pick/format logic (UTC compare, PT display)"
```

---

### Task 8: web — hook, capsule, popover, wiring, CSS

**Files:**
- Create: `web/src/hooks/useApptTimes.ts`, `web/src/components/ApptCapsule.tsx`, `web/src/components/ApptPopover.tsx`
- Modify: `web/src/components/icons.tsx`, `web/src/components/Topbar.tsx`, `web/src/App.tsx`, `web/src/styles/app.css`

**Interfaces:**
- Consumes: Task 6 (`installApptTimesListener`, `loadApptTimes`, `saveApptTimes`), Task 7 (all four functions), existing `useEscapeKey`, `useIsMobile`, `relativeTime`, `createPortal` pattern from `PrereqPopover.tsx`, `.mappop*` CSS shell.
- Produces: `useApptTimes(): ApptTimes[]`; `<ApptCapsule appt={ApptTimes[]} />`; Topbar prop `apptSlot?: ReactNode`.

- [ ] **Step 1: `useApptTimes.ts`**

```ts
import { useEffect, useState } from 'react';
import type { ApptTimes } from '@triton/shared';
import { installApptTimesListener } from '../lib/bridge';
import { loadApptTimes, saveApptTimes } from '../lib/storage';

/** The student's own appointment times: hydrated from localStorage, live-updated
 *  by extension pushes (which are also persisted). Global — independent of plans
 *  and of the received/read-only view. */
export function useApptTimes(): ApptTimes[] {
  const [appt, setAppt] = useState<ApptTimes[]>(() => loadApptTimes() ?? []);
  useEffect(() => {
    return installApptTimesListener((incoming) => {
      if (incoming.length === 0) return; // defense-in-depth: a push never wipes
      setAppt(incoming);
      saveApptTimes(incoming);
    });
  }, []);
  return appt;
}
```

- [ ] **Step 2: `Clock` icon** — `rg "Clock" web/src/components/icons.tsx`; if absent, add one following the file's existing icon component pattern (same props/signature as `Trash`), body:

```tsx
<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
  <circle cx="12" cy="12" r="9" />
  <path d="M12 7v5l3 2" />
</svg>
```

- [ ] **Step 3: `ApptPopover.tsx`** (portal to `<body>` — card/topbar ancestors form fixed containing blocks, same trap PrereqPopover documents):

```tsx
import { createPortal } from 'react-dom';
import type { ApptTimes } from '@triton/shared';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { apptWindowStatus, formatApptInstant, type ApptStatus } from '../lib/appt';
import { relativeTime } from '../lib/format';
import { X } from './icons';

interface Props {
  appt: ApptTimes;
  onClose: () => void;
}

const STATUS_LABEL: Record<ApptStatus, string> = {
  upcoming: 'Upcoming', open: 'Open now', ended: 'Ended',
};

/** Every enrollment window of the shown term, with live status. Rendered from
 *  passively captured data; refreshing = reopening the TSS tile. */
export function ApptPopover({ appt, onClose }: Props) {
  useEscapeKey(onClose);
  const now = new Date();
  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop apptpop"
        role="dialog"
        aria-modal="true"
        aria-label="Your appointment times"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
        <div className="eyebrow">Appointment times</div>
        <div className="apptpop__term">{appt.sessionText} {appt.yearText}</div>

        {appt.windows.length === 0 ? (
          <p className="apptpop__none">No enrollment windows listed for this term yet.</p>
        ) : (
          <div className="apptpop__list">
            {appt.windows.map((w, i) => {
              const status = apptWindowStatus(w, now);
              return (
                <div key={`${w.label}-${w.beginsAt}-${i}`} className={`apptpop__win apptpop__win--${status}`}>
                  <div className="apptpop__winhead">
                    <span className="apptpop__label">{w.label}</span>
                    <span className={`apptpop__status apptpop__status--${status}`}>
                      {STATUS_LABEL[status]}
                    </span>
                  </div>
                  <div className="apptpop__times mono">
                    {formatApptInstant(w.beginsAt)} – {formatApptInstant(w.endsAt)} PT
                  </div>
                  {(w.unitCap || w.waitlists) && (
                    <div className="apptpop__meta">
                      {w.unitCap && <span>Unit cap {w.unitCap}</span>}
                      {w.waitlists && <span>Waitlists: {w.waitlists}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="mappop__hint">
          Captured {relativeTime(appt.capturedAt, now) || 'earlier'} — reopen “My Appointment
          Times” in TSS to refresh. Times shown in Pacific Time, as in TSS. Yours only: never
          part of plans, share links or QR codes.
        </p>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: `ApptCapsule.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { ApptTimes } from '@triton/shared';
import { apptWindowStatus, formatApptInstant, nextRelevantWindow, pickDisplayTerm } from '../lib/appt';
import { useIsMobile } from '../hooks/useIsMobile';
import { ApptPopover } from './ApptPopover';
import { Clock } from './icons';

interface Props {
  appt: ApptTimes[];
}

/** Topbar capsule for the student's next enrollment window: "First Pass ·
 *  8/10 2:00 PM PT", gold while a window is open, dimmed once all have ended.
 *  Renders NOTHING when no data was ever captured (old extension / tile never
 *  opened / no extension) — zero noise. */
export function ApptCapsule({ appt }: Props) {
  const [open, setOpen] = useState(false);
  // Minute tick so upcoming→open→ended flips without a reload (matches the
  // seats-age ticker convention in CourseCard).
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const isMobile = useIsMobile();

  const now = new Date();
  const term = pickDisplayTerm(appt, now);
  if (!term) return null;

  const next = nextRelevantWindow(term, now);
  const status = next ? apptWindowStatus(next, now) : 'ended';

  let text: string;
  if (!next) text = 'Enrollment ended';
  else if (status === 'open') text = isMobile ? 'open now' : `${next.label} · open now`;
  else if (isMobile) text = formatApptInstant(next.beginsAt).split(' ')[0]!; // "8/10"
  else text = `${next.label} · ${formatApptInstant(next.beginsAt)} PT`;

  return (
    <>
      <button
        type="button"
        className={
          'appt-capsule' +
          (status === 'open' ? ' appt-capsule--open' : '') +
          (next ? '' : ' appt-capsule--ended')
        }
        title="Your enrollment appointment times"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Clock size={13} />
        <span className="appt-capsule__text">{text}</span>
      </button>
      {open && <ApptPopover appt={term} onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 5: Topbar + App wiring.** `Topbar.tsx`: add prop `apptSlot?: ReactNode;` to `Props` and destructure it; render between the spacer and the unit pill:

```tsx
      <div className="topbar__spacer" />
      {apptSlot}
      <div className="unit-pill" title="Total units of added courses">
```

`App.tsx`: `import { useApptTimes } from './hooks/useApptTimes';` and `import { ApptCapsule } from './components/ApptCapsule';`; inside the component `const appt = useApptTimes();`; pass to Topbar: `apptSlot={<ApptCapsule appt={appt} />}`. (The capsule intentionally also shows in the received/read-only view — it is the viewer's own data, not part of any plan.)

- [ ] **Step 6: CSS** — first check tokens: `rg -- "--gold" web/src/styles/app.css` and read the `:root` block; use the SAME gold token the now-line/received banner uses (substitute the real names for `var(--gold*)` below if they differ). Append:

```css
/* ---- enrollment appointment-times capsule + popover ---- */
.appt-capsule {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.appt-capsule:hover { border-color: var(--ink); }
.appt-capsule--open {
  border-color: var(--gold);
  background: color-mix(in srgb, var(--gold) 18%, transparent);
}
.appt-capsule--ended { opacity: 0.55; }

.apptpop { max-width: 420px; }
.apptpop__term { font-weight: 700; font-size: 15px; margin: 2px 0 10px; }
.apptpop__list { display: grid; gap: 8px; }
.apptpop__win {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
}
.apptpop__win--open { border-color: var(--gold); }
.apptpop__win--ended { opacity: 0.55; }
.apptpop__winhead { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.apptpop__label { font-weight: 700; font-size: 13px; }
.apptpop__status { font-size: 11px; letter-spacing: 0.02em; }
.apptpop__status--open { color: var(--gold-ink, var(--ink)); font-weight: 700; }
.apptpop__times { font-size: 12px; margin-top: 3px; }
.apptpop__meta { display: flex; gap: 12px; font-size: 11px; opacity: 0.8; margin-top: 3px; }
.apptpop__none { font-size: 13px; opacity: 0.8; }

@media (max-width: 760px) {
  .appt-capsule { padding: 4px 8px; }
  .appt-capsule__text { max-width: 72px; overflow: hidden; text-overflow: ellipsis; }
}
```

- [ ] **Step 7: Verify** — `npm run typecheck` → clean; `npm test` → all pass; `npm run build -w @triton/web` → succeeds. Dev-server smoke: `npm run dev -w @triton/web`, open http://localhost:5173 — **no capsule renders** (no data yet); paste in the browser console:

```js
window.postMessage({ source: 'triton-planner-extension', type: 'appt-times', version: 1,
  payload: [{ academicYear: '2026', academicSession: '2', yearText: '2026/2027',
    sessionText: 'Fall Quarter', capturedAt: new Date().toISOString(),
    windows: [{ label: 'First Pass', beginsAt: '2026-08-10T21:00:00Z',
      endsAt: '2026-08-14T05:59:59Z', unitCap: '11.50', waitlists: 'Not Allowed' }] }] },
  location.origin);
```

→ capsule appears reading `First Pass · 8/10 2:00 PM PT`; click → popover; reload → still there (localStorage).

- [ ] **Step 8: Commit**

```bash
git add web/src/hooks/useApptTimes.ts web/src/components/ApptCapsule.tsx web/src/components/ApptPopover.tsx web/src/components/icons.tsx web/src/components/Topbar.tsx web/src/App.tsx web/src/styles/app.css
git commit -m "feat(web): appointment-times topbar capsule + popover (status-aware, private)"
```

---

### Task 9: E2E verification (puppeteer, scratchpad-only)

**Files:**
- Create (scratchpad, NOT the repo): `<scratchpad>/appt-e2e.mjs`
- No repo changes; screenshots land in the scratchpad.

**Interfaces:**
- Consumes: the running planner (`npm run dev -w @triton/web` → http://localhost:5173) and the Task 5/6 envelope contract.

- [ ] **Step 1: Setup** — in the scratchpad dir: `npm init -y && npm i puppeteer-core` (house convention: throwaway deps never enter the repo). Launch local Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` (fall back to `where chrome` if absent).

- [ ] **Step 2: Script** — `appt-e2e.mjs` asserting, in order (each step logs PASS/FAIL, exits 1 on any FAIL; screenshots after each phase):

```js
import puppeteer from 'puppeteer-core';

const URL = 'http://localhost:5173/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APPT = (windows) => [{
  academicYear: '2026', academicSession: '2', yearText: '2026/2027',
  sessionText: 'Fall Quarter', capturedAt: new Date().toISOString(), windows,
}];
const FOUR = [
  { label: 'First Pass', beginsAt: '2026-08-10T21:00:00Z', endsAt: '2026-08-14T05:59:59Z', unitCap: '11.50', waitlists: 'Not Allowed' },
  { label: 'Second Pass', beginsAt: '2026-08-21T17:00:00Z', endsAt: '2026-08-27T05:59:59Z', unitCap: '19.50', waitlists: 'Allowed' },
  { label: 'Second Pass', beginsAt: '2026-09-12T07:00:00Z', endsAt: '2026-09-28T06:59:59Z', unitCap: '19.50', waitlists: 'Allowed' },
  { label: 'Instruction Session Enrollment', beginsAt: '2026-09-28T07:00:00Z', endsAt: '2026-10-10T06:59:59Z', unitCap: '22.00', waitlists: 'Allowed' },
];
const post = (page, payload) => page.evaluate((p) => {
  window.postMessage({ source: 'triton-planner-extension', type: 'appt-times', version: 1, payload: p }, location.origin);
}, payload);
const capsuleText = (page) => page.$eval('.appt-capsule', (el) => el.textContent).catch(() => null);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(ok ? 'PASS' : 'FAIL', name); };

await page.goto(URL, { waitUntil: 'networkidle0' });
check('no capsule without data', (await capsuleText(page)) === null);

await post(page, APPT(FOUR));
await new Promise((r) => setTimeout(r, 300));
check('capsule shows next window', (await capsuleText(page))?.includes('First Pass · 8/10 2:00 PM PT') === true);

await page.click('.appt-capsule');
await page.waitForSelector('.apptpop');
check('popover lists 4 windows', (await page.$$eval('.apptpop__win', (els) => els.length)) === 4);
check('popover term header', (await page.$eval('.apptpop__term', (el) => el.textContent)) === 'Fall Quarter 2026/2027');
check('first window meta', (await page.$eval('.apptpop__win', (el) => el.textContent))?.includes('11.50'));
await page.screenshot({ path: 'appt-popover.png' });
await page.keyboard.press('Escape');
check('esc closes popover', (await page.$('.apptpop')) === null);

await page.reload({ waitUntil: 'networkidle0' });
check('capsule persists across reload', (await capsuleText(page)) !== null);

// open-now highlight: a window spanning "now"
const nowWin = [{ label: 'First Pass', beginsAt: new Date(Date.now() - 3600e3).toISOString(), endsAt: new Date(Date.now() + 3600e3).toISOString() }];
await post(page, APPT(nowWin));
await new Promise((r) => setTimeout(r, 300));
check('open window highlighted', await page.$eval('.appt-capsule', (el) => el.classList.contains('appt-capsule--open') && el.textContent.includes('open now')));

// all-ended dimming
const endedWin = [{ label: 'First Pass', beginsAt: '2025-08-10T21:00:00Z', endsAt: '2025-08-14T05:59:59Z' }];
await post(page, APPT(endedWin));
await new Promise((r) => setTimeout(r, 300));
check('all ended → dimmed capsule', await page.$eval('.appt-capsule', (el) => el.classList.contains('appt-capsule--ended') && el.textContent.includes('Enrollment ended')));

// forged source must be ignored
await page.evaluate(() => {
  window.postMessage({ source: 'evil', type: 'appt-times', version: 1, payload: [] }, location.origin);
});
await new Promise((r) => setTimeout(r, 300));
check('forged message ignored', (await capsuleText(page))?.includes('Enrollment ended') === true);

await page.screenshot({ path: 'appt-final.png' });
await browser.close();
if (results.some(([, ok]) => !ok)) process.exit(1);
```

- [ ] **Step 3: Run** — with the dev server up: `node appt-e2e.mjs` → every line PASS. Eyeball both screenshots (capsule placement next to the unit pill; popover layout). If the localStorage of the dev origin already has appt data from Task 8's smoke test, clear it first via DevTools or `page.evaluate(() => localStorage.removeItem('triton-planner:appt:v1'))` before the first assertion.

- [ ] **Step 4: Mobile spot-check** — add `await page.setViewport({ width: 390, height: 844 })` variant run (fresh context): capsule shows the compact `8/10` text and does not overflow the topbar. Screenshot `appt-mobile.png`.

- [ ] **Step 5: No commit needed** (scratchpad only). If any FAIL exposed a real bug, fix in the owning task's files, re-run that task's tests, commit the fix with a `fix(web): …` message, and re-run this script.

---

### Task 10: docs, PROGRESS, final green run

**Files:**
- Modify: `README.md` + the Chinese README (check exact filename with `ls *.md`), `docs/store-listing.md` (local-only file), `PROGRESS.md` (local-only file)

- [ ] **Step 1: READMEs** — add one bullet to each feature list (keep each README's existing voice):
  - EN: `- **Your appointment times** — the "My Appointment Times" windows (First Pass, Second Pass, …) captured from TSS show as a live capsule in the planner topbar, so you always know when you can enroll. Private: never part of shared plans.`
  - ZH（对应位置，产品名保持英文）: `- **选课时间**——从 TSS "My Appointment Times" 被动捕获的 First Pass / Second Pass 等窗口常驻 planner 顶栏，随时知道自己什么时候能选课。完全私有：绝不进入分享的 plan。`

- [ ] **Step 2: `docs/store-listing.md`** — append to the What's new draft for the NEXT extension version (no version number chosen — that happens at packaging): `See your enrollment appointment times right in the planner: open "My Appointment Times" in TSS once and the planner topbar shows your next window (First Pass, Second Pass, …), live.`

- [ ] **Step 3: `PROGRESS.md`** — new dated section summarizing: feature shipped behind extension release; what's web-only vs extension-side; test counts; the release-split reminder (web push即生效；扩展归下一版，老用户升级后需刷新已开 TSS 页并重开一次 tile).

- [ ] **Step 4: Final green run** — `npm run typecheck` && `npm test` && `npm run build -w @triton/web` && `npm run build -w @triton/extension` → all clean/green. Record the new total test count in PROGRESS.md.

- [ ] **Step 5: Commit**

```bash
git add README.md README.zh*.md
git commit -m "docs: appointment-times feature in README feature lists"
```

(`PROGRESS.md`, `docs/store-listing.md` are gitignored — edits stay local by design.)

---

## Self-Review Notes (done at plan time)

- **Spec coverage:** shared model → T1; classifier → T2; normalize+PII → T3; store+serialize compat → T4; MSG/SW/bridge push + FLUSH → T5; web validator/slot → T6; status/pick/PT logic → T7; capsule 3 states + hidden-when-empty + popover + mobile + received-view visibility → T8; E2E incl. forged-message rejection → T9; release-split docs → T10. Spec's "web can ship first" holds: T1–T8 leave the site fully functional with zero capsule until data arrives.
- **Type consistency:** `ApptTimes`/`ApptWindow` (T1) consumed verbatim in T3–T8; `getApptTimes` (T4) ↔ SW (T5); envelope `type: 'appt-times'` (T5) ↔ validator (T6); `installApptTimesListener` (T6) ↔ hook (T8); `ApptStatus` exported (T7) ↔ popover import (T8).
- **Known judgment calls:** empty-payload pushes are skipped on BOTH sides (bridge doesn't send, hook ignores) so a fresh-profile extension can never wipe good web data; `.appt-capsule--open` uses `color-mix` (supported in all browsers that run this app; verify the gold token name in Step 6 of T8).
