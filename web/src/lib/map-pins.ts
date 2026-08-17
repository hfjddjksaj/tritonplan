/**
 * Plan → map pins.
 *
 * Each source is a thin adapter over a derivation that already exists, so
 * "what is in this plan" has exactly one truth. Adding a category later (exam
 * locations) is one more ~15-line function plus one more PinKind — the map
 * component only ever sees MapPin[].
 *
 * `booked` is computed at RENDER time from the term workspace and is never
 * written into PlanState: booked status must not reach a share link.
 */
import type { PlanState, Weekday, FinalExam } from '@triton/shared';
import { examDisplay } from '@triton/shared';
import { matchBuilding } from './buildings';
import { finalsSorted, meetingInstances, midtermsSorted, typeTag } from './plan';
import { visibleDays } from './layout';
import { dateParts, isoDate } from './format';

export type PinKind = 'meeting' | 'midterm' | 'final';

/** Recurring meetings carry `weekday`; one-off exams carry `date`. Never both. */
export interface PinWhen {
  weekday?: Weekday;
  date?: string; // ISO "YYYY-MM-DD"
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface MapPin {
  courseId: string;
  courseCode: string;
  /** Same hue as this course's calendar blocks and card. */
  hue: number;
  kind: PinKind;
  /** 'LEC' | 'DIS' | 'LAB' | 'Midterm 2' | 'Final' … */
  label: string;
  /** Raw TSS modality ("In Person" | "Live Online" | …), so the UI can say
   *  "this class is online" instead of "TritonPlan couldn't find the building". */
  modality?: string;
  when: PinWhen;
  /** Raw TSS building text, kept so the UI can show it when unmatched. */
  building?: string;
  /**
   * The matched building's official name (ArcGIS FacilityLongName), when
   * `building` resolved — TSS truncates at 40 chars ("…Engineering Buildin"),
   * so this, not `building`, is what footprints and popovers key on.
   */
  place?: string;
  room?: string;
  rawLocation?: string;
  /** null = no confident building match; shown in a list, never guessed onto the map. */
  coords: { lat: number; lng: number } | null;
  booked: boolean;
}

/**
 * Whether a TSS modality means "not in a room on campus".
 *
 * TSS modality is free text. Real captured `Sched` lines carry "In Person" and
 * "Live Online"; the site's own Modality filter additionally lists "Online" and
 * "Other" (docs/tss-recon/tss-api-notes.md). "Other" is not reliably remote, so
 * only the "online" family counts — a wrong "this class is online" would be
 * worse than the generic unmatched copy.
 */
export function isOnlineModality(modality: string | undefined): boolean {
  return /online/i.test(modality ?? '');
}

function located(building: string | undefined): Pick<MapPin, 'place' | 'coords'> {
  const hit = matchBuilding(building);
  return hit ? { place: hit.name, coords: { lat: hit.lat, lng: hit.lng } } : { coords: null };
}

/** Weekly class meetings of every selected section. */
export function meetingPins(plan: PlanState, booked?: ReadonlySet<string>): MapPin[] {
  return meetingInstances(plan).map((m) => ({
    courseId: m.courseId,
    courseCode: m.courseCode,
    hue: m.hue,
    kind: 'meeting' as const,
    label: typeTag(m.type, m.typeText),
    modality: m.modality,
    when: { weekday: m.day, start: m.start, end: m.end },
    building: m.building,
    room: m.room,
    rawLocation: m.location,
    ...located(m.building),
    booked: booked?.has(m.courseId) ?? false,
  }));
}

/**
 * Shared shape for the two exam sources. The location MUST come from
 * examDisplay(): pre-2026-08-11 captures keep the whole "@ <Location>" tail
 * inside `modality`, and reading `exam.building` directly loses it.
 */
function examPin(
  kind: 'midterm' | 'final',
  item: { courseId: string; courseCode: string; hue: number },
  exam: FinalExam,
  label: string,
  booked?: ReadonlySet<string>,
): MapPin {
  const place = examDisplay(exam);
  return {
    courseId: item.courseId,
    courseCode: item.courseCode,
    hue: item.hue,
    kind,
    label,
    modality: place.modality,
    when: { date: exam.date, start: exam.start, end: exam.end },
    building: place.building,
    room: place.room,
    rawLocation: place.location,
    ...located(place.building),
    booked: booked?.has(item.courseId) ?? false,
  };
}

/** Final exam locations. Courses without a final contribute nothing. */
export function finalPins(plan: PlanState, booked?: ReadonlySet<string>): MapPin[] {
  return finalsSorted(plan).map((item) =>
    examPin('final', item, item.final, 'Final', booked),
  );
}

/** Midterm locations. Courses TSS hasn't announced a midterm for contribute nothing. */
export function midtermPins(plan: PlanState, booked?: ReadonlySet<string>): MapPin[] {
  return midtermsSorted(plan).dated.map((item) =>
    examPin('midterm', item, item.midterm, item.label ?? 'Midterm', booked),
  );
}

export interface PinSlice {
  id: string;
  label: string;
}

export interface PinSlices {
  slices: PinSlice[];
  /** A filter for one slice id. 'all' passes everything. */
  predicate(sliceId: string): (pin: MapPin) => boolean;
}

const ALL: PinSlice = { id: 'all', label: 'All' };

/**
 * How a view slices its pins — one level below the view's span: Classes span a
 * week → by weekday; Finals span finals week → by date; Midterms span the term
 * → by week. A design decision per view, not something inferred from the pins.
 */
export type SliceBy = 'weekday' | 'date' | 'week';

/** ISO date of the Monday that starts the week containing `iso` (weeks run Mon–Sun). */
export function weekStartIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); // Mon=0 … Sun=6 days back
  return isoDate(dt);
}

/** "Oct 19–25", or "Oct 26–Nov 01" when the week crosses a month. */
export function weekLabel(mondayIso: string): string {
  const [y, m, d] = mondayIso.split('-').map(Number);
  const sunday = isoDate(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 6));
  const a = dateParts(mondayIso);
  const b = dateParts(sunday);
  return a.month === b.month ? `${a.month} ${a.day}–${b.day}` : `${a.month} ${a.day}–${b.month} ${b.day}`;
}

/**
 * Available time slices for a pin set at the given granularity, plus the
 * matching filter. Only slices that actually carry a pin are offered (the
 * weekday branch keeps the calendar's own visibleDays rule: Mon–Fri always,
 * weekends only when something meets then); All is always first.
 */
export function slicesFor(pins: MapPin[], by: SliceBy): PinSlices {
  if (by === 'weekday') {
    const used = new Set(pins.map((p) => p.when.weekday).filter((d): d is Weekday => !!d));
    const slices = used.size === 0 ? [ALL] : [ALL, ...visibleDays(used).map((d) => ({ id: d, label: d }))];
    return {
      slices,
      predicate: (id) => (id === ALL.id ? () => true : (pin) => pin.when.weekday === id),
    };
  }
  const dates = pins.map((p) => p.when.date).filter((d): d is string => !!d);
  if (by === 'date') {
    const slices = [
      ALL,
      ...[...new Set(dates)].sort().map((d) => {
        const { month, day } = dateParts(d);
        return { id: d, label: `${month} ${day}` };
      }),
    ];
    return {
      slices,
      predicate: (id) => (id === ALL.id ? () => true : (pin) => pin.when.date === id),
    };
  }
  const weeks = [...new Set(dates.map(weekStartIso))].sort();
  return {
    slices: [ALL, ...weeks.map((w) => ({ id: w, label: weekLabel(w) }))],
    predicate: (id) =>
      id === ALL.id ? () => true : (pin) => pin.when.date !== undefined && weekStartIso(pin.when.date) === id,
  };
}

/**
 * Open on today's column — but only when today actually carries a class.
 *
 * The weekday slices come from visibleDays(), which renders Mon–Fri
 * unconditionally. That is right for a calendar grid, where an empty Tuesday
 * column is visibly empty inside a visible week; here it would open a MWF
 * student's map on a blank Tuesday above copy claiming there is nothing to
 * place. Falling back to All shows the week they do have.
 */
export function defaultSliceId(slices: PinSlice[], pins: MapPin[], today?: Weekday): string {
  const hit = slices.find((s) => s.id === today);
  if (!hit) return ALL.id;
  return pins.some((p) => p.when.weekday === today) ? hit.id : ALL.id;
}
