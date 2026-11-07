/**
 * A plan as a URL-safe token, from the days when the address bar carried
 * whole plans. Two hash keys were written: `#p=` for a link someone shared
 * (it no longer opens: shared plans live on the server now) and `#m=` for the
 * planner's mirror of the user's OWN active plan (see MIRROR_KEY below). Nothing
 * writes either any more; they are read to make sense of old bookmarks here and
 * by the old site's hand-off (migration.ts), and the token is how plans are
 * compared and fingerprinted there.
 *
 * Two wire formats, chosen via `ShareFormat`:
 *  - 'full' (v3, default): the whole plan INCLUDING every section option,
 *    prereqs and capturedAt, deflate-compressed. See share-v3.ts for the wire shape.
 *  - 'lite' (v2 slim): only the section picked per course, and only the fields
 *    needed to render it (times, place, instructor, final, seats).
 *
 * Decode tries v3 full, then v2 slim, then v1 legacy (the whole PlanState
 * encoded verbatim, pre-dating both formats).
 */
import LZString from 'lz-string';
import type {
  Component,
  CourseOffering,
  FinalExam,
  Meeting,
  PlanState,
  SectionOption,
  TeachingMethod,
  Term,
  Weekday,
} from '@triton/shared';
import { isPlanState } from './storage';
import { V3_PREFIX, decodePlanV3, encodePlanV3 } from './share-v3';

const SHARE_KEY = 'p';
/** Marks the slim share format; legacy links are a raw PlanState (`version:1`). */
const SHARE_FORMAT = 2 as const;

/* ---- slim wire shape (short keys; meetings/final as positional arrays) ----- */
type SlimMeeting = [
  days: Weekday[],
  start: string,
  end: string,
  modality: string,
  building: string,
  room: string,
  location: string,
];
type SlimFinal = [date: string, start: string, end: string, modality: string];
interface SlimComp {
  t: TeachingMethod;
  tt: string;
  s: string;
  i: string[];
  m: SlimMeeting[];
}
interface SlimEntry {
  c: string; // courseCode
  ti: string; // title
  u?: number; // units
  mi: string; // moduleId
  k?: string; // color
  co: string; // selected option code
  ec: string; // selected option enrollCode
  sa?: number; // seatsAvailable
  li?: number; // limit
  f?: SlimFinal; // option final
  d: SlimComp[]; // components
}
interface SlimPlan {
  s: typeof SHARE_FORMAT;
  y: string;
  p: string;
  l: string;
  e: SlimEntry[];
}

function slimMeeting(m: Meeting): SlimMeeting {
  return [m.days, m.start, m.end, m.modality, m.building ?? '', m.room ?? '', m.location ?? ''];
}

function toSlim(plan: PlanState): SlimPlan {
  return {
    s: SHARE_FORMAT,
    y: plan.term.year,
    p: plan.term.period,
    l: plan.term.label,
    e: plan.entries.map((entry): SlimEntry => {
      const c = entry.course;
      const opt =
        c.options.find((o) => o.id === entry.selectedOptionId) ?? c.options[0] ?? undefined;
      const out: SlimEntry = {
        c: c.courseCode,
        ti: c.title,
        mi: c.moduleId,
        co: opt?.code ?? '',
        ec: opt?.enrollCode ?? '',
        d: (opt?.components ?? []).map((comp) => ({
          t: comp.type,
          tt: comp.typeText,
          s: comp.sectionCode,
          i: comp.instructors,
          m: comp.meetings.map(slimMeeting),
        })),
      };
      if (c.units !== undefined) out.u = c.units;
      if (entry.color !== undefined) out.k = entry.color;
      if (opt?.seatsAvailable !== undefined) out.sa = opt.seatsAvailable;
      if (opt?.limit !== undefined) out.li = opt.limit;
      if (opt?.final) {
        out.f = [opt.final.date, opt.final.start, opt.final.end, opt.final.modality ?? ''];
      }
      return out;
    }),
  };
}

function meetingFromSlim(m: SlimMeeting): Meeting {
  const [days, start, end, modality, building, room, location] = m;
  const out: Meeting = { days, start, end, modality };
  if (building) out.building = building;
  if (room) out.room = room;
  if (location) out.location = location;
  return out;
}

function finalFromSlim(f: SlimFinal): FinalExam {
  const [date, start, end, modality] = f;
  const out: FinalExam = { date, start, end };
  if (modality) out.modality = modality;
  return out;
}

function fromSlim(slim: SlimPlan): PlanState {
  const term: Term = { year: slim.y, period: slim.p, label: slim.l };
  return {
    version: 1,
    term,
    entries: (slim.e ?? []).map((en) => {
      const dash = en.c.indexOf('-');
      const components: Component[] = (en.d ?? []).map((c, i) => ({
        id: `${en.ec}-${i}`,
        type: c.t,
        typeText: c.tt,
        sectionCode: c.s,
        instructors: c.i ?? [],
        meetings: (c.m ?? []).map(meetingFromSlim),
        unscheduled: (c.m ?? []).length === 0,
        rawSched: '',
      }));
      const option: SectionOption = {
        id: en.ec,
        code: en.co,
        enrollCode: en.ec,
        components,
        ...(en.sa !== undefined ? { seatsAvailable: en.sa } : {}),
        ...(en.li !== undefined ? { limit: en.li } : {}),
        ...(en.f ? { final: finalFromSlim(en.f) } : {}),
      };
      const course: CourseOffering = {
        id: `${en.c}|${term.year}|${term.period}`,
        moduleId: en.mi,
        subject: dash > 0 ? en.c.slice(0, dash) : en.c,
        number: dash > 0 ? en.c.slice(dash + 1) : '',
        courseCode: en.c,
        title: en.ti,
        term,
        ...(en.u !== undefined ? { units: en.u } : {}),
        options: [option],
      };
      return { course, selectedOptionId: option.id, ...(en.k !== undefined ? { color: en.k } : {}) };
    }),
  };
}

function isSlimPlan(value: unknown): value is SlimPlan {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).s === SHARE_FORMAT &&
    Array.isArray((value as Record<string, unknown>).e)
  );
}

/** Which wire format a token carries: 'full' (v3, all sections) or 'lite' (v2 slim). */
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

/** One key's raw value in a location hash ("#k=…" or "k=…"), or null. */
function hashParam(hash: string, key: string): string | null {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!clean) return null;
  return new URLSearchParams(clean).get(key);
}

/* --- the address-bar mirror of the user's OWN plan --------------------------
 * The planner used to mirror the active plan into the address bar so the
 * browser's own bookmark sync / "send this tab to my phone" carried the latest
 * plan. The mirror has its own key — `#m=` means mine, `#p=` meant someone
 * sent it — so a bookmarked tab still reads as the user's own plan. */
const MIRROR_KEY = 'm';

/** Build the `#m=…` fragment for the address-bar mirror (without the leading `#`). */
export function planToMirrorHash(plan: PlanState): string {
  return `${MIRROR_KEY}=${encodePlan(plan, 'full')}`;
}

/** Extract the raw `#m=…` token from a location hash, or null. */
export function mirrorTokenFromHash(hash: string): string | null {
  return hashParam(hash, MIRROR_KEY);
}

/**
 * What a location hash means on load. 'mine': a `#m=` mirror re-encoding
 * `plans[index]`. 'mirror': a `#m=` matching none of them (a bookmark synced
 * from another device, a copied address bar). 'share': a `#p=` share link,
 * decodable or not. An older version showed the last two read-only.
 */
export type HashIntent =
  | { kind: 'ignore' }
  | { kind: 'mine'; index: number }
  | { kind: 'mirror' }
  | { kind: 'share' };

export function readHash(hash: string, plans: PlanState[]): HashIntent {
  if (hashParam(hash, SHARE_KEY) !== null) return { kind: 'share' };
  const token = mirrorTokenFromHash(hash);
  if (!token) return { kind: 'ignore' };
  const plan = decodePlan(token);
  if (!plan) return { kind: 'ignore' };
  // Compare normalized encodings: a plan adopted from a hash is stored decoded.
  const encoded = encodePlan(plan, 'full');
  const index = plans.findIndex((p) => encodePlan(p, 'full') === encoded);
  return index >= 0 ? { kind: 'mine', index } : { kind: 'mirror' };
}
