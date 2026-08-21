/**
 * The plan's places, as the Distance bar's two dropdowns list them.
 *
 * Deliberately NOT sliced by weekday and NOT following the map's current view.
 * A distance is a distance: which of Classes / Finals / Midterms you happen to
 * be looking at, or which day a lecture meets, has no bearing on how far it is
 * from one building to another. Following the view would also mean a picked A
 * or B could vanish out from under the reader when they switch tabs.
 *
 * Unusable entries are kept and DISABLED rather than hidden: a student needs to
 * see why their own course is not selectable.
 */
import type { PlanState } from '@triton/shared';
import { finalPins, isOnlineModality, meetingPins, midtermPins, type MapPin } from './map-pins';

export interface WalkPlace {
  /** Stable across re-derivation; safe as a React key and a select value. */
  id: string;
  courseCode: string;
  /** 'LEC' | 'DIS' | 'Final' | 'Midterm 2' … */
  label: string;
  hue: number;
  place?: string;
  parts?: readonly string[];
  coords: { lat: number; lng: number } | null;
  disabled: boolean;
  disabledReason?: 'online' | 'no-location';
}

/**
 * Identity is course + component + building, and nothing else. The building
 * belongs in it because one course can teach in two of them — CSE 11's lecture
 * in Center Hall and its discussion in CSB are two places to walk to, not one.
 */
const idOf = (pin: MapPin): string =>
  `${pin.courseId}|${pin.label}|${pin.place ?? pin.building ?? ''}`;

export function walkPlaces(plan: PlanState): WalkPlace[] {
  const all = [...meetingPins(plan), ...midtermPins(plan), ...finalPins(plan)];
  const seen = new Map<string, WalkPlace>();
  for (const pin of all) {
    const id = idOf(pin);
    if (seen.has(id)) continue; // an MWF lecture is one place, not three
    const online = isOnlineModality(pin.modality);
    seen.set(id, {
      id,
      courseCode: pin.courseCode,
      label: pin.label,
      hue: pin.hue,
      place: pin.place,
      parts: pin.parts,
      coords: pin.coords,
      disabled: pin.coords === null,
      disabledReason: pin.coords === null ? (online ? 'online' : 'no-location') : undefined,
    });
  }
  return [...seen.values()];
}
