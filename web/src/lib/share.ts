/**
 * Portable plans.
 *
 * JSON export/import keeps the FULL plan (a lossless local backup).
 *
 * The shareable `#p=…` URL, by contrast, carries a SLIM plan: only the section
 * you actually picked per course, and only the fields needed to render it
 * (times, place, instructor, final, seats). The other section-options and the
 * source/debug fields (rawSched, ids, emails, dates) are dropped, shrinking the
 * link ~85%. A shared plan therefore can't switch sections in place — reopen
 * the course in TSS to pull its full data back. Old full-format links still
 * open (decode falls back to the legacy shape).
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

const HASH_KEY = 'p';
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

/** Compress a plan into a URL-safe token (slim share format). */
export function encodePlan(plan: PlanState): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(toSlim(plan)));
}

/** Inverse of encodePlan. Accepts slim links and legacy full-plan links. */
export function decodePlan(token: string): PlanState | null {
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
export function planToHash(plan: PlanState): string {
  return `${HASH_KEY}=${encodePlan(plan)}`;
}

/** Read a plan out of a raw location hash string ("#p=…" or "p=…"). */
export function planFromHash(hash: string): PlanState | null {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!clean) return null;
  const params = new URLSearchParams(clean);
  const token = params.get(HASH_KEY);
  if (!token) return null;
  return decodePlan(token);
}

/** A full absolute URL that restores this plan when opened. */
export function shareUrl(plan: PlanState, base = window.location.href): string {
  const url = new URL(base);
  url.hash = planToHash(plan);
  return url.toString();
}

/** Trigger a browser download of the plan as a .json file (FULL, lossless). */
export function downloadPlanJson(plan: PlanState): void {
  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `triton-plan-${plan.term.year}-${plan.term.period}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parse an imported JSON string into a PlanState, or null if invalid. */
export function parsePlanJson(text: string): PlanState | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlanState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
