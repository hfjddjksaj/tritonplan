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

export const BUILDING_ALIASES: Record<string, string> = {};

export const EXTRA_BUILDINGS: BuildingRow[] = [];
