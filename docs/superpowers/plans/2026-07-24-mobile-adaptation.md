# Mobile Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TritonPlan web planner fully usable on phones (bottom tab bar, dual calendar views, tap-block detail sheet) and upgrade sharing to a v3 full-data format with QR codes and automatic URL sync.

**Architecture:** Pure-web change (extension untouched, no store release). Four layers, built bottom-up: (1) a new deflate-compressed "v3 full" share codec beside the existing lz-string formats; (2) QR generation + capacity fallback as pure functions; (3) Share-menu rework and address-bar auto-sync with echo detection; (4) a ≤760px mobile shell (Courses | Calendar | Finals bottom tabs, fit-week ⇄ day-scroll calendar variants, block detail sheet).

**Tech Stack:** React 18 + Vite + TypeScript (strict, `noUncheckedIndexedAccess`), vitest + jsdom, new deps `fflate@^0.8.3` and `qrcode-generator@^2.0.4` (both tiny, zero transitive deps, bundled locally — zero network requests at runtime).

**Spec:** `docs/superpowers/specs/2026-07-24-mobile-design.md` (user-approved).

## Global Constraints

- All conversation with the user is Chinese; ALL code, comments, commit messages, and **user-facing UI copy are English**. Format names in UI: **"Full"** and **"Lite"** (docs may say 完整版/简略版).
- Zero backend, zero runtime network requests. QR + compression libs are bundled; never fetch anything.
- Never inline bridge/message strings (they live in `extension/src/config.ts` / `web/src/lib/bridge.ts`); this plan does not touch the bridge protocol.
- Old share links must decode forever: decode order `3~` v3 → v2 slim → v1 legacy. Never write to legacy storage key `triton-planner:plan:v1`.
- Received-plan semantics unchanged: an incoming link NEVER overwrites the user's plans; it lands in the received slot, read-only.
- Desktop (>760px) layout must be pixel-identical except the Share menu rework. Existing 141 tests must stay green (plus new ones).
- Non-interactive shells need `export PATH="/opt/homebrew/bin:$PATH"` before npm/node commands. Run all workspace commands from repo root `/Users/duzijue/Desktop/vc/plan`.
- Commit after every task with the trailer lines:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_0164Ebu6hNyvrvZZ1heXRpfW`
- Version numbers change only at user-decided release packaging — do NOT bump any version in this plan.

---

### Task 1: v3 full share codec (`share-v3.ts`) + share.ts format API

**Files:**
- Modify: `web/package.json` (add dep `fflate`)
- Create: `web/src/lib/share-v3.ts`
- Create: `web/src/lib/share-v3.test.ts`
- Modify: `web/src/lib/share.ts` (format param, v3 decode branch, `tokenFromHash`)
- Modify: `web/src/lib/share.test.ts` (make existing slim assertions explicit `'lite'`)

**Interfaces:**
- Consumes: `PlanState`/`CourseOffering`/`SectionOption`/`Component`/`Meeting`/`FinalExam`/`PrereqGroup` from `@triton/shared`; `isPlanState` from `./storage`; existing `toSlim`/`fromSlim` in share.ts.
- Produces (later tasks rely on exactly these):
  - `share-v3.ts`: `export const V3_PREFIX = '3~'`, `export function encodePlanV3(plan: PlanState): string`, `export function decodePlanV3(token: string): PlanState | null`
  - `share.ts`: `export type ShareFormat = 'full' | 'lite'`, `encodePlan(plan: PlanState, format?: ShareFormat): string` (default `'full'`), `decodePlan(token: string): PlanState | null` (now v3-aware), `planToHash(plan: PlanState, format?: ShareFormat): string`, `shareUrl(plan: PlanState, format?: ShareFormat, base?: string): string`, `export function tokenFromHash(hash: string): string | null`

- [ ] **Step 1: Install fflate**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd /Users/duzijue/Desktop/vc/plan && npm install fflate@^0.8.3 -w @triton/web
```
Expected: lockfile updated, `web/package.json` dependencies gains `"fflate": "^0.8.3"`.

- [ ] **Step 2: Write the failing tests** — `web/src/lib/share-v3.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { CourseOffering, PlanState, Weekday } from '@triton/shared';
import { V3_PREFIX, decodePlanV3, encodePlanV3 } from './share-v3';

/** Realistic course: 1 shared lecture + per-option discussion, prereqs, capturedAt. */
function makeCourse(seed: number, nOpts: number): CourseOffering {
  const code = `TEST-${100 + seed}`;
  const lecture = {
    id: `E 0000${1000 + seed}`,
    type: 'LE',
    typeText: 'Lecture',
    sectionCode: '001-000',
    instructors: ['Joshua Figueroa'],
    meetings: [
      {
        days: ['Mon', 'Wed', 'Fri'] as Weekday[],
        start: '09:00',
        end: '09:50',
        modality: 'In Person',
        building: 'York Hall',
        room: '2622',
        location: 'York Hall Room 2622',
      },
    ],
    unscheduled: false,
    rawSched: 'M, W, F 09:00 AM - 09:50 AM In Person @ York Hall Room 2622',
  };
  return {
    id: `${code}|2026|2`,
    moduleId: String(2000 + seed),
    subject: 'TEST',
    number: String(100 + seed),
    courseCode: code,
    title: `Test Course ${seed}`,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    units: 4,
    capturedAt: '2026-07-24T10:00:00.000Z',
    prereqs: [{ label: '1 of the following:', options: ['TEST-001 - Intro with a D or higher'] }],
    options: Array.from({ length: nOpts }, (_, i) => ({
      id: `SE00${152000 + seed * 100 + i}`,
      code: `P-001-00${i + 1}`,
      enrollCode: `SE00${152000 + seed * 100 + i}`,
      limit: 16 + i,
      seatsAvailable: (i * 3) % 17,
      final: { date: '2026-12-07', start: '08:00', end: '10:59', modality: 'In Person' },
      components: [
        structuredClone(lecture),
        {
          id: `E 0000${2000 + seed * 10 + i}`,
          type: 'DI',
          typeText: 'Discussion',
          sectionCode: `001-0${20 + i}`,
          instructors: ['Joshua Figueroa'],
          meetings: [
            {
              days: [i % 2 ? 'Tue' : 'Thu'] as Weekday[],
              start: `${10 + (i % 7)}:00`.padStart(5, '0'),
              end: `${10 + (i % 7)}:50`.padStart(5, '0'),
              modality: 'In Person',
              building: 'Center Hall',
              room: '119',
              location: 'Center Hall Room 119',
            },
          ],
          unscheduled: false,
          rawSched: 'x',
        },
      ],
    })),
  } as CourseOffering;
}

function makePlan(nCourses: number, nOpts: number): PlanState {
  return {
    version: 1,
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    entries: Array.from({ length: nCourses }, (_, i) => {
      const course = makeCourse(i, nOpts);
      return { course, selectedOptionId: course.options[1]?.id ?? course.options[0]!.id, color: String(140 + i) };
    }),
  };
}

describe('encodePlanV3 / decodePlanV3', () => {
  it('round-trips ALL section options, selection, prereqs and capturedAt', () => {
    const plan = makePlan(3, 5);
    const token = encodePlanV3(plan);
    expect(token.startsWith(V3_PREFIX)).toBe(true);
    const back = decodePlanV3(token);
    expect(back).not.toBeNull();
    expect(back!.entries).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const src = plan.entries[i]!;
      const dst = back!.entries[i]!;
      expect(dst.course.options).toHaveLength(5); // full fidelity: every option survives
      expect(dst.selectedOptionId).toBe(src.selectedOptionId);
      expect(dst.color).toBe(src.color);
      expect(dst.course.courseCode).toBe(src.course.courseCode);
      expect(dst.course.units).toBe(4);
      expect(dst.course.capturedAt).toBe('2026-07-24T10:00:00.000Z');
      expect(dst.course.prereqs).toEqual(src.course.prereqs);
      const o = dst.course.options[2]!;
      const so = src.course.options[2]!;
      expect(o.enrollCode).toBe(so.enrollCode);
      expect(o.seatsAvailable).toBe(so.seatsAvailable);
      expect(o.limit).toBe(so.limit);
      expect(o.final).toEqual(so.final);
      expect(o.components.map((c) => c.sectionCode)).toEqual(so.components.map((c) => c.sectionCode));
      expect(o.components[0]!.meetings).toEqual(so.components[0]!.meetings);
    }
  });

  it('shares one lecture component object across options (dedup by component id)', () => {
    const back = decodePlanV3(encodePlanV3(makePlan(1, 4)))!;
    const opts = back.entries[0]!.course.options;
    expect(opts[0]!.components[0]).toBe(opts[3]!.components[0]); // same reference = table dedup worked
  });

  it('preserves an empty prereqs array ([] = confirmed none) and absent prereqs (undefined)', () => {
    const plan = makePlan(2, 2);
    plan.entries[0]!.course.prereqs = [];
    delete plan.entries[1]!.course.prereqs;
    const back = decodePlanV3(encodePlanV3(plan))!;
    expect(back.entries[0]!.course.prereqs).toEqual([]);
    expect(back.entries[1]!.course.prereqs).toBeUndefined();
  });

  it('keeps a 5-course / all-options plan comfortably inside the QR budget', () => {
    const token = encodePlanV3(makePlan(5, 8));
    expect(token.length).toBeLessThan(2500); // measured prototype: ~1.8K for this density
  });

  it('rejects garbage tokens', () => {
    expect(decodePlanV3('3~not-base64!!!')).toBeNull();
    expect(decodePlanV3('nonsense')).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd /Users/duzijue/Desktop/vc/plan && npm test -w @triton/web -- share-v3
```
Expected: FAIL — cannot resolve `./share-v3`.

- [ ] **Step 4: Implement `web/src/lib/share-v3.ts`**

```ts
/**
 * v3 "Full" share format: the whole plan INCLUDING every section option,
 * prereqs and capturedAt — so the receiving device can switch sections after
 * saving the plan. Wire shape is a compact JSON (short keys, positional
 * arrays, per-course component table deduped by component id), deflated with
 * fflate and base64url-encoded. Token = "3~" + base64url(deflateRaw(json)).
 *
 * Dropped on purpose (debug/source-only, not rendered): rawSched, ids of
 * options/components (regenerated), instructorEmails, beginDate/endDate,
 * waitlist, status. JSON export (Import → Upload) remains the lossless path.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type {
  Component,
  CourseOffering,
  FinalExam,
  Meeting,
  PlanState,
  PrereqGroup,
  SectionOption,
  TeachingMethod,
  Term,
  Weekday,
} from '@triton/shared';

export const V3_PREFIX = '3~';

type WireMeeting = [
  days: Weekday[],
  start: string,
  end: string,
  modality: string,
  building: string,
  room: string,
  location: string,
];
type WireFinal = [date: string, start: string, end: string, modality: string];
type WireComp = [
  type: TeachingMethod,
  typeText: string,
  sectionCode: string,
  instructors: string[],
  meetings: WireMeeting[],
];
type WireOpt = [
  code: string,
  enrollCode: string,
  seats: number, // -1 = undefined
  limit: number, // -1 = undefined
  final: WireFinal | 0,
  compIdx: number[],
];
interface WireEntry {
  c: string; // courseCode
  ti: string; // title
  mi: string; // moduleId
  u?: number; // units
  k?: string; // entry color
  ca?: string; // capturedAt
  pq?: Array<[string, string[]]>; // prereqs groups; absent = not captured, [] = none
  x: WireComp[]; // deduped component table
  o: WireOpt[]; // options referencing x by index
  si: number; // selected option index
}
interface WirePlan {
  v: 3;
  y: string;
  p: string;
  l: string;
  e: WireEntry[];
}

function packMeeting(m: Meeting): WireMeeting {
  return [m.days, m.start, m.end, m.modality, m.building ?? '', m.room ?? '', m.location ?? ''];
}

function packEntry(course: CourseOffering, selectedOptionId: string | null, color?: string): WireEntry {
  const table: WireComp[] = [];
  const idxByKey = new Map<string, number>();
  const compIdx = (comp: Component): number => {
    // Component ids are stable per TSS event and shared across options; fall
    // back to a structural key when the id is empty (defensive).
    const key = comp.id || JSON.stringify([comp.type, comp.sectionCode, comp.meetings]);
    const hit = idxByKey.get(key);
    if (hit !== undefined) return hit;
    idxByKey.set(key, table.length);
    table.push([comp.type, comp.typeText, comp.sectionCode, comp.instructors, comp.meetings.map(packMeeting)]);
    return table.length - 1;
  };
  const opts: WireOpt[] = course.options.map((o) => [
    o.code,
    o.enrollCode,
    o.seatsAvailable ?? -1,
    o.limit ?? -1,
    o.final ? [o.final.date, o.final.start, o.final.end, o.final.modality ?? ''] : 0,
    o.components.map(compIdx),
  ]);
  const si = Math.max(0, course.options.findIndex((o) => o.id === selectedOptionId));
  const out: WireEntry = { c: course.courseCode, ti: course.title, mi: course.moduleId, x: table, o: opts, si };
  if (course.units !== undefined) out.u = course.units;
  if (color !== undefined) out.k = color;
  if (course.capturedAt !== undefined) out.ca = course.capturedAt;
  if (course.prereqs !== undefined) out.pq = course.prereqs.map((g) => [g.label, g.options]);
  return out;
}

function meetingFromWire(m: WireMeeting): Meeting {
  const [days, start, end, modality, building, room, location] = m;
  const out: Meeting = { days, start, end, modality };
  if (building) out.building = building;
  if (room) out.room = room;
  if (location) out.location = location;
  return out;
}

function entryFromWire(en: WireEntry, term: Term): PlanState['entries'][number] | null {
  const comps: Component[] = en.x.map((c, i) => {
    const [type, typeText, sectionCode, instructors, meetings] = c;
    return {
      id: `x${i}`,
      type,
      typeText,
      sectionCode,
      instructors: instructors ?? [],
      meetings: (meetings ?? []).map(meetingFromWire),
      unscheduled: (meetings ?? []).length === 0,
      rawSched: '',
    };
  });
  const options: SectionOption[] = en.o.map((o) => {
    const [code, enrollCode, seats, limit, fin, compIdx] = o;
    const out: SectionOption = {
      id: enrollCode,
      code,
      enrollCode,
      components: compIdx.map((i) => comps[i]).filter((c): c is Component => c !== undefined),
    };
    if (seats >= 0) out.seatsAvailable = seats;
    if (limit >= 0) out.limit = limit;
    if (fin !== 0) {
      const [date, start, end, modality] = fin;
      const final: FinalExam = { date, start, end };
      if (modality) final.modality = modality;
      out.final = final;
    }
    return out;
  });
  const selected = options[en.si] ?? options[0];
  if (!selected) return null;
  const dash = en.c.indexOf('-');
  const course: CourseOffering = {
    id: `${en.c}|${term.year}|${term.period}`,
    moduleId: en.mi,
    subject: dash > 0 ? en.c.slice(0, dash) : en.c,
    number: dash > 0 ? en.c.slice(dash + 1) : '',
    courseCode: en.c,
    title: en.ti,
    term,
    options,
    ...(en.u !== undefined ? { units: en.u } : {}),
    ...(en.ca !== undefined ? { capturedAt: en.ca } : {}),
    ...(en.pq !== undefined
      ? { prereqs: en.pq.map(([label, options]): PrereqGroup => ({ label, options })) }
      : {}),
  };
  return { course, selectedOptionId: selected.id, ...(en.k !== undefined ? { color: en.k } : {}) };
}

/* base64url helpers — chunked to stay under the argument-spread limit. */
function toB64u(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function encodePlanV3(plan: PlanState): string {
  const wire: WirePlan = {
    v: 3,
    y: plan.term.year,
    p: plan.term.period,
    l: plan.term.label,
    e: plan.entries.map((en) => packEntry(en.course, en.selectedOptionId, en.color)),
  };
  const packed = deflateSync(strToU8(JSON.stringify(wire)), { level: 9 });
  return V3_PREFIX + toB64u(packed);
}

export function decodePlanV3(token: string): PlanState | null {
  if (!token.startsWith(V3_PREFIX)) return null;
  const bytes = fromB64u(token.slice(V3_PREFIX.length));
  if (!bytes) return null;
  try {
    const wire: unknown = JSON.parse(strFromU8(inflateSync(bytes)));
    if (!wire || typeof wire !== 'object' || (wire as WirePlan).v !== 3) return null;
    const w = wire as WirePlan;
    const term: Term = { year: w.y, period: w.p, label: w.l };
    const entries = (w.e ?? [])
      .map((en) => entryFromWire(en, term))
      .filter((e): e is NonNullable<typeof e> => e !== null);
    return { version: 1, term, entries };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Wire the format API into `web/src/lib/share.ts`**

Add import at top (after the LZString import):
```ts
import { V3_PREFIX, decodePlanV3, encodePlanV3 } from './share-v3';
```
Replace the `encodePlan` / `decodePlan` / `planToHash` / `planFromHash` / `shareUrl` block (lines 178–230) with:
```ts
/** Which wire format a link carries: 'full' (v3, all sections) or 'lite' (v2 slim). */
export type ShareFormat = 'full' | 'lite';

/** Compress a plan into a URL-safe token. Default 'full' carries every section option. */
export function encodePlan(plan: PlanState, format: ShareFormat = 'full'): string {
  if (format === 'full') return encodePlanV3(plan);
  return LZString.compressToEncodedURIComponent(JSON.stringify(toSlim(plan)));
}

/** Inverse of encodePlan. Accepts v3 full, v2 slim and v1 legacy tokens. */
export function decodePlan(token: string): PlanState | null {
  if (token.startsWith(V3_PREFIX)) return decodePlanV3(token);
  try {
    const json = LZString.decompressFromEncodedURIComponent(token);
    if (!json) return null;
    const parsed: unknown = JSON.parse(json);
    if (isSlimPlan(parsed)) return fromSlim(parsed);
    if (isPlanState(parsed)) return parsed; // legacy full-format share link
    return null;
  } catch {
    return null;
  }
}

/** Build a `#p=…` hash fragment (without the leading `#`). */
export function planToHash(plan: PlanState, format: ShareFormat = 'full'): string {
  return `${HASH_KEY}=${encodePlan(plan, format)}`;
}

/** Extract the raw `#p=…` token from a location hash, or null. */
export function tokenFromHash(hash: string): string | null {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!clean) return null;
  return new URLSearchParams(clean).get(HASH_KEY);
}

/** Read a plan out of a raw location hash string ("#p=…" or "p=…"). */
export function planFromHash(hash: string): PlanState | null {
  const token = tokenFromHash(hash);
  if (!token) return null;
  return decodePlan(token);
}

/** A full absolute URL that restores this plan when opened. */
export function shareUrl(plan: PlanState, format: ShareFormat = 'full', base = window.location.href): string {
  const url = new URL(base);
  url.hash = planToHash(plan, format);
  return url.toString();
}
```
(`planFromLinkText` and the JSON helpers stay as they are — the bare-token branch goes through the new `decodePlan`, so pasted v3 links work for free. Update the file-top doc comment to describe both formats.)

- [ ] **Step 6: Update `web/src/lib/share.test.ts`**

Run the suite first; every existing test that called `encodePlan(plan)` / `planToHash(plan)` / `shareUrl(plan)` expecting SLIM semantics (dropped options, "can't switch sections") must now pass `'lite'` explicitly. Do not weaken any assertion. Then append two integration tests:
```ts
it('full links round-trip through decodePlan with every option intact', () => {
  // build any multi-option plan available in this file's helpers
  const token = encodePlan(plan, 'full');
  const back = decodePlan(token)!;
  expect(back.entries[0]!.course.options.length).toBe(plan.entries[0]!.course.options.length);
});

it('tokenFromHash extracts tokens from #p=… and returns null otherwise', () => {
  expect(tokenFromHash('#p=abc')).toBe('abc');
  expect(tokenFromHash('p=abc')).toBe('abc');
  expect(tokenFromHash('#other=1')).toBeNull();
  expect(tokenFromHash('')).toBeNull();
});
```

- [ ] **Step 7: Run web tests + typecheck**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd /Users/duzijue/Desktop/vc/plan && npm test -w @triton/web && npm run typecheck
```
Expected: all web tests PASS (old count + 5 new share-v3 + 2 share), typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add web/package.json package-lock.json web/src/lib/share-v3.ts web/src/lib/share-v3.test.ts web/src/lib/share.ts web/src/lib/share.test.ts
git commit -m "feat(web): v3 full share format — deflate-compressed, all section options in the link"
```

---

### Task 2: QR payload + SVG generation (`lib/qr.ts`)

**Files:**
- Modify: `web/package.json` (add dep `qrcode-generator`)
- Create: `web/src/lib/qr.ts`
- Create: `web/src/lib/qr.test.ts`

**Interfaces:**
- Consumes: `shareUrl(plan, format)` + `ShareFormat` from `./share` (Task 1).
- Produces: `export const QR_URL_BUDGET = 2900`, `export interface QrShare { url: string; mode: ShareFormat }`, `export function qrShareForPlan(plan: PlanState, requested: ShareFormat): QrShare | null` (null = even Lite won't fit), `export function qrSvg(url: string): string` (self-contained `<svg>` markup).

- [ ] **Step 1: Install qrcode-generator**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd /Users/duzijue/Desktop/vc/plan && npm install qrcode-generator@^2.0.4 -w @triton/web
```
If the v2 API differs from the classic one below (check `node_modules/qrcode-generator`), pin `qrcode-generator@^1.4.4` instead — the classic API is required: `qrcode(typeNumber, ecLevel)` → `.addData(str)` / `.make()` / `.createSvgTag(...)`.

- [ ] **Step 2: Write the failing tests** — `web/src/lib/qr.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { PlanState } from '@triton/shared';
import { QR_URL_BUDGET, qrShareForPlan, qrSvg } from './qr';
import { shareUrl } from './share';
import { makePlan } from './share-v3.test-helpers';

describe('qrShareForPlan', () => {
  it('uses the full link when it fits the QR budget', () => {
    const plan = makePlan(3, 5);
    const qr = qrShareForPlan(plan, 'full');
    expect(qr).not.toBeNull();
    expect(qr!.mode).toBe('full');
    expect(qr!.url).toBe(shareUrl(plan, 'full'));
    expect(qr!.url.length).toBeLessThanOrEqual(QR_URL_BUDGET);
  });

  it('degrades to lite when the full link exceeds the budget', () => {
    const plan = makePlan(14, 9); // deliberately huge
    const full = shareUrl(plan, 'full');
    const qr = qrShareForPlan(plan, 'full');
    if (full.length <= QR_URL_BUDGET) return; // guard: plan not big enough — bump sizes above
    expect(qr!.mode).toBe('lite');
  });

  it('honors an explicit lite request without trying full', () => {
    const plan = makePlan(2, 3);
    const qr = qrShareForPlan(plan, 'lite');
    expect(qr!.mode).toBe('lite');
    expect(qr!.url).toBe(shareUrl(plan, 'lite'));
  });
});

describe('qrSvg', () => {
  it('renders scalable standalone SVG markup', () => {
    const svg = qrSvg('https://example.com/#p=3~abc');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
  });
});
```
Extract the `makeCourse`/`makePlan` helpers from Task 1's test into `web/src/lib/share-v3.test-helpers.ts` (exported as-is; vitest excludes non-`.test.ts` files from runs) and import them in both test files.

- [ ] **Step 3: Run to verify failure**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd /Users/duzijue/Desktop/vc/plan && npm test -w @triton/web -- qr
```
Expected: FAIL — cannot resolve `./qr`.

- [ ] **Step 4: Implement `web/src/lib/qr.ts`**

```ts
/**
 * QR share codes, generated fully offline (bundled lib, zero requests).
 * A single QR holds at most ~2953 bytes (version 40, EC level L); we keep a
 * margin. When the Full link is too big, the QR silently carries the Lite
 * link instead — the ShareMenu labels which one the code holds.
 */
import qrcode from 'qrcode-generator';
import type { PlanState } from '@triton/shared';
import { shareUrl, type ShareFormat } from './share';

export const QR_URL_BUDGET = 2900;

export interface QrShare {
  url: string;
  /** Which format actually made it into the code. */
  mode: ShareFormat;
}

/** Pick the best link that fits a QR: requested format first, then Lite, else null. */
export function qrShareForPlan(plan: PlanState, requested: ShareFormat): QrShare | null {
  if (requested === 'full') {
    const full = shareUrl(plan, 'full');
    if (full.length <= QR_URL_BUDGET) return { url: full, mode: 'full' };
  }
  const lite = shareUrl(plan, 'lite');
  if (lite.length <= QR_URL_BUDGET) return { url: lite, mode: 'lite' };
  return null;
}

/** Standalone scalable SVG markup for a QR of the given URL. */
export function qrSvg(url: string): string {
  const qr = qrcode(0, 'L'); // typeNumber 0 = auto-size
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
```
If `createSvgTag({ scalable: true })` is unsupported by the installed version, use `qr.createSvgTag(4, 2)` and post-process: inject `viewBox="0 0 W H" width="100%" height="100%"` by replacing the fixed `width="…" height="…"` attributes (keep the test green).

- [ ] **Step 5: Run tests + typecheck**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd /Users/duzijue/Desktop/vc/plan && npm test -w @triton/web && npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/package.json package-lock.json web/src/lib/qr.ts web/src/lib/qr.test.ts web/src/lib/share-v3.test-helpers.ts web/src/lib/share-v3.test.ts
git commit -m "feat(web): offline QR share codes with automatic full→lite capacity fallback"
```

---

### Task 3: storage additions (synced-token echo marker, calendar view) + sessionStorage test shim

**Files:**
- Modify: `web/src/lib/storage.ts`
- Modify: `web/src/lib/storage.test.ts`
- Modify: `web/src/test-setup.ts`

**Interfaces:**
- Produces:
  - `export function saveSyncedToken(token: string): void` / `export function loadSyncedToken(): string | null` — sessionStorage key `triton-planner:synced-hash:v1`; empty string allowed (means "hash intentionally cleared").
  - `export type CalView = 'fit' | 'scroll'`, `export function loadCalView(): CalView` (default `'fit'`), `export function saveCalView(v: CalView): void` — localStorage key `triton-planner:cal-view:v1`.

- [ ] **Step 1: Extend `web/src/test-setup.ts`** — mirror the existing localStorage shim for sessionStorage (Node ≥22 ships an undefined experimental global that shadows jsdom's). Copy the existing polyfill block, substituting `sessionStorage`.

- [ ] **Step 2: Write failing tests** — append to `web/src/lib/storage.test.ts`:

```ts
describe('synced-token marker', () => {
  it('round-trips and defaults to null', () => {
    expect(loadSyncedToken()).toBeNull();
    saveSyncedToken('3~abc');
    expect(loadSyncedToken()).toBe('3~abc');
    saveSyncedToken('');
    expect(loadSyncedToken()).toBe('');
  });
});

describe('calendar view preference', () => {
  it('defaults to fit and persists scroll', () => {
    expect(loadCalView()).toBe('fit');
    saveCalView('scroll');
    expect(loadCalView()).toBe('scroll');
    saveCalView('fit');
    expect(loadCalView()).toBe('fit');
  });
});
```
(Match the file's existing import style and any `beforeEach` storage-clearing convention already present.)

- [ ] **Step 3: Verify failure**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd /Users/duzijue/Desktop/vc/plan && npm test -w @triton/web -- storage
```
Expected: FAIL — names not exported.

- [ ] **Step 4: Implement in `web/src/lib/storage.ts`** (append near the viewing helpers; reuse the file's try/catch style — sessionStorage/localStorage access must never throw):

```ts
/* --- address-bar auto-sync echo marker (sessionStorage, per-tab) ------------
 * The token we last wrote into #p=… ourselves. On load, a hash that equals
 * this marker is our own echo — NOT an incoming shared plan. */
const SYNCED_KEY = 'triton-planner:synced-hash:v1';

export function saveSyncedToken(token: string): void {
  try {
    sessionStorage.setItem(SYNCED_KEY, token);
  } catch {
    /* storage disabled — ignore */
  }
}

export function loadSyncedToken(): string | null {
  try {
    return sessionStorage.getItem(SYNCED_KEY);
  } catch {
    return null;
  }
}

/* --- mobile calendar view preference ---------------------------------------- */
const CAL_VIEW_KEY = 'triton-planner:cal-view:v1';

export type CalView = 'fit' | 'scroll';

export function loadCalView(): CalView {
  try {
    return localStorage.getItem(CAL_VIEW_KEY) === 'scroll' ? 'scroll' : 'fit';
  } catch {
    return 'fit';
  }
}

export function saveCalView(v: CalView): void {
  try {
    localStorage.setItem(CAL_VIEW_KEY, v);
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 5: Run tests + typecheck** (same command as Task 1 Step 7). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/storage.ts web/src/lib/storage.test.ts web/src/test-setup.ts
git commit -m "feat(web): synced-hash echo marker + calendar view preference storage"
```

---

### Task 4: address-bar auto-sync with echo detection (`usePlan`)

**Files:**
- Modify: `web/src/hooks/usePlan.ts` (the consume effect at lines 109–126, plus one new effect right after it)

**Interfaces:**
- Consumes: `tokenFromHash`, `decodePlan`, `encodePlan` from `../lib/share`; `loadSyncedToken`, `saveSyncedToken` from `../lib/storage`.
- Produces: no API change — `usePlan()`'s return shape is untouched. Behavior contract for later tasks/E2E: address bar always carries `#p=<v3 full token of the ACTIVE plan>` when it has ≥1 course; reloading never re-imports your own hash; a FOREIGN hash still lands in the received slot exactly once.

- [ ] **Step 1: Update imports in `usePlan.ts`**

Change the share import (line 42) to:
```ts
import { decodePlan, encodePlan, tokenFromHash } from '../lib/share';
```
Extend the storage import block with `loadSyncedToken, saveSyncedToken`.

- [ ] **Step 2: Make the consume effect echo-aware** — replace the body of `consume` (lines 110–122) with:

```ts
    const consume = () => {
      const token = tokenFromHash(window.location.hash);
      if (!token) return;
      // Our own auto-synced hash (see the mirror effect below) is not an
      // incoming share — leave it alone or every reload would "receive" it.
      if (token === loadSyncedToken()) return;
      const fromHash = decodePlan(token);
      if (!fromHash) return;
      const rec: ReceivedPlan = {
        plan: fromHash,
        source: 'link',
        receivedAt: new Date().toISOString(),
      };
      saveReceived(rec);
      setReceived(rec);
      switchViewing('received');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
```
(`planFromHash` becomes unused in this file — remove it from the import.)

- [ ] **Step 3: Add the mirror effect** — insert DIRECTLY AFTER the consume effect (order matters: on mount, consume must run first so a foreign hash is captured before we overwrite it):

```ts
  // Mirror the ACTIVE plan into the address bar as a #p=<full token> so the
  // browser's own "send this tab to your device" / bookmark sync always carry
  // the latest plan. The token is also remembered per-tab (sessionStorage) so
  // a reload recognizes its own echo instead of importing it as a received
  // plan. Depends on `received` too: after consuming a foreign hash we restore
  // our own hash right away.
  useEffect(() => {
    if (plan.entries.length === 0) {
      saveSyncedToken('');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return;
    }
    const token = encodePlan(plan, 'full');
    saveSyncedToken(token);
    window.history.replaceState(null, '', `#p=${token}`);
  }, [plan, received]);
```

- [ ] **Step 4: Typecheck + full web tests**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd /Users/duzijue/Desktop/vc/plan && npm run typecheck && npm test -w @triton/web
```
Expected: clean/PASS. (No hook-level test harness exists in this repo — behavior is covered by the pure-function tests from Tasks 1/3 and the E2E pass in Task 10.)

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/usePlan.ts
git commit -m "feat(web): auto-sync the active plan into the address bar with echo-safe hash consumption"
```

---

### Task 5: ShareMenu rework — Full/Lite toggle, QR panel, Export-as-JSON shelved

**Files:**
- Create: `web/src/components/ShareMenu.tsx`
- Modify: `web/src/components/Topbar.tsx` (replace inline share menu with `<ShareMenu>`; drop `onCopyLink`/`onExportJson` props; add `sharePlan`, `onFlash`, `calToggle` props)
- Modify: `web/src/App.tsx` (drop `handleCopyLink`/`handleExportJson`; pass new props)
- Modify: `web/src/components/icons.tsx` (add `QrCode` icon)
- Modify: `web/src/styles/app.css` (menu segment + QR panel styles, after the `.menu__input` rules ~line 972)

**Interfaces:**
- Consumes: `encodePlan/shareUrl/planToHash/ShareFormat` (Task 1), `qrShareForPlan/qrSvg` (Task 2), `saveSyncedToken` (Task 3), `useClickAway`, icons.
- Produces:
  - `ShareMenu` props: `{ plan: PlanState; onFlash: (msg: string) => void }`
  - `Topbar` props change to: `{ termLabel, units, readOnly, planSwitcher?, calToggle?: ReactNode, sharePlan: PlanState, onFlash: (msg: string) => void, onImportText, onImportLink, onReset }` — `calToggle` renders right after `planSwitcher` (used by Task 7).
  - Icon: `export function QrCode(props: P)`.

- [ ] **Step 1: Add the `QrCode` icon to `icons.tsx`** (follow the file's `base()` pattern, 24 viewBox, stroke currentColor):

```tsx
export function QrCode({ size = 16, ...props }: P) {
  return base(
    size,
    props,
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M17.5 17.5v.01M21 21v.01" />
    </>,
  );
}
```
(Adapt mechanically to however the existing icons compose — e.g. if each icon returns the `<svg>` inline, copy that structure verbatim from `Share`.)

- [ ] **Step 2: Create `web/src/components/ShareMenu.tsx`**

```tsx
import { useMemo, useRef, useState } from 'react';
import type { PlanState } from '@triton/shared';
import { useClickAway } from '../hooks/useClickAway';
import { encodePlan, shareUrl, type ShareFormat } from '../lib/share';
import { qrShareForPlan, qrSvg } from '../lib/qr';
import { saveSyncedToken } from '../lib/storage';
import { ChevronDown, Link, QrCode, Share } from './icons';

interface Props {
  /** The plan on screen — yours, or a received one you're passing along. */
  plan: PlanState;
  onFlash: (msg: string) => void;
}

/**
 * Share ▾ — Copy link / QR code, with a Full (default) vs Lite format toggle.
 * Full = v3 token, every section option included, editable after saving on the
 * other device. Lite = v2 slim snapshot, view-only. "Export as JSON" is shelved
 * for now (kept below, commented out) — Import → Upload still accepts old files.
 */
export function ShareMenu({ plan, onFlash }: Props) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ShareFormat>('full');
  const [qrOpen, setQrOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(open, ref, () => {
    setOpen(false);
    setQrOpen(false);
  });

  const qr = useMemo(
    () => (open && qrOpen ? qrShareForPlan(plan, format) : null),
    [open, qrOpen, plan, format],
  );
  const qrMarkup = useMemo(() => (qr ? qrSvg(qr.url) : ''), [qr]);

  const close = () => {
    setOpen(false);
    setQrOpen(false);
  };

  const copyLink = async () => {
    const token = encodePlan(plan, format);
    const url = shareUrl(plan, format);
    try {
      await navigator.clipboard.writeText(url);
      onFlash(
        format === 'full'
          ? 'Full link copied — every section option included'
          : 'Lite link copied — view-only snapshot',
      );
    } catch {
      // Clipboard unavailable — expose the link via the address bar instead.
      // Mark it as our own write so the next load doesn't re-import it.
      saveSyncedToken(token);
      window.history.replaceState(null, '', `#p=${token}`);
      onFlash('Share link is in the address bar — copy it from there');
    }
    close();
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="btn btn--sm btn--primary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Share size={15} /> Share <ChevronDown size={12} />
      </button>
      {open && (
        <div className="menu menu--right" role="menu">
          <div className="menu__seg" role="radiogroup" aria-label="Share format">
            <button
              type="button"
              role="radio"
              aria-checked={format === 'full'}
              className={`menu__seg-btn${format === 'full' ? ' menu__seg-btn--on' : ''}`}
              onClick={() => setFormat('full')}
            >
              Full
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={format === 'lite'}
              className={`menu__seg-btn${format === 'lite' ? ' menu__seg-btn--on' : ''}`}
              onClick={() => setFormat('lite')}
            >
              Lite
            </button>
          </div>
          <p className="menu__seg-desc">
            {format === 'full'
              ? 'All sections included — editable on the other device.'
              : 'Selected sections only — smaller link, view-only.'}
          </p>

          <button type="button" className="menu__item" role="menuitem" onClick={copyLink}>
            <span className="menu__item-title">
              <Link size={14} /> Copy link
            </span>
            <span className="menu__item-desc">
              Send it anywhere — the plan travels inside the link itself.
            </span>
          </button>

          <button
            type="button"
            className="menu__item"
            role="menuitem"
            aria-expanded={qrOpen}
            onClick={() => setQrOpen((v) => !v)}
          >
            <span className="menu__item-title">
              <QrCode size={14} /> QR code
            </span>
            <span className="menu__item-desc">Scan with your phone to open this plan there.</span>
          </button>
          {qrOpen &&
            (qr ? (
              <div className="menu__qr">
                {/* qrSvg output is generated locally from qrcode-generator — trusted markup */}
                <div className="menu__qr-box" dangerouslySetInnerHTML={{ __html: qrMarkup }} />
                {qr.mode === 'lite' && format === 'full' && (
                  <p className="menu__qr-note">
                    Plan too large for a full QR — this code carries the Lite version. Use Copy
                    link for the full plan.
                  </p>
                )}
              </div>
            ) : (
              <p className="menu__qr-note">
                This plan is too large for a QR code — use Copy link instead.
              </p>
            ))}

          {/* Export as JSON — shelved 2026-07-24 (user decision; Import → Upload still works).
              Re-enable by restoring this block and the downloadPlanJson import.
          <button type="button" className="menu__item" role="menuitem"
            onClick={() => { close(); downloadPlanJson(plan); onFlash('Plan exported as JSON'); }}>
            <span className="menu__item-title"><Download size={14} /> Export as JSON</span>
            <span className="menu__item-desc">The complete plan, every section option included.
              To open it: click Import → upload the file, and the plan is right there.</span>
          </button>
          */}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Rewire `Topbar.tsx`**

- Props interface becomes:
```ts
interface Props {
  termLabel: string;
  units: number;
  /** Viewing someone else's plan — editing actions (Clear) hide. */
  readOnly: boolean;
  /** The named-plans dropdown, rendered next to the brand. */
  planSwitcher?: ReactNode;
  /** Mobile-only calendar view toggle (Week ⇄ Days), rendered after the switcher. */
  calToggle?: ReactNode;
  /** The plan on screen, for the Share menu (link + QR). */
  sharePlan: PlanState;
  onFlash: (msg: string) => void;
  onImportText: (text: string) => void;
  onImportLink: (text: string) => boolean;
  onReset: () => void;
}
```
- Add `import type { PlanState } from '@triton/shared';` and `import { ShareMenu } from './ShareMenu';`; remove `Share`, `Download`, `Link` from the icons import if now unused (keep `Link` — the Import paste row uses it; drop `Share`/`Download`).
- Render `{calToggle}` immediately after `{planSwitcher}` (line 63).
- Replace the whole share `menu-wrap` block (lines 147–195) with:
```tsx
        <ShareMenu plan={sharePlan} onFlash={onFlash} />
```
- Delete `shareOpen`/`shareRef`/their `useClickAway` line.

- [ ] **Step 4: Rewire `App.tsx`**

- Delete `handleCopyLink` (lines 40–51) and `handleExportJson` (lines 53–56).
- Update the share import (line 12) to `import { parsePlanJson, planFromLinkText } from './lib/share';` (drop `downloadPlanJson`, `planToHash`, `shareUrl`).
- Topbar invocation becomes:
```tsx
      <Topbar
        termLabel={ctl.viewPlan.term.label}
        units={ctl.units}
        readOnly={ctl.readOnly}
        planSwitcher={/* unchanged PlanSwitcher element */}
        sharePlan={ctl.viewPlan}
        onFlash={flash}
        onImportText={handleImportText}
        onImportLink={handleImportLink}
        onReset={handleReset}
      />
```

- [ ] **Step 5: Add CSS** — in `app.css`, after the `.menu__input` rules (~line 972):

```css
/* Share menu: format segment + QR panel */
.menu__seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px 6px 0;
}
.menu__seg-btn {
  height: 26px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 7px;
  cursor: pointer;
}
.menu__seg-btn--on {
  color: #fff;
  background: var(--ink);
  border-color: var(--ink);
}
.menu__seg-desc {
  margin: 4px 8px 2px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-faint);
}
.menu__qr {
  padding: 6px 8px 8px;
}
.menu__qr-box {
  padding: 10px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.menu__qr-box svg {
  display: block;
  width: 100%;
  height: auto;
}
.menu__qr-note {
  margin: 6px 8px 4px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--gold-ink);
}
```

- [ ] **Step 6: Verify**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd /Users/duzijue/Desktop/vc/plan && npm run typecheck && npm test -w @triton/web && npm run build -w @triton/web
```
Expected: typecheck clean (no unused-symbol errors), tests PASS, build succeeds. Then a quick manual check: `npm run dev -w @triton/web`, open http://localhost:5173 — Share ▾ shows Full/Lite segment (Full default), Copy link works, QR code expands to a scannable code, Export as JSON is gone; Import menu unchanged.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ShareMenu.tsx web/src/components/Topbar.tsx web/src/App.tsx web/src/components/icons.tsx web/src/styles/app.css
git commit -m "feat(web): Share menu rework — Full/Lite toggle, offline QR code, JSON export shelved"
```

---

### Task 6: mobile shell — useIsMobile, bottom tab bar, App restructure

**Files:**
- Create: `web/src/hooks/useIsMobile.ts`
- Create: `web/src/components/MobileTabBar.tsx`
- Modify: `web/src/components/icons.tsx` (add `List` icon)
- Modify: `web/src/App.tsx` (three-tab view state, conditional panes, pulse effect)
- Modify: `web/src/styles/app.css` (REPLACE the `@media (max-width: 760px)` block at lines 1809–1828; add tab bar styles)
- Modify: `web/index.html` (viewport-fit=cover)

**Interfaces:**
- Consumes: existing `CoursePanel`/`CalendarGrid`/`FinalsView`/`Topbar` props (Task 5 shape).
- Produces:
  - `useIsMobile(): boolean` — matchMedia `(max-width: 760px)`, SSR/jsdom-safe.
  - `MobileTabBar` props: `{ tab: MobileTab; onTab: (t: MobileTab) => void; coursesCount: number; finalsBadge: number; pulse: boolean }` with `export type MobileTab = 'courses' | 'calendar' | 'finals'`.
  - App state contract used by Tasks 7–8: `view: MobileTab` (desktop maps `'courses'` → `'calendar'`), `handleFocusCourse(courseId)` switches to the Courses tab on mobile before flashing the card.

- [ ] **Step 1: `web/src/hooks/useIsMobile.ts`**

```ts
import { useEffect, useState } from 'react';

const QUERY = '(max-width: 760px)';

/** True below the mobile breakpoint. Safe under jsdom (no matchMedia → false). */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}
```

- [ ] **Step 2: `List` icon in `icons.tsx`** (same pattern as Step 1 of Task 5):

```tsx
export function List({ size = 16, ...props }: P) {
  return base(
    size,
    props,
    <>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </>,
  );
}
```

- [ ] **Step 3: `web/src/components/MobileTabBar.tsx`**

```tsx
import { Calendar, Cap, List } from './icons';

export type MobileTab = 'courses' | 'calendar' | 'finals';

interface Props {
  tab: MobileTab;
  onTab: (t: MobileTab) => void;
  coursesCount: number;
  finalsBadge: number;
  /** Gold pulse on the Calendar tab after the plan changed from another tab. */
  pulse: boolean;
}

export function MobileTabBar({ tab, onTab, coursesCount, finalsBadge, pulse }: Props) {
  const item = (
    id: MobileTab,
    label: string,
    icon: JSX.Element,
    badge?: number,
    extra = '',
  ) => (
    <button
      type="button"
      className={`tabbar__btn${tab === id ? ' tabbar__btn--active' : ''}${extra}`}
      aria-current={tab === id ? 'page' : undefined}
      onClick={() => onTab(id)}
    >
      <span className="tabbar__icon">
        {icon}
        {badge !== undefined && badge > 0 && <span className="tab__badge tabbar__badge">{badge}</span>}
      </span>
      {label}
    </button>
  );
  return (
    <nav className="tabbar" aria-label="Planner sections">
      {item('courses', 'Courses', <List size={18} />, coursesCount)}
      {item('calendar', 'Calendar', <Calendar size={18} />, undefined, pulse ? ' tabbar__btn--pulse' : '')}
      {item('finals', 'Finals', <Cap size={18} />, finalsBadge)}
    </nav>
  );
}
```
Note: the courses badge reuses `.tab__badge` styling but is neutral-count, not conflict — override its background in the tab bar CSS below.

- [ ] **Step 4: Restructure `App.tsx`**

Replace `type Tab = 'calendar' | 'finals';` and the `tab` state with:
```tsx
import { MobileTabBar, type MobileTab } from './components/MobileTabBar';
import { useIsMobile } from './hooks/useIsMobile';
// …
const isMobile = useIsMobile();
const [tab, setTab] = useState<MobileTab>('calendar');
const [calPulse, setCalPulse] = useState(false);
// Desktop has no Courses tab — the rail is always visible there.
const view: MobileTab = !isMobile && tab === 'courses' ? 'calendar' : tab;
```
`handleFocusCourse` becomes:
```tsx
  const handleFocusCourse = useCallback(
    (courseId: string) => {
      if (isMobile) setTab('courses'); // the card lives on the Courses tab
      setFocusReq((prev) => ({ courseId, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [isMobile],
  );
```
Add the pulse effect (after the toast effect):
```tsx
  // When the plan changes while the calendar is off-screen (mobile Courses tab),
  // pulse the Calendar tab as a "your week updated" hint. No auto-switching.
  const prevPlanRef = useRef(ctl.plan);
  useEffect(() => {
    const changed = prevPlanRef.current !== ctl.plan;
    prevPlanRef.current = ctl.plan;
    if (!changed || !isMobile || view !== 'courses') return;
    setCalPulse(true);
    const t = setTimeout(() => setCalPulse(false), 1600);
    return () => clearTimeout(t);
  }, [ctl.plan, isMobile, view]);
```
(`useRef` joins the react import.) Restructure the JSX body:
```tsx
    <div className={`app${isMobile ? ' app--mobile' : ''}`}>
      <Topbar … (unchanged from Task 5) … />
      {ctl.received && <ReceivedBanner … unchanged … />}
      <div className="app__body">
        {(!isMobile || view === 'courses') && <CoursePanel ctl={ctl} focus={focusReq} />}

        {(!isMobile || view !== 'courses') && (
          <main className="main">
            <div className="toolbar">…unchanged; onClick handlers keep setTab('calendar'|'finals')…</div>
            {view === 'calendar' && <ConflictBanner … unchanged … />}
            {view === 'calendar' ? <CalendarGrid … unchanged … /> : <FinalsView … unchanged … />}
          </main>
        )}
      </div>

      {isMobile && (
        <MobileTabBar
          tab={view}
          onTab={setTab}
          coursesCount={ctl.viewPlan.entries.length}
          finalsBadge={ctl.finalConflicts.length}
          pulse={calPulse}
        />
      )}
      …toast / mapLoc unchanged…
    </div>
```
Every `tab === 'calendar'` / `tab === 'finals'` comparison in the existing toolbar/panes switches to `view === …`.

- [ ] **Step 5: `web/index.html`** — extend the viewport meta (line 5) for safe-area support:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

- [ ] **Step 6: CSS — replace the old ≤760 block and add the tab bar.** Delete lines 1809–1828 of `app.css` (the entire `@media (max-width: 760px)` block; KEEP the 900px block) and append:

```css
/* --------------------------------------------------------------- mobile shell */
.tabbar {
  display: none;
}

@media (max-width: 760px) {
  /* one pane at a time; each pane scrolls internally (sticky cal header intact) */
  .app__body {
    grid-template-columns: 1fr;
  }
  .rail {
    width: 100%;
    max-height: none;
    border-right: none;
  }
  .topbar {
    padding: 0 10px;
    gap: 8px;
  }
  .topbar__term,
  .brand__sub,
  .unit-pill {
    display: none;
  }
  .toolbar {
    padding: 8px 10px 0;
  }
  .toolbar .tabs {
    display: none; /* superseded by the bottom tab bar */
  }
  .cal-wrap,
  .banner {
    margin-left: 8px;
    margin-right: 8px;
  }

  /* bottom tab bar */
  .tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 35;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    background: var(--surface);
    border-top: 1px solid var(--line-strong);
    padding: 4px 6px calc(4px + env(safe-area-inset-bottom));
  }
  .tabbar__btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-height: 46px;
    padding: 5px 0 3px;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text-muted);
    background: none;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  .tabbar__btn--active {
    color: var(--ink);
  }
  .tabbar__btn--pulse {
    animation: tab-pulse 1.4s ease;
  }
  .tabbar__icon {
    position: relative;
    display: inline-flex;
  }
  .tabbar__badge {
    position: absolute;
    top: -6px;
    right: -12px;
  }
  .tabbar__btn:not(.tabbar__btn--active) .tabbar__badge {
    background: var(--text-faint); /* neutral count; conflict red only via .tab__badge default on Finals */
  }

  /* content must clear the fixed bar */
  .rail__scroll,
  .finals {
    padding-bottom: calc(70px + env(safe-area-inset-bottom));
  }
  .cal-grid {
    padding-bottom: calc(70px + env(safe-area-inset-bottom));
  }
  .toast {
    bottom: calc(74px + env(safe-area-inset-bottom));
  }
}

@keyframes tab-pulse {
  0%,
  100% {
    background: transparent;
  }
  30% {
    background: var(--gold-soft);
  }
}
```
Keep the Finals badge red: the rule above only neutralizes badges on non-active tabs — REMOVE that `:not()` rule if it turns the Finals conflict badge grey; instead give the courses badge an explicit modifier class `tabbar__badge--count` with `background: var(--text-faint)` and pass it only from the courses item. (Decide by looking at the rendered result; the conflict badge must stay `--conflict` red.)

- [ ] **Step 7: Verify**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd /Users/duzijue/Desktop/vc/plan && npm run typecheck && npm test -w @triton/web && npm run build -w @triton/web
```
Then `npm run dev -w @triton/web`, open http://localhost:5173, DevTools device toolbar at 390×844:
- Bottom bar shows Courses | Calendar | Finals, Calendar active by default; safe-area padding visible in iPhone frame.
- Courses tab = full-width rail; Calendar/Finals render the main pane; desktop (>760px) unchanged with rail + toolbar pills.
- Switching a section on the Courses tab pulses the Calendar tab gold.

- [ ] **Step 8: Commit**

```bash
git add web/src/hooks/useIsMobile.ts web/src/components/MobileTabBar.tsx web/src/components/icons.tsx web/src/App.tsx web/src/styles/app.css web/index.html
git commit -m "feat(web): mobile shell — bottom tab bar (Courses|Calendar|Finals), single-pane layout"
```

---

### Task 7: calendar variants — fit-week (default) + day-scroll, topbar toggle

**Files:**
- Modify: `web/src/lib/layout.ts` (add `MOBILE_GRID`)
- Modify: `web/src/lib/layout.test.ts` (config sanity test)
- Modify: `web/src/components/CalendarGrid.tsx` (variant prop, short hour labels, today auto-scroll)
- Create: `web/src/components/CalViewToggle.tsx`
- Modify: `web/src/App.tsx` (calView state + persistence + wiring)
- Modify: `web/src/styles/app.css` (`.cal--fit` / `.cal--scroll` rules)

**Interfaces:**
- Consumes: `loadCalView/saveCalView/CalView` (Task 3), Topbar `calToggle` slot (Task 5), `view`/`isMobile` (Task 6).
- Produces:
  - `layout.ts`: `export const MOBILE_GRID: GridConfig = { startHour: 8, endHour: 22, pxPerMinute: 0.78 };`
  - `CalendarGrid` new optional props: `variant?: 'desktop' | 'fit' | 'scroll'` (default `'desktop'`), `onBlockDetail?: (block: PositionedBlock) => void` (forwarded to CourseBlock in Task 8).
  - `CalViewToggle` props: `{ value: CalView; onChange: (v: CalView) => void }`.

- [ ] **Step 1: Failing test** — append to `layout.test.ts`:

```ts
describe('MOBILE_GRID', () => {
  it('spans the same 8:00–22:00 window, denser than desktop', () => {
    expect(MOBILE_GRID.startHour).toBe(DEFAULT_GRID.startHour);
    expect(MOBILE_GRID.endHour).toBe(DEFAULT_GRID.endHour);
    expect(MOBILE_GRID.pxPerMinute).toBeLessThan(DEFAULT_GRID.pxPerMinute);
    expect(gridHeightPx(MOBILE_GRID)).toBeGreaterThan(500); // whole day stays scannable
  });
});
```
Run `npm test -w @triton/web -- layout` → FAIL (MOBILE_GRID not exported). Implement in `layout.ts` next to `DEFAULT_GRID` (line 19):
```ts
/** Mobile week view: same window, compressed — a 50-min class ≈ 39px (compact blocks). */
export const MOBILE_GRID: GridConfig = { startHour: 8, endHour: 22, pxPerMinute: 0.78 };
```
Re-run → PASS.

- [ ] **Step 2: `CalendarGrid.tsx` variant support**

- Props gain:
```ts
  /** 'desktop' (default) | mobile 'fit' (whole week in viewport) | mobile 'scroll' (wide snap-scrolling day columns). */
  variant?: 'desktop' | 'fit' | 'scroll';
  onBlockDetail?: (block: PositionedBlock) => void;
```
- Inside the component (line 37 area):
```ts
  const cfg = variant === 'desktop' ? DEFAULT_GRID : MOBILE_GRID;
  const colTemplate =
    variant === 'scroll' ? `repeat(${days.length}, var(--day-col-w))` : `repeat(${days.length}, 1fr)`;
```
(`MOBILE_GRID` joins the layout import; `variant = 'desktop'` default in destructuring.)
- Short hour labels: replace the gutter label expression with
```tsx
{variant === 'desktop' ? formatDisplay(`${String(h).padStart(2, '0')}:00`) : shortHour(h)}
```
and add above the component:
```ts
/** "8a" / "12p" / "9p" — the 64px desktop gutter shrinks to 34px on mobile. */
function shortHour(h: number): string {
  return `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;
}
```
- Root class: `<div className={`cal-wrap${variant !== 'desktop' ? ` cal--${variant}` : ''}`}>`.
- Today auto-scroll (scroll variant) — add a ref on the `.cal-scroll` div (`const scrollRef = useRef<HTMLDivElement>(null);` + `ref={scrollRef}`) and:
```ts
  // Day-scroll mode starts with today at the left edge.
  useEffect(() => {
    if (variant !== 'scroll') return;
    const el = scrollRef.current?.querySelector('.cal-col--today');
    el?.scrollIntoView({ inline: 'start', block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);
```
- Forward `onDetail={onBlockDetail}` into every `<CourseBlock>` (prop added in Task 8 — until then, park it: add the prop to CourseBlock in THIS task as a no-op pass-through if you want the typecheck green, or simply hold this one-line wiring until Task 8. Recommended: do the CourseBlock prop here, the sheet in Task 8).
- CourseBlock change (do it now, minimal): add `onDetail?: (block: PositionedBlock) => void` to Props; root `onClick` becomes
```ts
      onClick={
        onDetail
          ? () => onDetail(block)
          : onFocusCourse
            ? () => onFocusCourse(block.courseId)
            : undefined
      }
```
and when `onDetail` is set, render the code and location as inert spans (whole block = one tap target):
```tsx
        {onDetail ? (
          <span className="block__code">{block.courseCode}</span>
        ) : (
          <button type="button" className="block__code" …existing… />
        )}
```
(same span-vs-button fork for the `.block__loc--link` branch; keep `.block--focusable` when either handler exists).

- [ ] **Step 3: `web/src/components/CalViewToggle.tsx`**

```tsx
import type { CalView } from '../lib/storage';

interface Props {
  value: CalView;
  onChange: (v: CalView) => void;
}

/** Mobile calendar layout switch: whole week squeezed in vs wide scrolling days. */
export function CalViewToggle({ value, onChange }: Props) {
  const btn = (v: CalView, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === v}
      className={`calseg__btn${value === v ? ' calseg__btn--on' : ''}`}
      onClick={() => onChange(v)}
    >
      {label}
    </button>
  );
  return (
    <div className="calseg" role="radiogroup" aria-label="Calendar layout">
      {btn('fit', 'Week')}
      {btn('scroll', 'Days')}
    </div>
  );
}
```

- [ ] **Step 4: App wiring**

```tsx
import { CalViewToggle } from './components/CalViewToggle';
import { loadCalView, saveCalView, type CalView } from './lib/storage';
// …
const [calView, setCalView] = useState<CalView>(loadCalView);
const handleCalView = useCallback((v: CalView) => {
  setCalView(v);
  saveCalView(v);
}, []);
```
Topbar gets:
```tsx
        calToggle={
          isMobile && view === 'calendar' ? (
            <CalViewToggle value={calView} onChange={handleCalView} />
          ) : undefined
        }
```
CalendarGrid gets:
```tsx
              variant={isMobile ? (calView === 'scroll' ? 'scroll' : 'fit') : 'desktop'}
```

- [ ] **Step 5: CSS** — append inside/after the mobile media block:

```css
/* calendar variants (only ever applied ≤760 via the variant prop) */
.cal--fit,
.cal--scroll {
  --hour-gutter-w: 34px;
}
.cal--fit .cal-gutter__hour,
.cal--scroll .cal-gutter__hour {
  font-size: 9.5px;
}
.cal--fit .block__code,
.cal--scroll .block__code {
  font-size: 10px;
}
.cal--fit .block__time {
  font-size: 9px;
}
.cal--scroll {
  --day-col-w: 44vw;
}
.cal--scroll .cal-scroll {
  scroll-snap-type: x mandatory;
}
.cal--scroll .cal-col {
  scroll-snap-align: start;
}

/* topbar calendar toggle */
.calseg {
  display: inline-flex;
  padding: 2px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.calseg__btn {
  height: 24px;
  padding: 0 10px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.calseg__btn--on {
  color: #fff;
  background: var(--ink);
}
```

- [ ] **Step 6: Verify**

Typecheck + tests + build (same command). Dev server at 390×844:
- Week mode: Mon–Fri all visible, blocks show code (+time when tall), hour gutter shows "8a…9p", now-line renders on today.
- Toggle to Days: ~2.3 columns visible, snap-scrolls per day, opens with today at the left edge, block content full like desktop.
- Toggle persists across reload (localStorage). Desktop calendar pixel-identical.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/layout.ts web/src/lib/layout.test.ts web/src/components/CalendarGrid.tsx web/src/components/CourseBlock.tsx web/src/components/CalViewToggle.tsx web/src/App.tsx web/src/styles/app.css
git commit -m "feat(web): mobile calendar — fit-week and day-scroll variants with topbar toggle"
```

---

### Task 8: tap-block detail sheet

**Files:**
- Create: `web/src/components/BlockSheet.tsx`
- Modify: `web/src/App.tsx` (sheet state + wiring)
- Modify: `web/src/styles/app.css` (`.blocksheet*`)

**Interfaces:**
- Consumes: `PositionedBlock` from `../lib/layout`; `colorsForHue` from `../lib/colors`; `formatDisplay` from `@triton/shared`; `weekdayLong` from `../lib/format`; `useEscapeKey`; `createPortal` (follow PrereqPopover's portal-to-body pattern — card/rail ancestors clip fixed backdrops); icons `X`, `Warning`, `External`.
- Produces: `BlockSheet` props `{ block: PositionedBlock; onOpenCourse: (courseId: string) => void; onOpenLocation: (block: PositionedBlock) => void; onFocusCourse: (courseId: string) => void; onClose: () => void }`.

- [ ] **Step 1: `web/src/components/BlockSheet.tsx`**

```tsx
import { createPortal } from 'react-dom';
import { formatDisplay } from '@triton/shared';
import type { PositionedBlock } from '../lib/layout';
import { colorsForHue } from '../lib/colors';
import { weekdayLong } from '../lib/format';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { External, Warning, X } from './icons';

interface Props {
  block: PositionedBlock;
  onOpenCourse: (courseId: string) => void;
  onOpenLocation: (block: PositionedBlock) => void;
  onFocusCourse: (courseId: string) => void;
  onClose: () => void;
}

/**
 * Mobile tap-a-block detail card. Collapses the desktop block's three click
 * targets (code → TSS, location → building map, elsewhere → course card) into
 * one sheet with explicit buttons. Portaled to <body> like PrereqPopover.
 */
export function BlockSheet({ block, onOpenCourse, onOpenLocation, onFocusCourse, onClose }: Props) {
  useEscapeKey(onClose);
  const c = colorsForHue(block.hue);
  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop blocksheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${block.courseCode} ${block.typeText}`}
        style={{ ['--c-spine' as string]: c.spine, ['--c-text' as string]: c.text }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
        <div className="eyebrow">{block.typeText}</div>
        <div className="blocksheet__code mono">{block.courseCode}</div>
        <div className="blocksheet__time">
          {weekdayLong(block.day)} · {formatDisplay(block.start)} – {formatDisplay(block.end)}
        </div>
        {block.conflict && (
          <div className="blocksheet__warn">
            <Warning size={14} /> Time conflict with another course
          </div>
        )}
        {block.location &&
          (block.building ? (
            <button type="button" className="blocksheet__loc" onClick={() => onOpenLocation(block)}>
              {block.location}
            </button>
          ) : (
            <div className="blocksheet__loctext">{block.location}</div>
          ))}
        {block.instructor && <div className="blocksheet__instr">{block.instructor}</div>}
        <div className="mappop__actions">
          <button type="button" className="btn btn--sm btn--primary" onClick={() => onOpenCourse(block.courseId)}>
            <External size={13} /> Open in TSS
          </button>
          <button type="button" className="btn btn--sm" onClick={() => onFocusCourse(block.courseId)}>
            Course details
          </button>
        </div>
        <p className="mappop__hint">The location button shows where the building is on campus.</p>
      </div>
    </div>,
    document.body,
  );
}
```
Check `weekdayLong` is exported from `web/src/lib/format.ts` (recon says yes — CalendarGrid uses it); if its signature is `(d: Weekday) => string`, pass `block.day`.

- [ ] **Step 2: App wiring**

```tsx
import { BlockSheet } from './components/BlockSheet';
import type { PositionedBlock } from './lib/layout';
// …
const [sheetBlock, setSheetBlock] = useState<PositionedBlock | null>(null);
```
CalendarGrid gains:
```tsx
              onBlockDetail={isMobile ? setSheetBlock : undefined}
```
Render before the BuildingPopover mount:
```tsx
      {sheetBlock && (
        <BlockSheet
          block={sheetBlock}
          onClose={() => setSheetBlock(null)}
          onOpenCourse={(id) => {
            setSheetBlock(null);
            handleOpenCourse(id);
          }}
          onOpenLocation={(b) => {
            setSheetBlock(null);
            if (b.building) setMapLoc({ building: b.building, room: b.room });
          }}
          onFocusCourse={(id) => {
            setSheetBlock(null);
            handleFocusCourse(id);
          }}
        />
      )}
```
(`handleFocusCourse` already tab-switches on mobile — Task 6.) Also clear the sheet when the view changes: add `useEffect(() => setSheetBlock(null), [view]);`.

- [ ] **Step 3: CSS** — after the `.prereqpop` rules (~line 1536):

```css
/* mobile block detail sheet (rides on the mappop modal shell) */
.blocksheet {
  border-top: 3px solid var(--c-spine, var(--ink));
}
.blocksheet__code {
  font-size: 19px;
  font-weight: 800;
  color: var(--c-text, var(--ink));
}
.blocksheet__time {
  margin-top: 4px;
  font-size: 13px;
  color: var(--text);
}
.blocksheet__warn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 6px 9px;
  font-size: 12px;
  font-weight: 600;
  color: var(--conflict-ink);
  background: var(--conflict-soft);
  border-radius: var(--r-sm);
}
.blocksheet__loc {
  display: block;
  width: fit-content;
  margin-top: 8px;
  padding: 0;
  font-size: 13px;
  color: var(--c-text, var(--ink));
  text-decoration: underline;
  text-underline-offset: 3px;
  background: none;
  border: none;
  cursor: pointer;
}
.blocksheet__loctext {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-muted);
}
.blocksheet__instr {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--text-muted);
}
```

- [ ] **Step 4: Verify** — typecheck + tests + build; dev server at 390×844: tapping any calendar block (both variants) opens the centered sheet with correct course color, time, location button → BuildingPopover, "Course details" → Courses tab with the card flashed/expanded, Esc/backdrop closes. Desktop block behavior unchanged (code→TSS, location→map, block→rail focus). Finals calendar blocks still use focus behavior (no sheet — FinalsCalendar doesn't receive `onBlockDetail`).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/BlockSheet.tsx web/src/App.tsx web/src/styles/app.css
git commit -m "feat(web): tap-a-block detail sheet on mobile calendar"
```

---

### Task 9: mobile polish — touch affordances, menus, finals, banners

**Files:**
- Modify: `web/src/styles/app.css` (inside the ≤760 media block)
- Modify: `web/src/components/CoursePanel.tsx` (mobile units line)

**Interfaces:**
- Consumes: everything already rendered; `ctl.units` from PlanController.
- Produces: no new API. Pure presentation.

- [ ] **Step 1: `CoursePanel.tsx`** — surface units on mobile (the topbar pill is hidden there). In the `.rail__title-row`, extend the count span:

```tsx
          <span className="rail__count mono">
            {entries.length} added<span className="rail__units"> · {ctl.units} units</span>
          </span>
```

- [ ] **Step 2: CSS** — append inside the `@media (max-width: 760px)` block:

```css
  /* touch affordances */
  .planmenu__acts {
    opacity: 1; /* hover-reveal → always visible on touch */
  }
  .planmenu__new {
    display: none; /* no extension on phones — an empty new plan can't be filled */
  }
  .menu {
    width: min(320px, calc(100vw - 20px));
  }
  .opt {
    padding-top: 9px;
    padding-bottom: 9px; /* ≥40px touch rows */
  }
  .picker__toggle {
    min-height: 40px;
  }

  /* banners & finals on narrow screens */
  .received {
    flex-wrap: wrap;
    row-gap: 6px;
  }
  .final-row {
    grid-template-columns: 86px 1fr auto;
  }
  .finals__intro,
  .finals__timeline {
    max-width: none;
  }
```
And OUTSIDE the media block (default hidden, shown on mobile):
```css
.rail__units {
  display: none;
}
@media (max-width: 760px) {
  .rail__units {
    display: inline;
  }
}
```
(Fold the `.rail__units` show rule into the main mobile block rather than a second media query if you prefer — one media block total.)

- [ ] **Step 3: Verify** — typecheck + tests + build; dev at 390×844: PlanSwitcher rows show rename/duplicate/delete without hover, no "+ New plan" row on mobile (still present on desktop), Import/Share menus fit the viewport, received banner wraps to two lines cleanly, finals list fits without horizontal scroll, rail header shows "N added · X units".

- [ ] **Step 4: Commit**

```bash
git add web/src/styles/app.css web/src/components/CoursePanel.tsx
git commit -m "feat(web): mobile polish — touch affordances, menu sizing, finals and banner layout"
```

---

### Task 10: full regression, mobile E2E, docs

**Files:**
- Modify: `PROGRESS.md` (new dated section, in Chinese, following the file's existing style)
- Scratch only (NOT committed): `/private/tmp/…scratchpad/mobile-e2e.mjs`

- [ ] **Step 1: Full regression**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd /Users/duzijue/Desktop/vc/plan && npm run typecheck && npm test && npm run build
```
Expected: typecheck clean; ALL workspaces green (shared 10 / extension 49 / web = previous 82 + new); both builds succeed.

- [ ] **Step 2: E2E with puppeteer-core + local Chrome** (project convention; playwright MCP is flaky here). Serve the production build (`npm run preview -w @triton/web` → note the port), then drive a 390×844 viewport through this checklist, screenshotting each step to the scratchpad:

1. **Seed a plan**: drive the UI — Import ▾ → Upload JSON file with `/Users/duzijue/Desktop/tritonplan-prereq-demo.json` (real CHEM-043A data) → "Save as a new plan". For a denser plan, additionally paste a share link generated in a desktop-viewport page from the same build (Share → Copy link on a multi-course plan seeded the same way).
2. **Auto-sync**: assert `location.hash` starts with `#p=3~` after the save; reload → plan still there, NO received banner (echo detection), hash still present.
3. **Cross-"device"**: copy `location.href`, open it in a FRESH incognito-like context (new browser context) → received banner appears, read-only; "Save as a new plan" → sections switchable (Full data survived).
4. **Tabs**: bottom bar present; Courses/Calendar/Finals all render; switch a section on Courses → Calendar tab pulses; calendar reflects the change.
5. **Calendar variants**: default fit-week shows 5 columns; toggle "Days" → wide columns, horizontal scroll, today at left; toggle persists across reload.
6. **Block sheet**: tap a block → sheet shows code/time/location/instructor; "Course details" lands on the flashed card in Courses; location button opens the building popover.
7. **Share menu**: Full/Lite segment defaults to Full; QR code renders (assert an `<svg>` inside `.menu__qr-box`); decode the QR payload if a decoder is handy, else assert `.menu__qr-note` absent for a small plan; Export as JSON absent.
8. **Old-link compat**: open a pre-existing v2 link (generate one in-page from the console is impossible — instead assert `decodePlan` behavior is already unit-tested; in E2E just open the Lite link produced by Copy link with Lite selected) → received flow works.

Fix anything broken; re-run until the checklist passes. Keep screenshots in the scratchpad for the final report.

- [ ] **Step 3: Update `PROGRESS.md`** — add a dated section (Chinese, match the file's voice) covering: mobile shell + dual calendar views + block sheet, v3 Full share format (with the size numbers), QR + capacity fallback, auto URL sync + echo marker, Export-as-JSON shelved, new deps (fflate, qrcode-generator), test count, and that this is web-only (no extension release needed).

- [ ] **Step 4: Final commit**

```bash
git add PROGRESS.md
git commit -m "docs: log mobile adaptation round in PROGRESS.md"
```
Do NOT push — pushing to main auto-deploys GitHub Pages and stays a user-initiated step.

---

## Self-Review Notes (already applied)

- Spec coverage: shell/tabs (T6), dual calendar + toggle (T7), block sheet (T8), Courses/Finals adaptation (T6/T9), Share Full/Lite + QR + Export shelved (T5), v3 format (T1), QR capacity fallback (T2), auto URL sync + echo (T3/T4), tests/E2E (each task + T10). 二维码/链接文案 exactly as spec'd.
- Type consistency: `ShareFormat` defined once in share.ts (T1), consumed by qr.ts (T2) and ShareMenu (T5); `CalView` defined in storage.ts (T3), consumed by CalViewToggle/App (T7); `MobileTab` defined in MobileTabBar (T6), consumed by App; `PositionedBlock` reused from layout.ts everywhere.
- Known judgment calls an implementer may tune (visual only, keep semantics): MOBILE_GRID pxPerMinute 0.78, --day-col-w 44vw, tab-bar paddings, badge colors.
