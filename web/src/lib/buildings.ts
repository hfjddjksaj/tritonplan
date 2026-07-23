/**
 * UCSD building knowledge for the "where is this class?" popover.
 *
 * A curated STARTER list of canonical building names (extend as unmatched names
 * show up). Its two jobs:
 *   1. repair names TSS truncates mid-word ("…Engineering Buildin") — a truncated
 *      name is always a strict prefix of its canonical form;
 *   2. feed an accurate query to the maps deep link.
 * Anything we can't match falls back to the raw text — never worse than before.
 */

const BUILDINGS: string[] = [
  'Applied Physics and Mathematics Building',
  'Biomedical Sciences Building',
  'Bonner Hall',
  'Catalyst',
  'Center Hall',
  'Cognitive Science Building',
  'Computer Science and Engineering Building',
  'Design and Innovation Building',
  'Economics Building',
  'Engineering Building Unit 2',
  'Franklin Antonio Hall',
  'Galbraith Hall',
  'Humanities and Social Sciences Building',
  'Jacobs Hall',
  'Ledden Auditorium',
  'Mandeville Center',
  'Mayer Hall',
  'McGill Hall',
  'Mosaic',
  'Natural Sciences Building',
  'Otterson Hall',
  'Pacific Hall',
  'Pepper Canyon Hall',
  'Peterson Hall',
  'Price Center',
  'Rady School of Management',
  'Sequoyah Hall',
  'Social Sciences Building',
  'Solis Hall',
  'Structural and Materials Engineering Building',
  'Tata Hall',
  'Urey Hall',
  'Warren Lecture Hall',
  'Wells Fargo Hall',
  'York Hall',
];

/**
 * Resolve a (possibly truncated) TSS building name to its canonical form.
 * Exact match wins; otherwise a unique prefix match repairs the truncation.
 * Returns null when unknown or ambiguous — callers keep the raw text then.
 */
export function canonicalBuilding(raw: string | undefined): string | null {
  if (!raw) return null;
  const norm = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  if (norm.length < 4) return null; // too short to trust a prefix match
  const exact = BUILDINGS.find((b) => b.toLowerCase() === norm);
  if (exact) return exact;
  const prefixed = BUILDINGS.filter((b) => b.toLowerCase().startsWith(norm));
  return prefixed.length === 1 ? prefixed[0]! : null;
}

/** Google Maps search deep link for a campus building (user-initiated navigation only). */
export function googleMapsLink(building: string): string {
  const query = `${building}, UC San Diego`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * UCSD's own campus map (ArcGIS Experience app). It exposes no per-building
 * deep-link parameters, so this opens at campus view for a manual search.
 */
export const UCSD_CAMPUS_MAP_URL =
  'https://experience.arcgis.com/experience/c97d6e2efd7947d38738d5184b2debc7';
