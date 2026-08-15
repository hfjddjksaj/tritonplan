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
import type { PlanState, Weekday } from '@triton/shared';
import { matchBuilding } from './buildings';
import { meetingInstances, typeTag } from './plan';

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
  when: PinWhen;
  /** Raw TSS building text, kept so the UI can show it when unmatched. */
  building?: string;
  room?: string;
  rawLocation?: string;
  /** null = no confident building match; shown in a list, never guessed onto the map. */
  coords: { lat: number; lng: number } | null;
  booked: boolean;
}

export function coordsFor(building: string | undefined): { lat: number; lng: number } | null {
  const hit = matchBuilding(building);
  return hit ? { lat: hit.lat, lng: hit.lng } : null;
}

/** Weekly class meetings of every selected section. */
export function meetingPins(plan: PlanState, booked?: ReadonlySet<string>): MapPin[] {
  return meetingInstances(plan).map((m) => ({
    courseId: m.courseId,
    courseCode: m.courseCode,
    hue: m.hue,
    kind: 'meeting' as const,
    label: typeTag(m.type, m.typeText),
    when: { weekday: m.day, start: m.start, end: m.end },
    building: m.building,
    room: m.room,
    rawLocation: m.location,
    coords: coordsFor(m.building),
    booked: booked?.has(m.courseId) ?? false,
  }));
}
