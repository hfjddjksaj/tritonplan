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
import {
  optionMidterms,
  type Component,
  type CourseOffering,
  type FinalExam,
  type Meeting,
  type MidtermExam,
  type PlanState,
  type PrereqGroup,
  type SectionOption,
  type TeachingMethod,
  type Term,
  type Weekday,
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
  // Appended 2026-07-29; absent in older tokens (old decoders ignore it, this
  // decoder reads undefined → no midterms → TBD rows).
  midterms?: WireFinal[] | 0,
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
  const opts: WireOpt[] = course.options.map((o) => {
    // Midterms live in rawSched, which the wire drops — derive them at encode
    // time so the receiving device (no rawSched) still sees them.
    const midterms = optionMidterms(o);
    return [
      o.code,
      o.enrollCode,
      o.seatsAvailable ?? -1,
      o.limit ?? -1,
      o.final ? [o.final.date, o.final.start, o.final.end, o.final.modality ?? ''] : 0,
      o.components.map(compIdx),
      midterms.length
        ? midterms.map((m): WireFinal => [m.date, m.start, m.end, m.modality ?? ''])
        : 0,
    ];
  });
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
    const [code, enrollCode, seats, limit, fin, compIdx, mts] = o;
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
    if (Array.isArray(mts) && mts.length > 0) {
      out.midterms = mts.map(([date, start, end, modality]) => {
        const m: MidtermExam = { date, start, end };
        if (modality) m.modality = modality;
        return m;
      });
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
