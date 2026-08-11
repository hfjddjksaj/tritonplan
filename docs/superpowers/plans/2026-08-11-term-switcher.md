# Term Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the static "Term: Fall 2026" into a term switcher: per-term workspaces (each with its own plans + per-plan browsed lists), auto-routing of captured courses by their term, read-only archiving of past terms, and a plan-picker popup for `plan-add` when the target term has multiple plans.

**Architecture:** Web-only (`web/` — zero extension changes, zero new network calls). A new outer container `TermsState { activeTermKey, terms: Record<TermKey, TermWorkspace> }` wraps the existing `PlansState` per term; all `plans.ts` pure functions are reused unchanged inside a workspace. All SAP-period knowledge (season codes, display labels, archive boundaries) lives in ONE new pure module `web/src/lib/terms.ts`. The browsed pool array becomes a pure course-object repository; each `NamedPlan` gets its own `browsed: string[]` id list.

**Tech Stack:** React 18 + Vite, TypeScript strict (`noUncheckedIndexedAccess`), Vitest (colocated `*.test.ts`), lz-string share formats (untouched).

**Spec:** `docs/superpowers/specs/2026-08-10-term-switcher-design.md` — read it first; §2 has the decision table.

## Global Constraints

- **NO-BAN red line untouched**: no extension file changes, no new requests anywhere. The only extension interaction is posting the ALREADY-SHIPPED `forget-courses` message (extension ≥1.0.2 handles it).
- **Do not guess SAP codes**: only `'2' = Fall` (verified 2026-07) and `'3' = Winter` (appt fixture evidence) may be mapped. Everything else goes through fallbacks.
- **Display-year rule (user decision, global)**: Winter shows the academic-year START year — the winter after Fall 2026 displays "Winter 2026" (it runs Jan–Mar 2027). All other seasons show the calendar year. Display-layer only; stored `Term.year/period` and share payloads are never rewritten.
- `term.year` is treated as the **calendar year of the quarter itself** until verified against real Winter data (expected Nov 2026). If SAP turns out to use academic years, only `terms.ts` changes.
- Share formats (`share.ts`, `share-v3.ts`) must not change — their existing tests passing unchanged is the regression proof.
- Product copy stays English. Version numbers unchanged. Never push — the user pushes after previewing locally (start `npm run dev -w @triton/web` for them at the end).
- Storage keys `plan:v1` / `plans:v1` are rollback backstops after migration: read once, never written again, never deleted.
- Commit after every task (the messages are given). All commands run from repo root.

**Existing code you build on (exact anchors):**
- `shared/src/types.ts` — `Term { year: string; period: string; label: string }`; `CourseOffering.term`, `.id` = `` `${courseCode}|${year}|${period}` ``, `.moduleId`, `.capturedAt?`; `PlanState { version: 1; term: Term; entries: PlanEntry[] }`.
- `web/src/lib/plans.ts` — `PlansState { activeId, plans: NamedPlan[] }` and pure mutators (invariants: plans never empty, activeId always a member).
- `web/src/lib/plan.ts:21` — `DEFAULT_TERM = { year: '2026', period: '2', label: 'Fall 2026' }`, `emptyPlan(term)`.
- `web/src/lib/storage.ts` — `readJson/writeJson` best-effort helpers, guard-function pattern, `purgeSeededSamples` one-time-migration pattern.
- `web/src/hooks/usePlan.ts` — the state hub being refactored (445 lines; read it fully before Task 10).
- `web/src/lib/bridge.ts:163-168` — `ForgetCoursesMessage` interface exists; its `post` function was removed and comes back in Task 9.
- `web/src/styles/app.css` — `.topbar__term` ≈ line 105; a mobile media rule ≈ line 2057 hides it.

---

### Task 1: `terms.ts` — term identity, season mapping, display labels

**Files:**
- Create: `web/src/lib/terms.ts`
- Test: `web/src/lib/terms.test.ts`

**Interfaces:**
- Consumes: `Term` from `@triton/shared`.
- Produces: `type TermKey = string`; `termKey(term: Term): TermKey`; `type Season = 'fall'|'winter'|'spring'|'summer1'|'summer2'`; `seasonOf(term: Term): Season | null`; `displayYear(term: Term): number`; `displayTermLabel(term: Term): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/terms.test.ts
import { describe, it, expect } from 'vitest';
import type { Term } from '@triton/shared';
import { termKey, seasonOf, displayYear, displayTermLabel } from './terms';

const FALL26: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WINTER27: Term = { year: '2027', period: '3', label: 'Period 3 2027' }; // calendar year 2027
const UNKNOWN: Term = { year: '2027', period: '9', label: 'Period 9 2027' };

describe('termKey', () => {
  it('matches the CourseOffering id suffix encoding', () => {
    expect(termKey(FALL26)).toBe('2026|2');
  });
});

describe('seasonOf', () => {
  it('maps only the grounded codes', () => {
    expect(seasonOf(FALL26)).toBe('fall');
    expect(seasonOf(WINTER27)).toBe('winter');
    expect(seasonOf(UNKNOWN)).toBeNull();
  });
});

describe('displayTermLabel', () => {
  it('Fall shows the calendar year', () => {
    expect(displayTermLabel(FALL26)).toBe('Fall 2026');
  });
  it('Winter shows the ACADEMIC-year start year (user decision)', () => {
    // Jan–Mar 2027 belongs to AY 2026–27 → displays "Winter 2026".
    expect(displayYear(WINTER27)).toBe(2026);
    expect(displayTermLabel(WINTER27)).toBe('Winter 2026');
  });
  it('unknown period falls back to the captured label', () => {
    expect(displayTermLabel(UNKNOWN)).toBe('Period 9 2027');
  });
  it('unknown period with empty label synthesizes the fallback', () => {
    expect(displayTermLabel({ year: '2027', period: '9', label: '' })).toBe('Period 9 2027');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @triton/web -- terms`
Expected: FAIL — cannot resolve `./terms`.

- [ ] **Step 3: Implement**

```ts
// web/src/lib/terms.ts
/**
 * ALL knowledge about SAP academic periods lives HERE and nowhere else:
 * season codes, display labels, academic-year math, archive boundaries.
 * When real Winter/Spring/Summer captures arrive (expected Nov 2026), this is
 * the single file to update. Do NOT guess codes (repo convention) — unknown
 * periods flow through fallbacks: fallback label, no year-grid slot, never
 * auto-archived.
 */
import type { Term } from '@triton/shared';

/** `${year}|${period}` — the same encoding as the CourseOffering id suffix. */
export type TermKey = string;

export function termKey(term: Term): TermKey {
  return `${term.year}|${term.period}`;
}

export type Season = 'fall' | 'winter' | 'spring' | 'summer1' | 'summer2';

// Grounded mappings ONLY:
//  '2' = Fall   — verified 2026-07 (captured BeginDate 2026-09-24)
//  '3' = Winter — appt fixture carries sessionText 'Winter Quarter' for '3'
const SEASON_BY_PERIOD: Record<string, Season> = {
  '2': 'fall',
  '3': 'winter',
};

export function seasonOf(term: Term): Season | null {
  return SEASON_BY_PERIOD[term.period] ?? null;
}

const SEASON_NAMES: Record<Season, string> = {
  fall: 'Fall',
  winter: 'Winter',
  spring: 'Spring',
  summer1: 'Summer I',
  summer2: 'Summer II',
};

/**
 * Display-year rule (user decision, applied globally): Winter shows the
 * ACADEMIC-year start year — the winter after Fall 2026 displays "Winter 2026"
 * even though it runs Jan–Mar 2027. Other seasons show the calendar year.
 * `term.year` is treated as the quarter's own calendar year until verified
 * against real Winter data.
 */
export function displayYear(term: Term): number {
  const y = Number(term.year);
  return seasonOf(term) === 'winter' ? y - 1 : y;
}

export function displayTermLabel(term: Term): string {
  const season = seasonOf(term);
  if (!season) return term.label || `Period ${term.period} ${term.year}`;
  return `${SEASON_NAMES[season]} ${displayYear(term)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @triton/web -- terms`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/terms.ts web/src/lib/terms.test.ts
git commit -m "feat(web): term identity + season mapping + display labels"
```

---

### Task 2: `terms.ts` — timeline: chronological order + archive boundaries

**Files:**
- Modify: `web/src/lib/terms.ts` (append)
- Test: `web/src/lib/terms.test.ts` (append)

**Interfaces:**
- Produces: `chronoIndex(term: Term): number | null`; `archiveBoundary(term: Term): Date | null`; `isArchived(term: Term, now: Date): boolean`.

- [ ] **Step 1: Write the failing tests (append to terms.test.ts)**

```ts
import { chronoIndex, archiveBoundary, isArchived } from './terms';

describe('chronoIndex', () => {
  it('orders winter < spring < fall within a calendar year, across years by year', () => {
    const w27 = chronoIndex({ year: '2027', period: '3', label: '' })!;
    const f26 = chronoIndex({ year: '2026', period: '2', label: '' })!;
    const f27 = chronoIndex({ year: '2027', period: '2', label: '' })!;
    expect(f26).toBeLessThan(w27); // Fall 2026 precedes Winter (Jan–Mar) 2027
    expect(w27).toBeLessThan(f27);
  });
  it('is null for unknown periods (they cannot join the timeline)', () => {
    expect(chronoIndex({ year: '2027', period: '9', label: '' })).toBeNull();
  });
});

describe('isArchived (fixed month-day boundaries: Fall 12/20, Winter 3/22, Spring 6/15, Summer 9/15)', () => {
  const FALL26: Term = { year: '2026', period: '2', label: 'Fall 2026' };
  it('Fall 2026 archives on Dec 20 2026, not before', () => {
    expect(isArchived(FALL26, new Date(2026, 11, 19))).toBe(false);
    expect(isArchived(FALL26, new Date(2026, 11, 20))).toBe(true);
  });
  it('Winter (calendar 2027) archives on Mar 22 2027', () => {
    const w: Term = { year: '2027', period: '3', label: '' };
    expect(isArchived(w, new Date(2027, 2, 21))).toBe(false);
    expect(isArchived(w, new Date(2027, 2, 22))).toBe(true);
  });
  it('unknown periods NEVER auto-archive', () => {
    expect(isArchived({ year: '2020', period: '9', label: '' }, new Date(2030, 0, 1))).toBe(false);
    expect(archiveBoundary({ year: '2020', period: '9', label: '' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm test -w @triton/web -- terms` → missing exports.

- [ ] **Step 3: Implement (append to terms.ts)**

```ts
/** Season order within ONE calendar year: Winter(Jan) < Spring < Summer I/II < Fall(Sep). */
const SEASON_ORDER: Record<Season, number> = {
  winter: 0,
  spring: 1,
  summer1: 2,
  summer2: 3,
  fall: 4,
};

/** Sortable timeline index; null for unknown seasons. */
export function chronoIndex(term: Term): number | null {
  const season = seasonOf(term);
  if (!season) return null;
  return Number(term.year) * 10 + SEASON_ORDER[season];
}

// Fixed month-day archive boundaries (spec §6): a term is archived once `now`
// reaches the boundary after its finals week. Real dates drift ±1 week per
// year; the boundary only decides default display + freeze timing, so a fixed
// approximation is deliberately chosen over a per-year calendar table.
const BOUNDARY: Record<Season, { month: number; day: number }> = {
  fall: { month: 12, day: 20 },
  winter: { month: 3, day: 22 },
  spring: { month: 6, day: 15 },
  summer1: { month: 9, day: 15 },
  summer2: { month: 9, day: 15 },
};

/** The boundary falls in the quarter's own calendar year (= term.year). */
export function archiveBoundary(term: Term): Date | null {
  const season = seasonOf(term);
  if (!season) return null;
  const { month, day } = BOUNDARY[season];
  return new Date(Number(term.year), month - 1, day);
}

export function isArchived(term: Term, now: Date): boolean {
  const b = archiveBoundary(term);
  return b !== null && now.getTime() >= b.getTime();
}
```

- [ ] **Step 4: Run to verify PASS** — `npm test -w @triton/web -- terms`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/terms.ts web/src/lib/terms.test.ts
git commit -m "feat(web): term timeline order + fixed archive boundaries"
```

---

### Task 3: `terms.ts` — switcher panel rows builder

**Files:**
- Modify: `web/src/lib/terms.ts` (append)
- Test: `web/src/lib/terms.test.ts` (append)

**Interfaces:**
- Produces:
  - `interface SwitcherCell { key: TermKey | null; label: string; selectable: boolean; current: boolean; archived: boolean }`
  - `interface SwitcherRows { quarterRows: SwitcherCell[][]; summerRows: SwitcherCell[][]; otherRows: SwitcherCell[] }`
  - `buildSwitcherRows(terms: Term[], activeKey: TermKey, now: Date): SwitcherRows`
  - test-only seam: `layoutRows(items: { term: Term; season: Season | null }[], activeKey: TermKey, now: Date): SwitcherRows`

Panel contract (spec §5, user-final): quarter rows are `Fall AY | Winter AY | Spring AY+1`, one row per academic year, **ascending** (oldest on top); a bold divider; then summer rows `Summer I y | Summer II y`, one per calendar year, ascending, **only for years that have summer data**; within any row, missing terms render as grey placeholders (`selectable: false, key: null`). Unknown-period terms each get one `otherRows` cell with their fallback label.

- [ ] **Step 1: Write the failing tests (append)**

```ts
import { buildSwitcherRows, layoutRows } from './terms';

const K = (y: string, p: string) => `${y}|${p}`;

describe('buildSwitcherRows', () => {
  it('one AY row: Fall present, Winter/Spring placeholders with correct labels', () => {
    const rows = buildSwitcherRows([{ year: '2026', period: '2', label: 'Fall 2026' }], K('2026', '2'), new Date(2026, 9, 1));
    expect(rows.quarterRows).toHaveLength(1);
    const [fall, winter, spring] = rows.quarterRows[0]!;
    expect(fall).toMatchObject({ key: '2026|2', label: 'Fall 2026', selectable: true, current: true, archived: false });
    expect(winter).toMatchObject({ key: null, label: 'Winter 2026', selectable: false });
    expect(spring).toMatchObject({ key: null, label: 'Spring 2027', selectable: false });
    expect(rows.summerRows).toHaveLength(0);
    expect(rows.otherRows).toHaveLength(0);
  });

  it('Winter (calendar 2027) lands in the Fall-2026 row and marks archived terms', () => {
    const rows = buildSwitcherRows(
      [
        { year: '2026', period: '2', label: 'Fall 2026' },
        { year: '2027', period: '3', label: '' },
      ],
      K('2027', '3'),
      new Date(2027, 0, 10), // Jan 2027: Fall archived (>=12/20/2026), Winter live
    );
    expect(rows.quarterRows).toHaveLength(1);
    const [fall, winter] = rows.quarterRows[0]!;
    expect(fall).toMatchObject({ key: '2026|2', archived: true, selectable: true, current: false });
    expect(winter).toMatchObject({ key: '2027|3', label: 'Winter 2026', current: true, archived: false });
  });

  it('rows sort ascending by academic year', () => {
    const rows = buildSwitcherRows(
      [
        { year: '2027', period: '2', label: 'Fall 2027' },
        { year: '2026', period: '2', label: 'Fall 2026' },
      ],
      K('2027', '2'),
      new Date(2027, 9, 1),
    );
    expect(rows.quarterRows[0]![0]!.label).toBe('Fall 2026');
    expect(rows.quarterRows[1]![0]!.label).toBe('Fall 2027');
  });

  it('unknown periods go to otherRows with fallback labels', () => {
    const rows = buildSwitcherRows([{ year: '2027', period: '9', label: 'Period 9 2027' }], K('2027', '9'), new Date(2027, 0, 1));
    expect(rows.quarterRows).toHaveLength(0);
    expect(rows.otherRows).toEqual([
      { key: '2027|9', label: 'Period 9 2027', selectable: true, current: true, archived: false },
    ]);
  });
});

describe('layoutRows (summer, via the test seam until real codes exist)', () => {
  it('summer rows appear per calendar year with a placeholder for the unused session', () => {
    const s1: Term = { year: '2027', period: 'S1', label: '' };
    const rows = layoutRows(
      [
        { term: { year: '2026', period: '2', label: 'Fall 2026' }, season: 'fall' },
        { term: s1, season: 'summer1' },
      ],
      K('2026', '2'),
      new Date(2026, 9, 1),
    );
    expect(rows.summerRows).toHaveLength(1);
    const [a, b] = rows.summerRows[0]!;
    expect(a).toMatchObject({ key: '2027|S1', label: 'Summer I 2027', selectable: true });
    expect(b).toMatchObject({ key: null, label: 'Summer II 2027', selectable: false });
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm test -w @triton/web -- terms`

- [ ] **Step 3: Implement (append to terms.ts)**

```ts
export interface SwitcherCell {
  key: TermKey | null; // null = grey placeholder, not clickable
  label: string;
  selectable: boolean;
  current: boolean;
  archived: boolean;
}

export interface SwitcherRows {
  quarterRows: SwitcherCell[][]; // rows of 3: Fall | Winter | Spring, ascending AY
  summerRows: SwitcherCell[][]; // rows of 2: Summer I | Summer II, ascending year
  otherRows: SwitcherCell[]; // unknown-period terms, fallback label
}

function cellFor(term: Term, activeKey: TermKey, now: Date): SwitcherCell {
  const key = termKey(term);
  return {
    key,
    label: displayTermLabel(term),
    selectable: true,
    current: key === activeKey,
    archived: isArchived(term, now),
  };
}

function placeholder(label: string): SwitcherCell {
  return { key: null, label, selectable: false, current: false, archived: false };
}

/**
 * Layout core, parameterized by season so summer rows are testable before the
 * real SAP summer codes are known. Production callers use buildSwitcherRows.
 */
export function layoutRows(
  items: { term: Term; season: Season | null }[],
  activeKey: TermKey,
  now: Date,
): SwitcherRows {
  // Academic-year start for a quarter: fall → its year; winter/spring → year − 1.
  const ayOf = (season: Season, year: number) => (season === 'fall' ? year : year - 1);

  const byAy = new Map<number, Partial<Record<'fall' | 'winter' | 'spring', Term>>>();
  const bySummerYear = new Map<number, Partial<Record<'summer1' | 'summer2', Term>>>();
  const otherRows: SwitcherCell[] = [];

  for (const { term, season } of items) {
    const year = Number(term.year);
    if (season === 'fall' || season === 'winter' || season === 'spring') {
      const ay = ayOf(season, year);
      const row = byAy.get(ay) ?? {};
      row[season] = term;
      byAy.set(ay, row);
    } else if (season === 'summer1' || season === 'summer2') {
      const row = bySummerYear.get(year) ?? {};
      row[season] = term;
      bySummerYear.set(year, row);
    } else {
      otherRows.push(cellFor(term, activeKey, now));
    }
  }

  const quarterRows = [...byAy.keys()].sort((a, b) => a - b).map((ay) => {
    const row = byAy.get(ay)!;
    return [
      row.fall ? cellFor(row.fall, activeKey, now) : placeholder(`Fall ${ay}`),
      row.winter ? cellFor(row.winter, activeKey, now) : placeholder(`Winter ${ay}`),
      row.spring ? cellFor(row.spring, activeKey, now) : placeholder(`Spring ${ay + 1}`),
    ];
  });

  const summerRows = [...bySummerYear.keys()].sort((a, b) => a - b).map((y) => {
    const row = bySummerYear.get(y)!;
    return [
      row.summer1 ? cellFor(row.summer1, activeKey, now) : placeholder(`Summer I ${y}`),
      row.summer2 ? cellFor(row.summer2, activeKey, now) : placeholder(`Summer II ${y}`),
    ];
  });

  return { quarterRows, summerRows, otherRows };
}

export function buildSwitcherRows(terms: Term[], activeKey: TermKey, now: Date): SwitcherRows {
  return layoutRows(terms.map((term) => ({ term, season: seasonOf(term) })), activeKey, now);
}
```

- [ ] **Step 4: Run to verify PASS** — `npm test -w @triton/web -- terms`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/terms.ts web/src/lib/terms.test.ts
git commit -m "feat(web): switcher panel rows builder (AY grid + summer block + fallbacks)"
```

---

### Task 4: `plans.ts` — per-plan browsed lists

**Files:**
- Modify: `web/src/lib/plans.ts`
- Test: `web/src/lib/plans.test.ts` (append; do NOT touch existing tests)

**Interfaces:**
- Produces: `NamedPlan.browsed?: string[]`; `activeBrowsed(state: PlansState): ReadonlySet<string>`; `addBrowsed(state: PlansState, planId: string, ids: string[], now: string): PlansState`; `removeBrowsed(state: PlansState, ids: string[], now: string): PlansState`.
- NOTE: the legacy `hidden` field and `activeHidden`/`hideInActivePlan` stay for now (usePlan still imports them until Task 10; removed in Task 13). `createPlan` starts new plans with `browsed: []`; `duplicatePlan` copies `browsed`.

- [ ] **Step 1: Write the failing tests (append to plans.test.ts)**

```ts
import { activeBrowsed, addBrowsed, removeBrowsed } from './plans';

describe('per-plan browsed lists', () => {
  it('addBrowsed appends to the NAMED plan only, deduplicated', () => {
    const s = seeded(); // active = "Backup" (second plan)
    const first = s.plans[0]!.id;
    const next = addBrowsed(addBrowsed(s, first, ['CSE-100|2026|2'], NOW), first, ['CSE-100|2026|2', 'CSE-101|2026|2'], NOW);
    expect(next.plans[0]!.browsed).toEqual(['CSE-100|2026|2', 'CSE-101|2026|2']);
    expect(next.plans[1]!.browsed ?? []).toEqual([]); // other plan untouched
  });
  it('addBrowsed with nothing new returns the same state reference', () => {
    const s = addBrowsed(seeded(), seeded().plans[0]!.id, [], NOW);
    expect(addBrowsed(s, s.plans[0]!.id, [], NOW)).toBe(s);
  });
  it('addBrowsed on an unknown plan id is a no-op', () => {
    const s = seeded();
    expect(addBrowsed(s, 'nope', ['x'], NOW)).toBe(s);
  });
  it('removeBrowsed drops ids from the ACTIVE plan only', () => {
    let s = seeded();
    const activeId = s.activeId;
    s = addBrowsed(s, activeId, ['a', 'b'], NOW);
    const next = removeBrowsed(s, ['a'], NOW);
    expect(next.plans.find((p) => p.id === activeId)!.browsed).toEqual(['b']);
  });
  it('createPlan starts with an empty browsed list; duplicatePlan copies it', () => {
    let s = seeded();
    s = addBrowsed(s, s.activeId, ['a'], NOW);
    expect(createPlan(s, NOW).plans.at(-1)!.browsed).toEqual([]);
    const dup = duplicatePlan(s, s.activeId, NOW);
    expect(dup.plans.at(-1)!.browsed).toEqual(['a']);
  });
  it('activeBrowsed reads the active plan', () => {
    let s = seeded();
    s = addBrowsed(s, s.activeId, ['a'], NOW);
    expect([...activeBrowsed(s)]).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm test -w @triton/web -- plans`

- [ ] **Step 3: Implement**

In `NamedPlan` (after the `hidden` field, plans.ts:25), add:

```ts
  /**
   * THIS plan's own browsed-courses list (course ids referencing the pool
   * repository). Fully independent per plan AND per term: new captures land
   * only in the target term's active plan; a new plan starts empty; ×/Clear
   * touch only this plan. Replaces `hidden` (kept above for migration input).
   */
  browsed?: string[];
```

In `createPlan`, add `browsed: []` to the entry literal. In `duplicatePlan`, after the `hidden` spread line add:

```ts
    ...(source.browsed ? { browsed: [...source.browsed] } : {}),
```

Append the three functions:

```ts
/** Course ids the ACTIVE plan lists as browsed. */
export function activeBrowsed(state: PlansState): ReadonlySet<string> {
  return new Set(activePlan(state).browsed ?? []);
}

/** Append ids to a SPECIFIC plan's browsed list (dedup); same state when nothing is new. */
export function addBrowsed(state: PlansState, planId: string, ids: string[], now: string): PlansState {
  if (ids.length === 0) return state;
  const target = state.plans.find((p) => p.id === planId);
  if (!target) return state;
  const before = target.browsed ?? [];
  const next = [...new Set([...before, ...ids])];
  if (next.length === before.length) return state;
  return {
    ...state,
    plans: state.plans.map((p) => (p.id === planId ? { ...p, browsed: next, updatedAt: now } : p)),
  };
}

/** Remove ids from the ACTIVE plan's browsed list; same state when nothing matched. */
export function removeBrowsed(state: PlansState, ids: string[], now: string): PlansState {
  if (ids.length === 0) return state;
  const current = activePlan(state);
  const before = current.browsed ?? [];
  const drop = new Set(ids);
  const next = before.filter((id) => !drop.has(id));
  if (next.length === before.length) return state;
  return {
    ...state,
    plans: state.plans.map((p) => (p.id === current.id ? { ...p, browsed: next, updatedAt: now } : p)),
  };
}
```

- [ ] **Step 4: Run to verify PASS** — `npm test -w @triton/web -- plans` (existing tests must stay green too)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/plans.ts web/src/lib/plans.test.ts
git commit -m "feat(web): per-plan browsed lists on NamedPlan"
```

---

### Task 5: `terms-state.ts` — container types + core operations

**Files:**
- Create: `web/src/lib/terms-state.ts`
- Test: `web/src/lib/terms-state.test.ts`

**Interfaces:**
- Consumes: `termKey`, `chronoIndex`, `isArchived` (Task 1–2); `PlansState`, `NamedPlan`, `newPlanId`, `activePlan`, `addBrowsed` (Task 4); `emptyPlan` from `./plan`.
- Produces:
  - `interface TermWorkspace { term: Term; plans: PlansState }`
  - `interface TermsState { version: 1; activeTermKey: TermKey; terms: Record<TermKey, TermWorkspace> }`
  - `newWorkspace(term: Term, now: string): TermWorkspace`
  - `ensureWorkspace(state: TermsState, term: Term, now: string): TermsState`
  - `activeWorkspace(state: TermsState): TermWorkspace`
  - `updateWorkspace(state: TermsState, key: TermKey, fn: (plans: PlansState) => PlansState): TermsState`
  - `mapWorkspaces(state: TermsState, fn: (ws: TermWorkspace) => PlansState): TermsState`
  - `switchTermIn(state: TermsState, key: TermKey): TermsState`
  - `newestTermKey(state: TermsState): TermKey`
  - `allPlansEmpty(state: TermsState): boolean`
  - `adoptSeedPlan(state: TermsState, seed: PlanState, now: string): TermsState`

Invariants (mirror plans.ts): `terms` never empty; `activeTermKey` always a member (`activeWorkspace` falls back to the first key defensively). All functions return the SAME state reference on no-op.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/terms-state.test.ts
import { describe, it, expect } from 'vitest';
import type { Term } from '@triton/shared';
import {
  newWorkspace, ensureWorkspace, activeWorkspace, updateWorkspace,
  switchTermIn, newestTermKey, allPlansEmpty, adoptSeedPlan, type TermsState,
} from './terms-state';
import { emptyPlan } from './plan';
import { makeCourse } from './fixtures';

const NOW = '2026-08-11T10:00:00.000Z';
const FALL26: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WINTER27: Term = { year: '2027', period: '3', label: '' };

function base(): TermsState {
  const ws = newWorkspace(FALL26, NOW);
  return { version: 1, activeTermKey: '2026|2', terms: { '2026|2': ws } };
}

describe('newWorkspace / ensureWorkspace', () => {
  it('a new workspace has one empty "My plan" with an empty browsed list, bound to the term', () => {
    const ws = newWorkspace(WINTER27, NOW);
    expect(ws.term).toEqual(WINTER27);
    expect(ws.plans.plans).toHaveLength(1);
    expect(ws.plans.plans[0]!.plan.term).toEqual(WINTER27);
    expect(ws.plans.plans[0]!.browsed).toEqual([]);
  });
  it('ensureWorkspace creates once and is a no-op after', () => {
    const s1 = ensureWorkspace(base(), WINTER27, NOW);
    expect(Object.keys(s1.terms).sort()).toEqual(['2026|2', '2027|3']);
    expect(ensureWorkspace(s1, WINTER27, NOW)).toBe(s1);
    expect(s1.activeTermKey).toBe('2026|2'); // ensure does NOT switch the view
  });
});

describe('switchTermIn / newestTermKey', () => {
  it('switch is a no-op for unknown keys and same key', () => {
    const s = base();
    expect(switchTermIn(s, 'nope')).toBe(s);
    expect(switchTermIn(s, '2026|2')).toBe(s);
  });
  it('newestTermKey picks the max chrono index (Winter calendar-2027 beats Fall 2026)', () => {
    const s = ensureWorkspace(base(), WINTER27, NOW);
    expect(newestTermKey(s)).toBe('2027|3');
  });
  it('newestTermKey falls back to latest plan update when no term joins the timeline', () => {
    const a = newWorkspace({ year: '2026', period: '8', label: '' }, '2026-01-01T00:00:00.000Z');
    const b = newWorkspace({ year: '2026', period: '9', label: '' }, '2026-06-01T00:00:00.000Z');
    const s: TermsState = { version: 1, activeTermKey: '2026|8', terms: { '2026|8': a, '2026|9': b } };
    expect(newestTermKey(s)).toBe('2026|9');
  });
});

describe('adoptSeedPlan', () => {
  it('routes an address-bar seed into ITS term workspace, activates it, seeds browsed', () => {
    const course = makeCourse('CSE-100');
    const seed = { ...emptyPlan(FALL26), entries: [{ course, selectedOptionId: null }] };
    const s = adoptSeedPlan(base(), seed, NOW);
    expect(allPlansEmpty(s)).toBe(false);
    const ws = activeWorkspace(s);
    expect(ws.plans.plans[0]!.plan.entries).toHaveLength(1);
    expect(ws.plans.plans[0]!.browsed).toContain(course.id);
  });
});
```

(If `makeCourse` in `web/src/lib/fixtures.ts` takes different arguments, read that file and adapt the call — it already exists and is used by plans.test.ts.)

- [ ] **Step 2: Run to verify FAIL** — `npm test -w @triton/web -- terms-state`

- [ ] **Step 3: Implement**

```ts
// web/src/lib/terms-state.ts
/**
 * The term-switcher container: one TermWorkspace per academic term, each
 * holding its own complete PlansState (spec 2026-08-10 §3). plans.ts pure
 * functions are reused unchanged inside a workspace. Invariants mirror
 * plans.ts: `terms` is never empty and `activeTermKey` always points at a
 * member; every mutator preserves them and returns the same reference on no-op.
 */
import type { CourseOffering, PlanState, Term } from '@triton/shared';
import { emptyPlan } from './plan';
import {
  activePlan, addBrowsed, newPlanId, updateActivePlan,
  type NamedPlan, type PlansState,
} from './plans';
import { chronoIndex, isArchived, termKey, type TermKey } from './terms';

export interface TermWorkspace {
  term: Term;
  plans: PlansState;
}

export interface TermsState {
  version: 1;
  activeTermKey: TermKey;
  terms: Record<TermKey, TermWorkspace>;
}

export function newWorkspace(term: Term, now: string): TermWorkspace {
  const id = newPlanId();
  const plan: NamedPlan = {
    id, name: 'My plan', plan: emptyPlan(term), createdAt: now, updatedAt: now, browsed: [],
  };
  return { term, plans: { activeId: id, plans: [plan] } };
}

export function ensureWorkspace(state: TermsState, term: Term, now: string): TermsState {
  const key = termKey(term);
  if (state.terms[key]) return state;
  return { ...state, terms: { ...state.terms, [key]: newWorkspace(term, now) } };
}

export function activeWorkspace(state: TermsState): TermWorkspace {
  return state.terms[state.activeTermKey] ?? Object.values(state.terms)[0]!;
}

/** Update ONE workspace's PlansState; same state back when the updater no-ops. */
export function updateWorkspace(
  state: TermsState,
  key: TermKey,
  fn: (plans: PlansState) => PlansState,
): TermsState {
  const ws = state.terms[key];
  if (!ws) return state;
  const next = fn(ws.plans);
  if (next === ws.plans) return state;
  return { ...state, terms: { ...state.terms, [key]: { ...ws, plans: next } } };
}

/** Map EVERY workspace (e.g. seat refreshes); same state back when nothing changed. */
export function mapWorkspaces(state: TermsState, fn: (ws: TermWorkspace) => PlansState): TermsState {
  let changed = false;
  const terms: Record<TermKey, TermWorkspace> = {};
  for (const [key, ws] of Object.entries(state.terms)) {
    const next = fn(ws);
    if (next === ws.plans) { terms[key] = ws; continue; }
    changed = true;
    terms[key] = { ...ws, plans: next };
  }
  return changed ? { ...state, terms } : state;
}

export function switchTermIn(state: TermsState, key: TermKey): TermsState {
  if (state.activeTermKey === key || !state.terms[key]) return state;
  return { ...state, activeTermKey: key };
}

/** Latest plan-updatedAt inside a workspace — tie-breaker for unknown-season terms. */
function latestUpdate(ws: TermWorkspace): string {
  return ws.plans.plans.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), '');
}

/** The chronologically newest workspace; unknown-season terms only win when nothing joins the timeline. */
export function newestTermKey(state: TermsState): TermKey {
  const entries = Object.entries(state.terms);
  let best: { key: TermKey; idx: number } | null = null;
  for (const [key, ws] of entries) {
    const idx = chronoIndex(ws.term);
    if (idx !== null && (best === null || idx > best.idx)) best = { key, idx };
  }
  if (best) return best.key;
  return entries.reduce((a, b) => (latestUpdate(b[1]) > latestUpdate(a[1]) ? b : a))[0];
}

export function allPlansEmpty(state: TermsState): boolean {
  return Object.values(state.terms).every((ws) => ws.plans.plans.every((p) => p.plan.entries.length === 0));
}

/** Adopt an address-bar mirror seed (bookmark/sync open on a fresh device) into its own term. */
export function adoptSeedPlan(state: TermsState, seed: PlanState, now: string): TermsState {
  const key = termKey(seed.term);
  let next = ensureWorkspace(state, seed.term, now);
  next = updateWorkspace(next, key, (ps) => {
    const replaced = updateActivePlan(ps, () => seed, now);
    return addBrowsed(replaced, replaced.activeId, seed.entries.map((e) => e.course.id), now);
  });
  return { ...next, activeTermKey: key };
}

/** A workspace nobody touched: single default plan, no entries, no browsed history. */
export function isPristine(ws: TermWorkspace): boolean {
  const only = ws.plans.plans.length === 1 ? ws.plans.plans[0]! : null;
  return only !== null && only.plan.entries.length === 0 && (only.browsed ?? []).length === 0;
}
```

- [ ] **Step 4: Run to verify PASS** — `npm test -w @triton/web -- terms-state`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/terms-state.ts web/src/lib/terms-state.test.ts
git commit -m "feat(web): TermsState container + core workspace ops"
```

---

### Task 6: migration (`plans:v1` → `terms:v1`) + storage plumbing

**Files:**
- Modify: `web/src/lib/terms-state.ts` (append), `web/src/lib/storage.ts`
- Test: `web/src/lib/terms-state.test.ts`, `web/src/lib/storage.test.ts` (append)

**Interfaces:**
- Produces (terms-state.ts): `migrateToTermsState(existing: TermsState | null, plansV1: PlansState | null, legacyPlan: PlanState | null, pool: CourseOffering[], now: string): TermsState`
- Produces (storage.ts): `isTermsState(value: unknown): value is TermsState`; `saveTerms(state: TermsState): void`; `loadTerms(): TermsState | null`. Also extend `isNamedPlan` to accept `browsed` (`v.browsed === undefined || Array.isArray(v.browsed)`).

Migration rules (spec §4): a valid stored `TermsState` wins (repair a dangling `activeTermKey` to `newestTermKey`). Otherwise run the existing `migratePlans(plansV1, legacyPlan, now)` chain, group its `NamedPlan`s by `termKey(p.plan.term)` into workspaces, and initialize each plan's `browsed` as: pool ids of that term MINUS the plan's old `hidden` PLUS the plan's own entry ids (so the visible browsed list is pixel-identical before/after). Old `hidden` fields are stripped. Per-workspace `activeId` = the old global `activeId` when that plan landed in this workspace, else the first plan. `activeTermKey` = `newestTermKey`. Old storage keys are left untouched.

- [ ] **Step 1: Write the failing tests (append to terms-state.test.ts)**

```ts
import { migrateToTermsState } from './terms-state';
import { migratePlans, addPlan, hideInActivePlan } from './plans';

describe('migrateToTermsState', () => {
  it('groups a flat PlansState by each plan term and keeps activeId within its workspace', () => {
    const fall = { ...emptyPlan(FALL26), entries: [] };
    let flat = migratePlans(null, fall, NOW);           // "My plan" (Fall)
    flat = addPlan(flat, emptyPlan(WINTER27), 'W', NOW); // adds + activates Winter plan
    const s = migrateToTermsState(null, flat, null, [], NOW);
    expect(Object.keys(s.terms).sort()).toEqual(['2026|2', '2027|3']);
    expect(s.terms['2027|3']!.plans.activeId).toBe(flat.activeId);
    expect(s.activeTermKey).toBe('2027|3'); // newest
  });

  it('browsed init = term pool − hidden + own entries (pixel-identical list)', () => {
    const inPlan = makeCourse('CSE-100');
    const browsedKept = makeCourse('CSE-101');
    const hiddenOne = makeCourse('CSE-102');
    const plan = { ...emptyPlan(FALL26), entries: [{ course: inPlan, selectedOptionId: null }] };
    let flat = migratePlans(null, plan, NOW);
    flat = hideInActivePlan(flat, [hiddenOne.id], NOW);
    const s = migrateToTermsState(null, flat, null, [inPlan, browsedKept, hiddenOne], NOW);
    const migrated = s.terms['2026|2']!.plans.plans[0]!;
    expect(migrated.browsed).toEqual(expect.arrayContaining([browsedKept.id, inPlan.id]));
    expect(migrated.browsed).not.toContain(hiddenOne.id);
    expect('hidden' in migrated).toBe(false);
  });

  it('a valid existing TermsState wins and a dangling activeTermKey is repaired', () => {
    const good = adoptSeedPlan(base(), emptyPlan(FALL26), NOW);
    const dangling = { ...good, activeTermKey: 'gone|9' };
    expect(migrateToTermsState(good, null, null, [], NOW)).toBe(good);
    expect(migrateToTermsState(dangling, null, null, [], NOW).activeTermKey).toBe('2026|2');
  });

  it('nothing stored → single DEFAULT_TERM bootstrap workspace', () => {
    const s = migrateToTermsState(null, null, null, [], NOW);
    expect(Object.keys(s.terms)).toEqual(['2026|2']);
    expect(allPlansEmpty(s)).toBe(true);
  });
});
```

And in `storage.test.ts` append round-trip + guard tests following the file's existing style:

```ts
import { saveTerms, loadTerms, isTermsState } from './storage';
import { newWorkspace } from './terms-state';

describe('terms storage', () => {
  it('round-trips a TermsState', () => {
    const state = { version: 1 as const, activeTermKey: '2026|2', terms: { '2026|2': newWorkspace({ year: '2026', period: '2', label: 'Fall 2026' }, '2026-08-11T00:00:00.000Z') } };
    saveTerms(state);
    expect(loadTerms()).toEqual(state);
  });
  it('rejects junk', () => {
    expect(isTermsState(null)).toBe(false);
    expect(isTermsState({ version: 1, activeTermKey: 'x', terms: {} })).toBe(false); // empty terms
    expect(isTermsState({ version: 2, activeTermKey: 'x', terms: {} })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm test -w @triton/web -- terms-state storage`

- [ ] **Step 3: Implement**

Append to terms-state.ts:

```ts
import { migratePlans } from './plans'; // merge into the existing import list

/**
 * Build the working TermsState. Precedence: valid stored terms:v1 (repairing a
 * dangling activeTermKey) → flat plans:v1 / legacy plan:v1 grouped by term →
 * fresh DEFAULT_TERM bootstrap. Old keys are read-only rollback backstops.
 */
export function migrateToTermsState(
  existing: TermsState | null,
  plansV1: PlansState | null,
  legacyPlan: PlanState | null,
  pool: CourseOffering[],
  now: string,
): TermsState {
  if (existing && Object.keys(existing.terms).length > 0) {
    if (existing.terms[existing.activeTermKey]) return existing;
    return { ...existing, activeTermKey: newestTermKey(existing) };
  }

  const flat = migratePlans(plansV1, legacyPlan, now);
  const poolIdsByTerm = new Map<TermKey, string[]>();
  for (const c of pool) {
    const key = termKey(c.term);
    poolIdsByTerm.set(key, [...(poolIdsByTerm.get(key) ?? []), c.id]);
  }

  const terms: Record<TermKey, TermWorkspace> = {};
  for (const p of flat.plans) {
    const key = termKey(p.plan.term);
    const hidden = new Set(p.hidden ?? []);
    const entryIds = p.plan.entries.map((e) => e.course.id);
    const browsed = [
      ...new Set([...(poolIdsByTerm.get(key) ?? []).filter((id) => !hidden.has(id)), ...entryIds]),
    ];
    const { hidden: _dropped, ...rest } = p;
    const migrated: NamedPlan = { ...rest, browsed };
    const ws = terms[key];
    if (!ws) {
      terms[key] = { term: p.plan.term, plans: { activeId: p.id, plans: [migrated] } };
    } else {
      const activeId = p.id === flat.activeId ? p.id : ws.plans.activeId;
      terms[key] = { ...ws, plans: { activeId, plans: [...ws.plans.plans, migrated] } };
    }
  }

  const state: TermsState = { version: 1, activeTermKey: Object.keys(terms)[0]!, terms };
  return { ...state, activeTermKey: newestTermKey(state) };
}
```

In storage.ts, after the named-plans block, add (reusing the local `isPlansState`/`readJson`/`writeJson`):

```ts
/* ---- per-term workspaces (the term switcher container) --------------------- */

const TERMS_KEY = 'triton-planner:terms:v1';

function isTermShape(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.year === 'string' && typeof v.period === 'string' && typeof v.label === 'string';
}

function isTermWorkspace(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return isTermShape(v.term) && isPlansState(v.plans);
}

export function isTermsState(value: unknown): value is import('./terms-state').TermsState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.activeTermKey !== 'string') return false;
  if (!v.terms || typeof v.terms !== 'object') return false;
  const workspaces = Object.values(v.terms as Record<string, unknown>);
  return workspaces.length > 0 && workspaces.every(isTermWorkspace);
}

export function saveTerms(state: import('./terms-state').TermsState): void {
  writeJson(TERMS_KEY, state);
}

export function loadTerms(): import('./terms-state').TermsState | null {
  return readJson(TERMS_KEY, isTermsState);
}
```

And in the existing `isNamedPlan`, extend the final conjunction with:

```ts
    (v.browsed === undefined || Array.isArray(v.browsed))
```

- [ ] **Step 4: Run to verify PASS** — `npm test -w @triton/web -- terms-state storage`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/terms-state.ts web/src/lib/terms-state.test.ts web/src/lib/storage.ts web/src/lib/storage.test.ts
git commit -m "feat(web): terms:v1 storage + one-time migration from flat plans"
```

---

### Task 7: `terms-state.ts` — archive sweep

**Files:**
- Modify: `web/src/lib/terms-state.ts` (append)
- Test: `web/src/lib/terms-state.test.ts` (append)

**Interfaces:**
- Produces: `interface SweepResult { state: TermsState; pool: CourseOffering[]; forgetModuleIds: string[] }`; `archiveSweep(state: TermsState, pool: CourseOffering[], now: Date): SweepResult`.

Rules (spec §6): for every workspace whose term `isArchived(term, now)` — no courses in any plan → delete the workspace (but never delete the LAST remaining workspace overall); has courses → keep read-only, clear every plan's `browsed`. Pool courses belonging to ANY archived term are dropped; their deduped `moduleId`s are returned for a `forget-courses` post. A dangling `activeTermKey` after deletion is repaired to `newestTermKey`. Idempotent: a second run returns the same state/pool and an empty `forgetModuleIds`.

- [ ] **Step 1: Write the failing tests (append)**

```ts
import { archiveSweep } from './terms-state';

describe('archiveSweep', () => {
  const DEC25 = new Date(2026, 11, 25); // past Fall 12/20 boundary, before Winter's

  function withCourse(state: TermsState, key: string, course = makeCourse('CHEM-043A')): TermsState {
    return updateWorkspace(state, key, (ps) =>
      updateActivePlanForTest(ps, course), // helper below
    );
  }
  // Test helper: put one course into the active plan AND its browsed list.
  function updateActivePlanForTest(ps: import('./plans').PlansState, course: ReturnType<typeof makeCourse>) {
    const withEntry = updateActivePlan(ps, (p) => ({ ...p, entries: [{ course, selectedOptionId: null }] }), NOW);
    return addBrowsed(withEntry, withEntry.activeId, [course.id], NOW);
  }

  it('deletes an archived EMPTY workspace, keeps + freezes a non-empty one, purges pool + collects moduleIds', () => {
    let s = ensureWorkspace(base(), WINTER27, NOW);       // Fall(empty at first) + Winter
    const fallCourse = makeCourse('CSE-100');
    s = withCourse(s, '2026|2', fallCourse);              // Fall now has a course
    const strayFallPoolCourse = makeCourse('CSE-199');    // browsed-only, in pool
    const winterCourse = { ...makeCourse('CSE-101'), term: WINTER27, id: `CSE-101|2027|3` };
    const { state, pool, forgetModuleIds } = archiveSweep(s, [fallCourse, strayFallPoolCourse, winterCourse], DEC25);
    expect(Object.keys(state.terms).sort()).toEqual(['2026|2', '2027|3']); // Fall kept (has a course)
    expect(state.terms['2026|2']!.plans.plans.every((p) => (p.browsed ?? []).length === 0)).toBe(true);
    expect(pool.map((c) => c.id)).toEqual([winterCourse.id]); // all Fall pool objects dropped
    expect(forgetModuleIds.sort()).toEqual([fallCourse.moduleId, strayFallPoolCourse.moduleId].sort());
  });

  it('deletes an archived empty workspace and repairs activeTermKey', () => {
    let s = ensureWorkspace(base(), WINTER27, NOW); // Fall stays empty
    s = { ...s, activeTermKey: '2026|2' };
    const { state } = archiveSweep(s, [], DEC25);
    expect(Object.keys(state.terms)).toEqual(['2027|3']);
    expect(state.activeTermKey).toBe('2027|3');
  });

  it('never deletes the last remaining workspace', () => {
    const { state } = archiveSweep(base(), [], DEC25); // only an empty archived Fall
    expect(Object.keys(state.terms)).toEqual(['2026|2']);
  });

  it('is idempotent', () => {
    const fallCourse = makeCourse('CSE-100');
    const s = withCourse(base(), '2026|2', fallCourse);
    const first = archiveSweep(s, [fallCourse], DEC25);
    const second = archiveSweep(first.state, first.pool, DEC25);
    expect(second.forgetModuleIds).toEqual([]);
    expect(second.state).toBe(first.state);
    expect(second.pool).toBe(first.pool);
  });
});
```

(Inline the small arrangement helpers as shown; adjust `makeCourse` term-override syntax to whatever `fixtures.ts` provides — the winter course must have `term: WINTER27` and a matching `|2027|3` id suffix.)

- [ ] **Step 2: Run to verify FAIL** — `npm test -w @triton/web -- terms-state`

- [ ] **Step 3: Implement (append)**

```ts
export interface SweepResult {
  state: TermsState;
  pool: CourseOffering[];
  forgetModuleIds: string[];
}

/** Empty every plan's browsed list; same PlansState back when already clear. */
function clearAllBrowsed(ps: PlansState, now: string): PlansState {
  if (ps.plans.every((p) => (p.browsed ?? []).length === 0)) return ps;
  return {
    ...ps,
    plans: ps.plans.map((p) => ((p.browsed ?? []).length === 0 ? p : { ...p, browsed: [], updatedAt: now })),
  };
}

/**
 * Runs on every app load (spec §6). Archived-ness is DERIVED from the date —
 * no stored flag — and the cleanup converges: after one sweep the pool holds
 * nothing from archived terms, so the next run finds nothing to do.
 */
export function archiveSweep(state: TermsState, pool: CourseOffering[], now: Date): SweepResult {
  const nowIso = now.toISOString();
  const archivedKeys = new Set(
    Object.entries(state.terms).filter(([, ws]) => isArchived(ws.term, now)).map(([key]) => key),
  );

  const droppedCourses = pool.filter((c) => archivedKeys.has(termKey(c.term)));
  const nextPool = droppedCourses.length === 0 ? pool : pool.filter((c) => !archivedKeys.has(termKey(c.term)));

  let termsChanged = false;
  const terms: Record<TermKey, TermWorkspace> = {};
  for (const [key, ws] of Object.entries(state.terms)) {
    if (!archivedKeys.has(key)) { terms[key] = ws; continue; }
    const hasCourses = ws.plans.plans.some((p) => p.plan.entries.length > 0);
    if (!hasCourses) { termsChanged = true; continue; } // delete empty archived term
    const cleared = clearAllBrowsed(ws.plans, nowIso);
    if (cleared === ws.plans) { terms[key] = ws; continue; }
    termsChanged = true;
    terms[key] = { ...ws, plans: cleared };
  }
  // Never end up with zero workspaces: resurrect the newest one, browsed cleared.
  if (Object.keys(terms).length === 0) {
    const key = newestTermKey(state);
    const ws = state.terms[key]!;
    terms[key] = { ...ws, plans: clearAllBrowsed(ws.plans, nowIso) };
    termsChanged = true;
  }

  if (!termsChanged && droppedCourses.length === 0) {
    return { state, pool, forgetModuleIds: [] };
  }
  let nextState: TermsState = termsChanged ? { ...state, terms } : state;
  if (!nextState.terms[nextState.activeTermKey]) {
    nextState = { ...nextState, activeTermKey: newestTermKey(nextState) };
  }
  return {
    state: nextState,
    pool: nextPool,
    forgetModuleIds: [...new Set(droppedCourses.map((c) => c.moduleId))],
  };
}
```

- [ ] **Step 4: Run to verify PASS** — `npm test -w @triton/web -- terms-state`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/terms-state.ts web/src/lib/terms-state.test.ts
git commit -m "feat(web): archive sweep (freeze non-empty terms, drop empty ones, purge pool)"
```

---

### Task 8: `terms-state.ts` — capture routing

**Files:**
- Modify: `web/src/lib/terms-state.ts` (append)
- Test: `web/src/lib/terms-state.test.ts` (append)

**Interfaces:**
- Produces: `interface RouteResult { state: TermsState; switchTo: TermKey | null }`; `routeCapture(state: TermsState, prevPool: CourseOffering[], incoming: CourseOffering[], nowIso: string, now: Date): RouteResult`.

Rules (spec §3): a course is FRESH when its id is new to `prevPool` OR its `capturedAt` is strictly newer than the pool copy's. Fresh courses of archived terms are ignored (defensive). Fresh ids join the browsed list of THEIR term's active plan, auto-creating workspaces. `switchTo` = the term key of the freshest (max `capturedAt`) fresh course whose key ≠ `state.activeTermKey`, else null. When routing creates a workspace, pristine bootstrap workspaces (see `isPristine`) other than the routed targets are dropped — the DEFAULT_TERM placeholder gives way to real data.

- [ ] **Step 1: Write the failing tests (append)**

```ts
import { routeCapture } from './terms-state';

describe('routeCapture', () => {
  const NOW_D = new Date(2026, 10, 15); // Nov 2026: nothing archived

  it('new course joins its own term active-plan browsed list and does not leak elsewhere', () => {
    const winterCourse = { ...makeCourse('CSE-101'), term: WINTER27, id: 'CSE-101|2027|3', capturedAt: '2026-11-15T00:00:00.000Z' };
    const { state, switchTo } = routeCapture(base(), [], [winterCourse], NOW, NOW_D);
    expect(switchTo).toBe('2027|3');
    const winterWs = state.terms['2027|3']!;
    expect(winterWs.plans.plans[0]!.browsed).toEqual(['CSE-101|2027|3']);
  });

  it('a pool course with unchanged capturedAt is NOT fresh (seat refresh does not re-add)', () => {
    const c = { ...makeCourse('CSE-100'), capturedAt: '2026-11-01T00:00:00.000Z' };
    const s = base();
    const r = routeCapture(s, [c], [c], NOW, NOW_D);
    expect(r.state).toBe(s);
    expect(r.switchTo).toBeNull();
  });

  it('a RE-browsed course (newer capturedAt) re-enters the current active plan (the ×-recovery path)', () => {
    const old = { ...makeCourse('CSE-100'), capturedAt: '2026-11-01T00:00:00.000Z' };
    const fresh = { ...old, capturedAt: '2026-11-16T00:00:00.000Z' };
    const { state } = routeCapture(base(), [old], [fresh], NOW, NOW_D);
    expect(state.terms['2026|2']!.plans.plans[0]!.browsed).toContain(old.id);
  });

  it('fresh courses in the ACTIVE term do not trigger a switch', () => {
    const c = { ...makeCourse('CSE-100'), capturedAt: '2026-11-15T00:00:00.000Z' };
    expect(routeCapture(base(), [], [c], NOW, NOW_D).switchTo).toBeNull();
  });

  it('routing to a real term drops the pristine bootstrap workspace', () => {
    const winterCourse = { ...makeCourse('CSE-101'), term: WINTER27, id: 'CSE-101|2027|3', capturedAt: '2026-11-15T00:00:00.000Z' };
    const { state } = routeCapture(base(), [], [winterCourse], NOW, NOW_D); // base() Fall ws is pristine
    expect(Object.keys(state.terms)).toEqual(['2027|3']);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm test -w @triton/web -- terms-state`

- [ ] **Step 3: Implement (append)**

```ts
export interface RouteResult {
  state: TermsState;
  switchTo: TermKey | null;
}

/**
 * Route freshly-captured courses into their own term's active plan (spec §3).
 * "Fresh" = new id, or a strictly newer capturedAt (a deliberate re-open in
 * TSS — the × -recovery path). Seat-refresh pushes with unchanged capturedAt
 * route nowhere.
 */
export function routeCapture(
  state: TermsState,
  prevPool: CourseOffering[],
  incoming: CourseOffering[],
  nowIso: string,
  now: Date,
): RouteResult {
  const prevById = new Map(prevPool.map((c) => [c.id, c]));
  const fresh = incoming.filter((c) => {
    if (isArchived(c.term, now)) return false;
    const prev = prevById.get(c.id);
    return !prev || (c.capturedAt ?? '') > (prev.capturedAt ?? '');
  });
  if (fresh.length === 0) return { state, switchTo: null };

  const targetKeys = new Set<TermKey>();
  let next = state;
  for (const c of fresh) {
    const hadWorkspace = !!next.terms[termKey(c.term)];
    next = ensureWorkspace(next, c.term, nowIso);
    targetKeys.add(termKey(c.term));
    if (!hadWorkspace) {
      // A real term arrived: pristine bootstrap placeholders give way.
      const keep: Record<TermKey, TermWorkspace> = {};
      for (const [key, ws] of Object.entries(next.terms)) {
        if (key === termKey(c.term) || targetKeys.has(key) || !isPristine(ws)) keep[key] = ws;
      }
      if (Object.keys(keep).length !== Object.keys(next.terms).length) {
        next = { ...next, terms: keep };
        if (!keep[next.activeTermKey]) next = { ...next, activeTermKey: newestTermKey(next) };
      }
    }
  }
  for (const key of targetKeys) {
    const ids = fresh.filter((c) => termKey(c.term) === key).map((c) => c.id);
    next = updateWorkspace(next, key, (ps) => addBrowsed(ps, ps.activeId, ids, nowIso));
  }

  const freshest = [...fresh].sort((a, b) => ((a.capturedAt ?? '') < (b.capturedAt ?? '') ? 1 : -1))[0]!;
  const freshestKey = termKey(freshest.term);
  return { state: next, switchTo: freshestKey === state.activeTermKey ? null : freshestKey };
}
```

- [ ] **Step 4: Run to verify PASS** — `npm test -w @triton/web -- terms-state`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/terms-state.ts web/src/lib/terms-state.test.ts
git commit -m "feat(web): capture routing (per-term browsed, auto-create + auto-switch)"
```

---

### Task 9: `bridge.ts` — restore `postForgetCourses`

**Files:**
- Modify: `web/src/lib/bridge.ts` (the `ForgetCoursesMessage` interface already exists at :163-168)
- Test: `web/src/lib/bridge.test.ts` (append)

**Interfaces:**
- Produces: `postForgetCourses(moduleIds: string[]): void` — no-op on an empty list.

- [ ] **Step 1: Failing test (append, following the file's existing postMessage-spy style)**

```ts
import { postForgetCourses } from './bridge';

describe('postForgetCourses', () => {
  it('posts the forget-courses envelope to the page origin', () => {
    const posted: unknown[] = [];
    const orig = window.postMessage.bind(window);
    window.postMessage = ((msg: unknown) => { posted.push(msg); }) as typeof window.postMessage;
    try {
      postForgetCourses(['8461', '8462']);
      expect(posted).toEqual([
        { source: 'triton-planner-page', type: 'forget-courses', version: 1, payload: { moduleIds: ['8461', '8462'] } },
      ]);
      postForgetCourses([]);
      expect(posted).toHaveLength(1); // empty list posts nothing
    } finally {
      window.postMessage = orig;
    }
  });
});
```

(Read `bridge.test.ts` first — if it already stubs postMessage differently, reuse that pattern instead.)

- [ ] **Step 2: Run to verify FAIL** — `npm test -w @triton/web -- bridge`

- [ ] **Step 3: Implement — after the `ForgetCoursesMessage` interface:**

```ts
/** Post a forget-courses request (extension ≥1.0.2 handles it). Used by the
 *  archive sweep to release captured data for terms that are over. */
export function postForgetCourses(moduleIds: string[]): void {
  if (moduleIds.length === 0) return;
  const msg: ForgetCoursesMessage = {
    source: PAGE_BRIDGE_SOURCE,
    type: 'forget-courses',
    version: 1,
    payload: { moduleIds },
  };
  window.postMessage(msg, window.location.origin);
}
```

- [ ] **Step 4: Run to verify PASS** — `npm test -w @triton/web -- bridge`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/bridge.ts web/src/lib/bridge.test.ts
git commit -m "feat(web): restore postForgetCourses for the archive sweep"
```

---

### Task 10: `usePlan` refactor — swap the container

**Files:**
- Modify: `web/src/hooks/usePlan.ts` (read the whole 445-line file first)

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces (controller additions/changes — later tasks and components rely on these exact names):
  - `activeTermKey: TermKey`, `termList: Term[]`, `archived: boolean`, `switchTerm(key: TermKey): void`
  - `pendingAdd: { course: CourseOffering; optionId: string } | null`, `confirmPendingAdd(planId: string): void`, `cancelPendingAdd(): void`
  - `readOnly` becomes `(viewing received) || archived` — the existing readOnly plumbing through Topbar/CoursePanel/CourseCard/OptionPicker freezes archived terms with no component changes.
  - `removeFromPool` / `clearBrowsed` / `browsedNotAdded` re-based on the active plan's `browsed` list.
  - Everything else keeps its existing name and shape (`plans`, `activePlanId`, `switchPlan`, …) but now operates on the ACTIVE TERM's workspace.

Concrete changes, in file order:

1. **Imports**: drop `activeHidden`, `hideInActivePlan`, `loadPlans` stays (migration input), add `loadTerms`, `saveTerms` from storage; add from `./terms-state`: `activeWorkspace, adoptSeedPlan, allPlansEmpty, archiveSweep, ensureWorkspace, mapWorkspaces, migrateToTermsState, newestTermKey, routeCapture, switchTermIn, updateWorkspace, type TermsState`; add from `./terms`: `isArchived, termKey, type TermKey`; add from `./plans`: `addBrowsed, removeBrowsed, switchActive`; add `postForgetCourses` from `./bridge`.

2. **Replace `initialPlans`/`initialPool` with one combined initializer** (migration needs the pool; the sweep produces both):

```ts
/** One-shot boot: pool repository + terms container + the archive sweep's forget list. */
function initialState(): { pool: CourseOffering[]; terms: TermsState; forgetModuleIds: string[] } {
  const now = new Date();
  const iso = now.toISOString();
  const pool = mergeCourses(SAMPLE, purgeSeededSamples(loadPool() ?? []));
  let terms = migrateToTermsState(loadTerms(), loadPlans(), loadPlan(), pool, iso);
  if (allPlansEmpty(terms)) {
    const seed = mirrorSeedPlan(window.location.hash);
    if (seed) terms = adoptSeedPlan(terms, seed, iso);
  }
  const swept = archiveSweep(terms, pool, now);
  // 默认显示永远最新 (spec §6): the stored activeTermKey is ignored on load.
  const state = switchTermIn(swept.state, newestTermKey(swept.state));
  return { pool: swept.pool, terms: state, forgetModuleIds: swept.forgetModuleIds };
}
```

3. **State hookup** (replaces the `pool`/`plansState` useStates; keep `received`/`viewing` as-is):

```ts
  const bootRef = useRef<ReturnType<typeof initialState> | null>(null);
  if (bootRef.current === null) bootRef.current = initialState();
  const [pool, setPool] = useState<CourseOffering[]>(bootRef.current.pool);
  const [termsState, setTermsState] = useState<TermsState>(bootRef.current.terms);
  const [pendingQueue, setPendingQueue] = useState<{ course: CourseOffering; optionId: string }[]>([]);
```

Mirror refs (replace `plansRef`): `poolRef` + `termsRef`, both kept current in one effect. The hash-consume effect reads `termsRef.current` and flattens plans across ALL workspaces for `readHash`:

```ts
        plans: Object.values(termsRef.current.terms).flatMap((ws) => ws.plans.plans.map((p) => p.plan)),
```

One-time forget post after mount:

```ts
  useEffect(() => {
    postForgetCourses(bootRef.current?.forgetModuleIds ?? []);
  }, []);
```

4. **Derivations** (replace `const active = activePlan(plansState)` block):

```ts
  const workspace = activeWorkspace(termsState);
  const plansState = workspace.plans;
  const active = activePlan(plansState);
  const plan = active.plan;
  const archived = useMemo(
    () => isArchived(workspace.term, new Date()),
    [workspace.term],
  );

  /** Route a PlanState update into the active plan of the active term. Archived terms are frozen. */
  const setPlan = useCallback((update: (prev: PlanState) => PlanState) => {
    setTermsState((s) => {
      const ws = activeWorkspace(s);
      if (isArchived(ws.term, new Date())) return s;
      return updateWorkspace(s, s.activeTermKey, (ps) =>
        updateActivePlan(ps, update, new Date().toISOString()),
      );
    });
  }, []);

  /** Same guard for plans-level ops (create/rename/duplicate/delete/switch/browsed). */
  const setPlans = useCallback((update: (ps: PlansState) => PlansState) => {
    setTermsState((s) => {
      const ws = activeWorkspace(s);
      if (isArchived(ws.term, new Date())) return s;
      return updateWorkspace(s, s.activeTermKey, update);
    });
  }, []);
```

Rewrite the named-plans callbacks through `setPlans` (e.g. `switchPlan: setPlans((ps) => switchActive(ps, id))` plus `switchViewing('mine')`; same pattern for create/rename/duplicate/delete). EXCEPTION — `switchPlan` must work in archived terms too (viewing another archived plan is read-only navigation, not an edit): route it through a variant without the guard:

```ts
  const switchPlan = useCallback((id: string) => {
    setTermsState((s) => updateWorkspace(s, s.activeTermKey, (ps) => switchActive(ps, id)));
    switchViewing('mine');
  }, [switchViewing]);
```

5. **Persistence**: replace the `savePlans` effect with `saveTerms(termsState)` (same firstRun skip). `savePool` effect unchanged. `savePlans` is never called again.

6. **Term switching + list**:

```ts
  const switchTerm = useCallback((key: TermKey) => {
    setTermsState((s) => switchTermIn(s, key));
    switchViewing('mine');
  }, [switchViewing]);

  const termList = useMemo(() => Object.values(termsState.terms).map((ws) => ws.term), [termsState]);
```

7. **Capture handler** (replace the `onCourses` body):

```ts
      onCourses: (incoming) => {
        bridgeSeen.current = true;
        const prevPool = poolRef.current;
        setPool(mergeCourses(prevPool, incoming));
        setTermsState((s) => {
          const nowIso = new Date().toISOString();
          const routed = routeCapture(s, prevPool, incoming, nowIso, new Date());
          const refreshed = mapWorkspaces(routed.state, (ws) =>
            isArchived(ws.term, new Date())
              ? ws.plans // archived terms are frozen — no seat refreshes
              : mapAllPlans(ws.plans, (p) => refreshPlanEntries(p, incoming), nowIso),
          );
          return routed.switchTo ? switchTermIn(refreshed, routed.switchTo) : refreshed;
        });
      },
```

8. **plan-add handler + picker queue** (replace the `onPlanAdd` body; `addCourseWithOption` keeps its signature for the direct path):

```ts
      onPlanAdd: (course, optionId) => {
        bridgeSeen.current = true;
        if (isArchived(course.term, new Date())) return; // defensive: cannot add into an archive
        setPool((prev) => mergeCourses(prev, [course]));
        const ws = termsRef.current.terms[termKey(course.term)];
        if (ws && ws.plans.plans.length > 1) {
          setPendingQueue((q) => [...q, { course, optionId }]);
        } else {
          addIntoTerm(course, optionId, null);
        }
        switchViewing('mine');
      },
```

with the target-routing add (replaces the body of `addCourseWithOption`; also called by the picker):

```ts
  /** Add into the course's OWN term (creating it if needed), into `planId` or that term's active plan. */
  const addIntoTerm = useCallback((course: CourseOffering, optionId: string, planId: string | null) => {
    const nowIso = new Date().toISOString();
    setTermsState((s) => {
      const key = termKey(course.term);
      let next = ensureWorkspace(s, course.term, nowIso);
      next = updateWorkspace(next, key, (ps) => {
        let out = planId ? switchActive(ps, planId) : ps;
        out = updateActivePlan(out, (prev) => {
          const existing = prev.entries.find((e) => e.course.id === course.id);
          if (existing) {
            return {
              ...prev,
              entries: prev.entries.map((e) =>
                e.course.id === course.id ? { ...e, course, selectedOptionId: optionId } : e,
              ),
            };
          }
          return appendEntry(prev, course, optionId);
        }, nowIso);
        return addBrowsed(out, out.activeId, [course.id], nowIso);
      });
      return switchTermIn(next, key);
    });
  }, []);

  const addCourseWithOption = useCallback((course: CourseOffering, optionId: string) => {
    setPool((prev) => mergeCourses(prev, [course]));
    addIntoTerm(course, optionId, null);
  }, [addIntoTerm]);

  const pendingAdd = pendingQueue[0] ?? null;
  const confirmPendingAdd = useCallback((planId: string) => {
    const head = pendingQueue[0];
    if (!head) return;
    addIntoTerm(head.course, head.optionId, planId);
    setPendingQueue((q) => q.slice(1));
  }, [pendingQueue, addIntoTerm]);
  const cancelPendingAdd = useCallback(() => {
    const head = pendingQueue[0];
    if (!head) return;
    // The capture still happened — keep it as a browsed record in that term's active plan.
    const nowIso = new Date().toISOString();
    setTermsState((s) => {
      const key = termKey(head.course.term);
      const next = ensureWorkspace(s, head.course.term, nowIso);
      return updateWorkspace(next, key, (ps) => addBrowsed(ps, ps.activeId, [head.course.id], nowIso));
    });
    setPendingQueue((q) => q.slice(1));
  }, [pendingQueue]);
```

`addCourse` (plain) additionally records browsed membership — change its `setPlan` call to go through `setPlans`:

```ts
  const addCourse = useCallback((course: CourseOffering) => {
    setPlans((ps) => {
      const withEntry = updateActivePlan(ps, (prev) => {
        if (prev.entries.some((e) => e.course.id === course.id)) return prev;
        return appendEntry(prev, course, course.options[0]?.id ?? null);
      }, new Date().toISOString());
      return addBrowsed(withEntry, withEntry.activeId, [course.id], new Date().toISOString());
    });
  }, [setPlans]);
```

9. **Browsed list actions + selector** (replace `removeFromPool`/`clearBrowsed`/`browsedNotAdded`):

```ts
  /** Drop a browsed course from THIS plan's own list (per-plan, per-term). */
  const removeFromPool = useCallback((courseId: string) => {
    setPlans((ps) => removeBrowsed(ps, [courseId], new Date().toISOString()));
  }, [setPlans]);

  /** Clear this plan's browsed list — added courses keep their membership. */
  const clearBrowsed = useCallback(() => {
    const added = new Set(plan.entries.map((e) => e.course.id));
    const ids = (active.browsed ?? []).filter((id) => !added.has(id));
    setPlans((ps) => removeBrowsed(ps, ids, new Date().toISOString()));
  }, [plan, active, setPlans]);

  /** THIS plan's browsed list, minus courses already added, resolved from the pool repository. */
  const browsedNotAdded = useMemo(() => {
    const added = new Set(plan.entries.map((e) => e.course.id));
    const byId = new Map(pool.map((c) => [c.id, c]));
    return (active.browsed ?? [])
      .filter((id) => !added.has(id))
      .map((id) => byId.get(id))
      .filter((c): c is CourseOffering => c !== undefined);
  }, [pool, plan, active]);
```

10. **Received-plan saves route by term** (`saveReceivedAsNewPlan` — replace the `setPlansState(addPlan(...))` line):

```ts
      const nowIso = new Date().toISOString();
      setTermsState((s) => {
        const key = termKey(incoming.term);
        let next = ensureWorkspace(s, incoming.term, nowIso);
        next = updateWorkspace(next, key, (ps) => {
          const withPlan = addPlan(ps, incoming, name, nowIso);
          return addBrowsed(withPlan, withPlan.activeId, incoming.entries.map((e) => e.course.id), nowIso);
        });
        return switchTermIn(next, key);
      });
```

`saveReceivedAsMine` keeps its shape (replacePlan → active plan of the CURRENT term) but must refuse cross-term replaces — guard at its top:

```ts
    if (received && termKey(received.plan.term) !== termsRef.current.activeTermKey) {
      // Different term: replacing the current term's plan with it would corrupt both.
      saveReceivedAsNewPlan(`Shared plan`);
      return;
    }
```

11. **readOnly + return block**: `const readOnly = (viewing === 'received' && received !== null) || archived;` and add to the returned object: `activeTermKey: termsState.activeTermKey, termList, archived, switchTerm, pendingAdd, confirmPendingAdd, cancelPendingAdd`.

- [ ] **Step 1: Apply the changes above** (there is no isolated unit test for the hook — the pure logic is already covered by Tasks 1–9; the full suite + typecheck is the gate here, then Task 12's E2E).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`activeHidden`/`hideInActivePlan` are still exported from plans.ts, now unused by the hook — that's fine until Task 13.)

- [ ] **Step 3: Run the FULL web suite**

Run: `npm test -w @triton/web`
Expected: all green. Share tests passing UNCHANGED is the "wire formats untouched" regression proof.

- [ ] **Step 4: Manual smoke via dev server**

Run: `npm run dev -w @triton/web`, open http://localhost:5173 — dev sample courses appear in the browsed list (the migration seeds `browsed` from the pool), adding/removing/plan-switching all behave as before.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/usePlan.ts
git commit -m "refactor(web): usePlan on TermsState — per-term workspaces, routing, archive freeze"
```

---

### Task 11: PlanPickerModal (plan-add chooser)

**Files:**
- Create: `web/src/components/PlanPickerModal.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles/app.css`

**Interfaces:**
- Consumes: `ctl.pendingAdd`, `ctl.confirmPendingAdd(planId)`, `ctl.cancelPendingAdd()`, `ctl.plans` shape from Task 10; `displayTermLabel` from `./lib/terms`.
- Produces: `<PlanPickerModal course plans onPick onCancel />`.

- [ ] **Step 1: Read `web/src/components/QrPopover.tsx` and mirror its centered-overlay shell** (scrim + centered card classes — reuse the same `.mappop`-family class names it uses so the modal inherits the existing overlay styling), then create:

```tsx
// web/src/components/PlanPickerModal.tsx
/** "+ TritonPlan" landed in a term that has several plans — ask which one.
 *  Shown by App when ctl.pendingAdd is non-null; queued adds surface one at a time. */
import { useEffect } from 'react';
import type { CourseOffering } from '@triton/shared';
import { displayTermLabel } from '../lib/terms';

interface Props {
  course: CourseOffering;
  plans: { id: string; name: string; count: number }[];
  onPick: (planId: string) => void;
  onCancel: () => void;
}

export function PlanPickerModal({ course, plans, onPick, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="mappop__scrim" onClick={onCancel} role="presentation">
      <div
        className="mappop planpick"
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${course.courseCode} to a plan`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="planpick__title">
          Add <span className="mono">{course.courseCode}</span> to…
        </h2>
        <p className="planpick__sub">
          {displayTermLabel(course.term)} has several plans. Pick one:
        </p>
        <div className="planpick__list">
          {plans.map((p) => (
            <button key={p.id} type="button" className="planpick__item" onClick={() => onPick(p.id)}>
              <span className="planpick__name">{p.name}</span>
              <span className="planpick__count">{p.count} courses</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--sm planpick__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
```

IMPORTANT: the `plans` prop must list the plans of the COURSE's term, not the viewed term. In App.tsx the picker renders only when `ctl.pendingAdd` exists — and Task 10's `onPlanAdd` queues only when the course's own term has >1 plans; by then `switchViewing('mine')` ran but the term may differ from the active one. Expose the right list from the hook instead of guessing in App: in usePlan add to the return block —

```ts
    pendingAddPlans:
      pendingAdd === null
        ? []
        : (termsState.terms[termKey(pendingAdd.course.term)]?.plans.plans ?? []).map((p) => ({
            id: p.id, name: p.name, count: p.plan.entries.length,
          })),
```

- [ ] **Step 2: Wire in App.tsx** — next to the other overlays (after `BuildingPopover`):

```tsx
      {ctl.pendingAdd && (
        <PlanPickerModal
          course={ctl.pendingAdd.course}
          plans={ctl.pendingAddPlans}
          onPick={ctl.confirmPendingAdd}
          onCancel={ctl.cancelPendingAdd}
        />
      )}
```

with `import { PlanPickerModal } from './components/PlanPickerModal';`.

- [ ] **Step 3: Styles** — append to `web/src/styles/app.css` (match the file's existing token names — check how `.menu`/`.mappop` rules color borders/text and reuse those variables verbatim):

```css
/* ---- plan-add picker (term has several plans) ---- */
.planpick { max-width: 380px; }
.planpick__title { margin: 0 0 4px; font-size: 16px; }
.planpick__sub { margin: 0 0 12px; font-size: 13px; }
.planpick__list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.planpick__item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; border-radius: 8px; cursor: pointer; text-align: left;
}
.planpick__name { font-weight: 600; }
.planpick__count { font-size: 12px; }
.planpick__cancel { width: 100%; }
```

- [ ] **Step 4: Verify** — `npm run typecheck && npm test -w @triton/web` green; dev-server smoke: with two plans in the active term, paste into the console

```js
const c = JSON.parse(localStorage.getItem('triton-planner:pool:v1'))[0];
window.postMessage({ source: 'triton-planner-extension', type: 'plan-add', version: 1, payload: { course: c, selectedOptionId: c.options[0].id } }, location.origin);
```

→ the picker appears; picking adds to that plan; Esc cancels.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PlanPickerModal.tsx web/src/App.tsx web/src/styles/app.css
git commit -m "feat(web): plan-add picker modal for multi-plan terms"
```

---

### Task 12: TermSwitcher panel + Topbar/App wiring + styles

**Files:**
- Create: `web/src/components/TermSwitcher.tsx`
- Modify: `web/src/components/Topbar.tsx` (replace `termLabel` prop with `termSlot`), `web/src/App.tsx`, `web/src/styles/app.css`

**Interfaces:**
- Consumes: `buildSwitcherRows`, `displayTermLabel`, `TermKey` (Tasks 1–3); `ctl.termList/activeTermKey/archived/switchTerm` (Task 10); `useClickAway` hook (same pattern as Topbar's import menu).
- Produces: `<TermSwitcher terms activeKey activeLabel archived onSwitch />`; Topbar prop change `termLabel: string` → `termSlot: ReactNode`.

- [ ] **Step 1: Create the component**

```tsx
// web/src/components/TermSwitcher.tsx
/** The topbar term chip, upgraded to a switcher: anchored panel with one row
 *  per academic year (Fall | Winter | Spring), a bold divider, then Summer
 *  rows. Grey placeholder cells are not clickable (spec §5). */
import { useRef, useState } from 'react';
import type { Term } from '@triton/shared';
import { buildSwitcherRows, type SwitcherCell, type TermKey } from '../lib/terms';
import { useClickAway } from '../hooks/useClickAway';
import { ChevronDown } from './icons';

interface Props {
  terms: Term[];
  activeKey: TermKey;
  activeLabel: string;
  archived: boolean;
  onSwitch: (key: TermKey) => void;
}

function Cell({ cell, onPick }: { cell: SwitcherCell; onPick: (key: TermKey) => void }) {
  if (!cell.selectable || cell.key === null) {
    return <span className="termsw__cell termsw__cell--placeholder">{cell.label}</span>;
  }
  return (
    <button
      type="button"
      className={`termsw__cell${cell.current ? ' termsw__cell--current' : ''}${cell.archived ? ' termsw__cell--archived' : ''}`}
      onClick={() => onPick(cell.key!)}
    >
      {cell.label}
      {cell.archived && <span className="termsw__tag">archived</span>}
    </button>
  );
}

export function TermSwitcher({ terms, activeKey, activeLabel, archived, onSwitch }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(open, ref, () => setOpen(false));
  const rows = buildSwitcherRows(terms, activeKey, new Date());

  const pick = (key: TermKey) => {
    setOpen(false);
    onSwitch(key);
  };

  return (
    <div className="termsw" ref={ref}>
      <button
        type="button"
        className="topbar__term termsw__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="eyebrow">Term</span>
        <span className="topbar__term-label">
          {activeLabel}
          {archived && <span className="termsw__tag">archived</span>}
          <ChevronDown size={12} />
        </span>
      </button>
      {open && (
        <div className="termsw__panel" role="menu">
          {rows.quarterRows.map((row, i) => (
            <div className="termsw__row" key={`q${i}`}>
              {row.map((cell, j) => (
                <Cell cell={cell} onPick={pick} key={j} />
              ))}
            </div>
          ))}
          {rows.summerRows.length > 0 && <div className="termsw__divider" />}
          {rows.summerRows.map((row, i) => (
            <div className="termsw__row termsw__row--summer" key={`s${i}`}>
              {row.map((cell, j) => (
                <Cell cell={cell} onPick={pick} key={j} />
              ))}
            </div>
          ))}
          {rows.otherRows.map((cell) => (
            <div className="termsw__row termsw__row--other" key={cell.key ?? cell.label}>
              <Cell cell={cell} onPick={pick} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Topbar prop swap** — in `Topbar.tsx` replace `termLabel: string;` with `termSlot: ReactNode;` in Props, replace the parameter, and replace the term `<div>` (lines 68-71) with `{termSlot}`.

- [ ] **Step 3: App wiring** — replace `termLabel={ctl.viewPlan.term.label}` with:

```tsx
        termSlot={
          ctl.viewing === 'received' && ctl.received ? (
            <div className="topbar__term">
              <span className="eyebrow">Term</span>
              <span className="topbar__term-label">{displayTermLabel(ctl.viewPlan.term)}</span>
            </div>
          ) : (
            <TermSwitcher
              terms={ctl.termList}
              activeKey={ctl.activeTermKey}
              activeLabel={displayTermLabel(ctl.viewPlan.term)}
              archived={ctl.archived}
              onSwitch={ctl.switchTerm}
            />
          )
        }
```

with imports `TermSwitcher` and `displayTermLabel`.

- [ ] **Step 4: Styles** — append to app.css, and FIND the mobile rule near line 2057 that hides `.topbar__term`: change it to keep the chip visible (compact — drop the `.eyebrow` on mobile instead of the whole chip). Then:

```css
/* ---- term switcher ---- */
.termsw { position: relative; }
.termsw__trigger { cursor: pointer; background: none; border: none; padding: 0; text-align: left; }
.termsw__trigger .topbar__term-label { display: inline-flex; align-items: center; gap: 4px; }
.termsw__tag {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 1px 5px; border-radius: 4px; margin-left: 6px;
  /* reuse the muted-tag colors of the existing .tag styles in this file */
}
.termsw__panel {
  position: absolute; top: calc(100% + 8px); left: 0; z-index: 60;
  min-width: 420px; padding: 12px; border-radius: 10px;
  /* card background/border/shadow: copy the exact declarations of .menu */
}
.termsw__row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 6px; }
.termsw__row--summer { grid-template-columns: repeat(2, 1fr); }
.termsw__row--other { grid-template-columns: 1fr; }
.termsw__cell {
  padding: 8px 10px; border-radius: 8px; font-size: 13px; text-align: center;
  border: 1px solid transparent; background: none; cursor: pointer;
}
.termsw__cell--current { /* course-accent outline: reuse the ring style of .opt--active */ }
.termsw__cell--placeholder { cursor: default; opacity: 0.45; }
.termsw__divider { border-top: 2px solid; margin: 10px 0; /* --line-strong or equivalent */ }
@media (max-width: 720px) {
  .termsw__panel { position: fixed; left: 12px; right: 12px; top: auto; bottom: 12px; min-width: 0; }
}
```

(The comments mark where to copy exact declarations from existing rules — resolve them while editing, don't ship the comments.)

- [ ] **Step 5: Verify** — `npm run typecheck && npm test -w @triton/web`; dev-server smoke: chip opens the panel; a lone Fall 2026 shows one row with two grey placeholders; simulate a Winter course push in the console (courses message with a `term: { year:'2027', period:'3', … }` course, id suffix `|2027|3`) → panel gains a live "Winter 2026" cell and the view auto-switches.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/TermSwitcher.tsx web/src/components/Topbar.tsx web/src/App.tsx web/src/styles/app.css
git commit -m "feat(web): term switcher panel in the topbar"
```

---

### Task 13: cleanup — retire the hidden mechanism + copy tweaks

**Files:**
- Modify: `web/src/lib/plans.ts`, `web/src/lib/plans.test.ts`, `web/src/components/OptionPicker.tsx`, `web/src/components/CoursePanel.tsx` (copy only)

- [ ] **Step 1:** Delete `activeHidden` and `hideInActivePlan` from plans.ts and their describe blocks from plans.test.ts. KEEP the `hidden?: string[]` FIELD on NamedPlan (it is migration input read by `migrateToTermsState`) — update its doc comment to say exactly that. Delete the `hidden` copy line in `duplicatePlan` (browsed copy stays).
- [ ] **Step 2:** Grep for stragglers: `grep -rn "activeHidden\|hideInActivePlan" web/src` → must return nothing.
- [ ] **Step 3:** OptionPicker.tsx:69 — the read-only tooltip says "save this plan as yours to switch sections", which is received-specific; archived plans now hit it too. Change the `title` to `'Read-only plan — sections can’t be changed'`.
- [ ] **Step 4:** CoursePanel.tsx:47 — read the read-only empty-state copy near it; if it references "shared plan" specifically, generalize to cover archived terms ("This plan is read-only"). Keep edits copy-only.
- [ ] **Step 5:** `npm run typecheck && npm test -w @triton/web` → green.
- [ ] **Step 6: Commit**

```bash
git add -A web/src
git commit -m "refactor(web): retire per-plan hidden mechanism (superseded by browsed lists)"
```

---

### Task 14: full verification + E2E + docs handoff

**Files:**
- Create (scratchpad, NOT committed): `<scratchpad>/term-switcher-e2e.js`
- Modify: `PROGRESS.md` (gitignored — updated, never committed)

- [ ] **Step 1: Full gates**

Run: `npm test` (all workspaces — extension's 61 and shared's 16 must be untouched), `npm run typecheck`, `npm run build -w @triton/web`.
Expected: all green; build succeeds.

- [ ] **Step 2: E2E script** (puppeteer-core against `npm run dev -w @triton/web`, repo convention — see PROGRESS.md 2026-08-09 entries for the pattern). Scenarios and assertions:

1. **Migration pixel-parity**: pre-seed `localStorage['triton-planner:plans:v1']` with a two-plan Fall state (one hidden id) + matching `pool:v1`; load → browsed list shows exactly (pool − hidden), plan entries intact; `terms:v1` now exists in localStorage.
2. **Cross-term routing**: postMessage a `courses` payload containing one fresh Winter course (`term {year:'2027', period:'3'}`, id `…|2027|3`, capturedAt now) → topbar chip reads "Winter 2026", panel shows the Fall row with Winter cell live, browsed list contains ONLY the Winter course, and switching back to Fall shows Fall's list unchanged (independence).
3. **Per-plan browsed independence**: in Winter create "Plan 2" → its browsed list is EMPTY; push another fresh Winter course → it appears in Plan 2 (the active plan) only.
4. **Plan picker**: with Winter holding 2 plans, postMessage a `plan-add` for a Winter course → `.planpick` appears listing both plans; click one → course lands in that plan and the view switches to it; queue a second plan-add and press Escape → modal closes, course id present in the active plan's browsed list but not its entries.
5. **Archive**: rebuild state so Fall has courses AND a Winter workspace exists, then reload with a mocked clock (inject a `Date` override via `page.evaluateOnNewDocument` to 2026-12-25 — `page.emulateTimezone` is not enough): default view is Winter (newest wins); open the panel → the Fall cell carries the archived tag; switch to Fall → Clear button hidden, × buttons gone, browsed list empty; a `forget-courses` postMessage was observed (install a `window.addEventListener('message', …)` recorder via evaluateOnNewDocument); reload again → no second forget-courses (idempotent).
6. **Empty archived term vanishes**: seed an EMPTY Fall workspace + mocked Dec 25 clock → Fall appears only as a grey placeholder cell.

- [ ] **Step 3: Run the E2E script; fix what it catches; re-run until 6/6 pass.**

- [ ] **Step 4: Update PROGRESS.md** (Chinese, snapshot style per CLAUDE.md): new section for the term switcher — what shipped, the four Nov-2026 calibration items from spec §7 (Winter/Spring codes, AcYear semantics, TSS's displayed year, summer code granularity), and that `plans:v1`/`plan:v1` are rollback backstops.

- [ ] **Step 5: Final commit + hand back to the user**

```bash
git add -A
git commit -m "feat(web): term switcher — per-term workspaces, browsed lists, archiving"
```

Then START the dev server (`npm run dev -w @triton/web`) and hand off: per the user's standing preference, web changes are previewed locally by the user BEFORE any push; pushing to main (auto-deploys Pages) is the user's call. Do not push.

---

## Plan Self-Review (done at authoring time)

- **Spec coverage**: §3 data model → Tasks 4–6, 8, 10; §4 migration/bootstrap/share-untouched → Tasks 6, 10 (share proven by untouched tests, Task 10 Step 3); §5 panel → Tasks 3, 12; §6 timeline/archive/read-only → Tasks 2, 7, 10 (readOnly composite), 13; §7 naming/fallbacks → Tasks 1–3; §8 error handling → guards in Tasks 6 (isTermsState), 7–8 (archived defensives), 10 (queue discard); §9 tests → per-task TDD + Task 14 E2E; §11 acceptance → Task 14 scenarios 1–6 map to criteria 1–5, criterion 6 = Step 1 gates.
- **Known intentional deviations**: none. `pendingAddPlans` was added beyond the spec's surface as a wiring necessity (documented in Task 11).
- **Type consistency check**: `TermKey`/`TermsState`/`TermWorkspace`/`SwitcherCell`/`RouteResult`/`SweepResult` names are used identically across Tasks 1–12; controller field names in Tasks 10–12 match (`termList`, `activeTermKey`, `archived`, `switchTerm`, `pendingAdd`, `pendingAddPlans`, `confirmPendingAdd`, `cancelPendingAdd`).
