/**
 * A point the student clicked on the map, as one end of a Distance measurement —
 * the parking-lot-to-classroom case, where one end is not in the plan at all.
 *
 * A click inside a footprint BECOMES that building: it is named in the bar and
 * `useWalkRoute` finds its outline by that name, so the route leaves by the
 * building's doors exactly as a course's end does. Parking structures are
 * footprints in the GIS layer ("Hopkins Parking"), which is the case this is
 * for. A click anywhere else — a surface lot, a lawn — has no outline, and the
 * router snaps it to the nearest paths instead.
 *
 * The coordinates stay where the click was even inside a building: in a
 * 300 m parking structure, the level and corner the student parked in is the
 * better start than the structure's middle.
 */
import type { CampusShape } from './campus-geo';
import { pointInRing } from './map-data';
import type { WalkPlace } from './walk-places';

/**
 * The pin's id wherever it lands. It has no `|`, so it cannot equal a
 * `walkPlaceId` (course|label|place); `useWalkRoute` keys on coordinates too,
 * so moving the pin still re-routes. With a pin at BOTH ends each needs its
 * own (`dropped-pin:a`), or the router would read them as one place.
 */
export const DROPPED_ID = 'dropped-pin';

/** Even-odd over every ring, so a courtyard (a hole) reads as outside. */
function inside(lng: number, lat: number, shape: CampusShape): boolean {
  let hits = 0;
  for (const ring of shape.rings) if (pointInRing(lng, lat, ring)) hits++;
  return hits % 2 === 1;
}

export function droppedPlace(
  at: { lat: number; lng: number },
  footprints: readonly CampusShape[],
  id: string = DROPPED_ID,
): WalkPlace {
  const name = footprints.find((f) => inside(at.lng, at.lat, f))?.name;
  return {
    id,
    courseCode: '',
    label: name ?? 'Dropped pin',
    hue: 0,
    place: name,
    coords: { lat: at.lat, lng: at.lng },
    disabled: false,
    dropped: true,
  };
}
