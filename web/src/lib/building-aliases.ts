/**
 * Hand-curated overlay for TSS building names the official UCSD GIS layer
 * doesn't carry verbatim.
 *
 * BUILDING_ALIASES maps a TSS-seen name onto an official FacilityLongName
 * (coordinates come from the official record). EXTRA_BUILDINGS holds whole
 * buildings absent from the layer — add [name, aliases, lat, lng] rows with
 * an evidence comment as unmatched names show up in the wild.
 */
export type BuildingRow = [name: string, aliases: string[], lat: number, lng: number];

export const BUILDING_ALIASES: Record<string, string> = {
  // Auditorium inside the Humanities and Social Sciences complex (HSS 2250);
  // the GIS layer has no separate point for it. Verified 2026-07-26.
  'Ledden Auditorium': 'Humanities and Social Sciences',
  // TSS names the school; Otterson Hall is Rady's original/main building.
  // Verified against the official layer 2026-07-26.
  'Rady School of Management': 'Otterson Hall',
  // The official layer splits the complex into West / East Expansion;
  // West is the original main hall. Verified 2026-07-26.
  'Price Center': 'Price Center West',
};

export const EXTRA_BUILDINGS: BuildingRow[] = [];
