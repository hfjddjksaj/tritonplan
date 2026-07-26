/**
 * UCSD building knowledge for the "where is this class?" popover.
 *
 * Data: web/src/data/ucsd-buildings.json — generated from UCSD's official
 * campus-map GIS layer by `npm run fetch:buildings -w @triton/web` (dev-time
 * only; bundled statically, the page itself makes no requests).
 *
 * Matching repairs names TSS truncates mid-word ("…Engineering Buildin" —
 * the source field caps at 40 chars) via unique-prefix lookup, and absorbs
 * cosmetic differences between TSS and official names: case/whitespace,
 * "&" vs "and", roman numerals, an optional trailing "Building". Anything
 * unmatched falls back to the raw text — never worse than before.
 */
import dataset from '../data/ucsd-buildings.json';
import { BUILDING_ALIASES, EXTRA_BUILDINGS, type BuildingRow } from './building-aliases';

export interface BuildingMatch {
  /** Official FacilityLongName (repaired/canonical display name). */
  name: string;
  lat: number;
  lng: number;
}

const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' };

/** Lowercase, collapse whitespace, standalone "&"→"and", roman tokens→digits. */
function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ & /g, ' and ')
    .split(' ')
    .map((tok) => ROMAN[tok] ?? tok)
    .join(' ');
}

/**
 * Keys a name is registered and looked up under: its normalized form plus a
 * variant without a trailing " building". Both sides register both variants;
 * keeping the FULL official name in the index is what lets a 40-char
 * truncated query still prefix-match it (a stripped-only index would make
 * keys shorter than the query and defeat startsWith).
 */
function keyVariants(s: string): string[] {
  const norm = normalizeKey(s);
  const variants = [norm];
  if (norm.endsWith(' building')) {
    const stripped = norm.slice(0, -' building'.length);
    if (stripped) variants.push(stripped);
  }
  return variants;
}

/** 'ambiguous' poisons a key claimed by two different buildings. */
const index = new Map<string, BuildingMatch | 'ambiguous'>();
const byName = new Map<string, BuildingMatch>();

function register(key: string, entry: BuildingMatch): void {
  const cur = index.get(key);
  if (cur === undefined) index.set(key, entry);
  else if (cur !== entry) index.set(key, 'ambiguous');
}

function addBuilding(row: BuildingRow): void {
  const [name, aliases, lat, lng] = row;
  const entry: BuildingMatch = { name, lat, lng };
  byName.set(name, entry);
  for (const label of [name, ...aliases]) {
    for (const key of keyVariants(label)) register(key, entry);
  }
}

(dataset.buildings as unknown as BuildingRow[]).forEach(addBuilding);
EXTRA_BUILDINGS.forEach(addBuilding);
for (const [alias, target] of Object.entries(BUILDING_ALIASES)) {
  const entry = byName.get(target);
  if (!entry) continue; // dataset drifted; the sanity test in Task 3 catches this
  // Unconditional set (not register()): the overlay is a deliberate human
  // ruling and must win even if a dataset refresh later collides on this
  // key, rather than being poisoned to 'ambiguous' like a plain data clash.
  for (const key of keyVariants(alias)) index.set(key, entry);
}

/**
 * Resolve a (possibly truncated) TSS building name to its official record.
 * Exact match on any key variant wins; otherwise a unique prefix match
 * repairs a TSS truncation. Null when unknown or ambiguous — callers keep
 * the raw text then.
 */
export function matchBuilding(raw: string | undefined): BuildingMatch | null {
  if (!raw) return null;
  const variants = keyVariants(raw);
  const norm = variants[0]!;
  if (norm.length < 4) return null; // too short to trust
  for (const v of variants) {
    const hit = index.get(v);
    if (hit && hit !== 'ambiguous') return hit;
  }
  let candidate: BuildingMatch | null = null;
  for (const [key, entry] of index) {
    if (!key.startsWith(norm)) continue;
    if (entry === 'ambiguous' || (candidate !== null && candidate !== entry)) return null;
    candidate = entry;
  }
  return candidate;
}

/**
 * Count of index keys currently poisoned to 'ambiguous'. Exists for the
 * dataset-drift guard test in buildings.test.ts, which caps this number so a
 * future `npm run fetch:buildings` refresh that explodes cross-building
 * alias collisions fails loudly instead of silently nulling out
 * matchBuilding() for a growing set of real buildings.
 */
export function ambiguousKeyCount(): number {
  let count = 0;
  for (const v of index.values()) if (v === 'ambiguous') count++;
  return count;
}

/**
 * Google Maps deep link (user-initiated navigation only): exact coordinates
 * for a matched building, or a campus-scoped text search as fallback.
 */
export function googleMapsLink(target: { lat: number; lng: number } | string): string {
  const query =
    typeof target === 'string' ? `${target}, UC San Diego` : `${target.lat},${target.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * UCSD's own campus map (ArcGIS Experience app). It exposes no per-building
 * deep-link parameters, so this opens at campus view for a manual search.
 */
export const UCSD_CAMPUS_MAP_URL =
  'https://experience.arcgis.com/experience/c97d6e2efd7947d38738d5184b2debc7';
