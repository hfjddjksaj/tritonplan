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
 * "&" vs "and", roman numerals, an optional trailing "Building". A prefix
 * that lands on SEVERAL official records still resolves when those records
 * are one building complex (see COMPLEX_RADIUS_M). Anything unmatched falls
 * back to the raw text — never worse than before.
 */
import dataset from '../data/ucsd-buildings.json';
import { BUILDING_ALIASES, EXTRA_BUILDINGS, type BuildingRow } from './building-aliases';

export interface BuildingMatch {
  /** Official FacilityLongName (repaired/canonical display name). */
  name: string;
  lat: number;
  lng: number;
  /**
   * Present only on a COMPLEX match: the official names of the wings this
   * stands for, so the map can outline all of them instead of picking one.
   * `name` is then their shared prefix ("Asante House"), which is a label —
   * not a footprint — and matches no polygon on its own.
   */
  parts?: readonly string[];
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
 * How far apart two official records may sit and still be called one complex.
 *
 * TSS names the complex ("Asante House 123A"); the GIS layer only has its
 * wings ("Asante House East / West / Meeting Rooms"), so the prefix scan below
 * finds three records and used to give up — MMW's discussion sections, which
 * meet in exactly these ERC houses, all landed in "not on the map". Measured
 * over the whole dataset, the 131 prefixes that hit several records split
 * cleanly by how tightly those records cluster: 75 sit inside 50 m (wings of
 * one building — the four ERC houses at 13–21 m, Student Center A at 43 m,
 * Visual Arts Facility at 44 m, Price Center at 46 m), while the ones that
 * mean genuinely different places are hundreds of metres to kilometres apart
 * ("Center for …" spans the campus).
 *
 * 60 m is set at the top of the tight cluster and below the next one up
 * (Matthews Apartments, 78 m; the 20-building Extended Studies compound, 84 m;
 * Birch Aquarium, 101 m). It is also about the width of one large building,
 * which is the claim being made — and at the map's home framing (1.85 m/px,
 * measured) it is ~32 px, so the ambiguity is smaller than the pin drawn over
 * it. Anything looser and the pin would point at a different building, which
 * is worse than saying nothing.
 */
export const COMPLEX_RADIUS_M = 60;

/** Metres between two points, flat-earth — fine at these distances. */
function metresApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * The label a set of wings share: their longest common run of leading words,
 * in the official casing, stripped of the punctuation a split leaves dangling
 * ("Extended Studies and Public Programs -" → "… Programs"). Empty when they
 * share nothing, which is the signal not to invent a complex.
 */
function sharedName(names: readonly string[]): string {
  const words = names.map((n) => n.split(' '));
  const first = words[0]!;
  let n = 0;
  while (n < first.length && words.every((w) => w[n]?.toLowerCase() === first[n]!.toLowerCase())) n++;
  return first.slice(0, n).join(' ').replace(/[s-–—,:]+$/, '');
}

/**
 * Fold several official records into one complex, or null if they are too far
 * apart (different places) or share no name (unrelated hits off one prefix).
 * The coordinates are the centroid, so the pin sits in the middle of the
 * complex rather than on whichever wing happened to sort first.
 */
function asComplex(hits: readonly BuildingMatch[]): BuildingMatch | null {
  const lat = hits.reduce((t, h) => t + h.lat, 0) / hits.length;
  const lng = hits.reduce((t, h) => t + h.lng, 0) / hits.length;
  if (hits.some((h) => metresApart(h, { lat, lng }) > COMPLEX_RADIUS_M)) return null;
  const parts = hits.map((h) => h.name).sort();
  const name = sharedName(parts);
  return name ? { name, lat, lng, parts } : null;
}

/**
 * Resolve a (possibly truncated) TSS building name to its official record.
 * Exact match on any key variant wins; otherwise a prefix match repairs a TSS
 * truncation — landing on one record, or on several that turn out to be wings
 * of one complex (see COMPLEX_RADIUS_M). Null when unknown or genuinely
 * ambiguous — callers keep the raw text then.
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
  const hits = new Set<BuildingMatch>();
  for (const [key, entry] of index) {
    if (!key.startsWith(norm)) continue;
    // A poisoned key is two UNRELATED buildings on one string; there is
    // nothing to reason about, unlike several records of one complex.
    if (entry === 'ambiguous') return null;
    hits.add(entry);
  }
  if (hits.size === 0) return null;
  if (hits.size === 1) return [...hits][0]!;
  return asComplex([...hits]);
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
