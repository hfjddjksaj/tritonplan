/**
 * Naming rules for the campus map: which district is which college, which
 * roads deserve a name, and how a building's footprint name gets shortened.
 *
 * Pure functions and lookup tables, independent of how the geometry is drawn
 * — `map-data.ts` uses these to build the labelled GeoJSON sources the
 * MapLibre style renders.
 */
import type { CampusLine } from './campus-geo';

/* ------------------------------------------------------------ districts */

/**
 * ArcGIS "Campus Districts" name → what a student calls the place. Verified by
 * point-in-polygon against the bundled data (2026-08-16): Peterson/Solis fall
 * in "Ridge Walk North", the Seventh College subdistricts in "North Campus",
 * Sixth's NTPLLN buildings (Mosaic, Catalyst) in "North Torrey Pines", Eighth's
 * residences in "Theatre District", ERC's in "Roosevelt". Districts not listed
 * are labelled by their own name.
 */
export const DISTRICT_LABELS: Readonly<Record<string, string>> = {
  'Ridge Walk North': 'Marshall',
  Roosevelt: 'ERC',
  'North Torrey Pines': 'Sixth',
  'North Campus': 'Seventh',
  'Theatre District': 'Eighth',
  'Scripps Institution': 'Scripps',
  'Health Sciences East': 'Health Sciences East',
  'La Jolla del Sol': 'La Jolla del Sol',
};

/** Districts too small or too far off to earn a label. */
export const UNLABELLED_DISTRICTS: ReadonlySet<string> = new Set([
  'Audrey Geisel University House',
  'Beach Properties',
  'Biology Field Station',
]);

/** The undergraduate colleges plus University Center (where classes are). */
const CORE_DISTRICTS: ReadonlySet<string> = new Set([
  'Revelle',
  'Muir',
  'Ridge Walk North',
  'Warren',
  'Roosevelt',
  'North Torrey Pines',
  'North Campus',
  'Theatre District',
  'University Center',
]);

/**
 * Who wins a crowded spot: the colleges and University Center (where classes
 * are) before the outlying districts. Lower is more important.
 */
export function districtPriority(name: string): number {
  return CORE_DISTRICTS.has(name) ? 0 : 1;
}

/** The label to draw for a district, or null if it should stay unlabelled. */
export function districtLabel(name: string): string | null {
  if (UNLABELLED_DISTRICTS.has(name)) return null;
  return DISTRICT_LABELS[name] ?? name;
}

/* ------------------------------------------------------------- landmarks */

/**
 * A handful of buildings everyone knows, named on the basemap so a student can
 * anchor themselves before reading the pins. Names are exact footprint names.
 */
export const LANDMARKS: readonly { footprint: string; label: string }[] = [
  { footprint: 'Geisel Library', label: 'Geisel Library' },
  { footprint: 'Price Center West', label: 'Price Center' },
  { footprint: 'RIMAC', label: 'RIMAC' },
  { footprint: 'Center Hall', label: 'Center Hall' },
  { footprint: 'Student Services Center', label: 'Student Services' },
];

/* ----------------------------------------------------------------- roads */

export const ABBREVIATIONS: readonly [RegExp, string][] = [
  [/\bNorth\b/g, 'N'],
  [/\bSouth\b/g, 'S'],
  [/\bEast\b/g, 'E'],
  [/\bWest\b/g, 'W'],
  [/\bRoad\b/g, 'Rd'],
  [/\bDrive\b/g, 'Dr'],
  [/\bAvenue\b/g, 'Ave'],
  [/\bBoulevard\b/g, 'Blvd'],
  [/\bStreet\b/g, 'St'],
  [/\bLane\b/g, 'Ln'],
  [/\bCourt\b/g, 'Ct'],
  [/\bParkway\b/g, 'Pkwy'],
  [/\bPlace\b/g, 'Pl'],
];

/** OSM freeway names → the numbers on the signs. */
export const FREEWAYS: Readonly<Record<string, string>> = {
  'San Diego Freeway': 'I-5',
  'Jacob Dekema Freeway': 'I-805',
};

/** "North Torrey Pines Road" → "N Torrey Pines Rd"; freeways by number. */
export function roadLabelText(name: string): string {
  if (FREEWAYS[name]) return FREEWAYS[name]!;
  let out = name;
  for (const [re, abbr] of ABBREVIATIONS) out = out.replace(re, abbr);
  return out;
}

/**
 * Minor roads and walkways worth naming: the campus ring roads and the named
 * pedestrian spines. Every highway and major road with a name is labelled
 * regardless; residential streets off campus are not.
 */
export const LABELLED_MINOR: ReadonlySet<string> = new Set([
  'Voigt Drive',
  'Hopkins Drive',
  'John Jay Hopkins Drive',
  'Scholars Drive North',
  'Scholars Drive South',
  'Russell Lane',
  'Campus Point Drive',
  'Pepper Canyon Drive',
  'Muir Lane',
  'Lyman Lane',
  'Justice Lane',
  'Matthews Lane',
  'Mandeville Lane',
  'Thurgood Marshall Lane',
  'Rupertus Lane',
  'Ridge Walk',
  'Library Walk',
  'Warren Mall',
  'Revelle Plaza',
  'Price Center Plaza',
  'Snake Path',
  'Osler Lane',
  'Health Sciences Drive',
  'Medical Center Drive',
  'Expedition Way',
  'Regents Road',
  'Miramar Street',
]);

export function wantsRoadLabel(line: CampusLine): boolean {
  if (!line.name) return false;
  if (line.kind === 'hwy' || line.kind === 'major') return true;
  return LABELLED_MINOR.has(line.name);
}

/* ------------------------------------------------------- building names */

/**
 * The stock words of a building name, shortened the way campus signage does.
 * Also runs the road {@link ABBREVIATIONS} (Drive→Dr, Street→St, North→N, …):
 * a building whose official name is a street address (e.g. "9500 Gilman
 * Drive", "134 Dickinson") needs the same shortening a road label gets, or it
 * never fits the map at any zoom.
 */
export function abbreviateBuildingWords(name: string): string {
  let out = name
    .replace(/\bBuilding\b/g, 'Bldg')
    .replace(/\bLaboratory\b/g, 'Lab')
    .replace(/\bLaboratories\b/g, 'Labs')
    .replace(/\bEngineering\b/g, 'Eng')
    .replace(/\bCenter\b/g, 'Ctr')
    .replace(/\bResidence Halls?\b/g, 'Res Hall')
    .replace(/\bApartments\b/g, 'Apts')
    .replace(/\bParking Structure\b/g, 'Parking')
    .replace(/\band\b/g, '&')
    .replace(/^The\s+/, '');
  for (const [re, abbr] of ABBREVIATIONS) out = out.replace(re, abbr);
  return out;
}

/**
 * Footprint names too long to help, shortened where a stock word allows. Used
 * to be null for any name starting with a digit (meant to filter street
 * addresses like "9500 Gilman Drive"), but that also blanked real buildings
 * whose official name simply starts with a number ("134 Dickinson", "64
 * Degrees") — a building whose name *is* its address should read as that
 * address rather than an unnamed grey block, so there is no address guard
 * here any more.
 */
export function buildingShortName(name: string): string | null {
  if (!name) return null;
  const out = abbreviateBuildingWords(name);
  if (out.length > 46) return null;
  return out;
}
