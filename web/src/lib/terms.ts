/**
 * ALL knowledge about SAP academic periods lives HERE and nowhere else:
 * season codes, display labels, academic-year math, archive boundaries.
 * When real Winter/Spring/Summer captures arrive (expected Nov 2026), this is
 * the single file to update. Do NOT guess codes (repo convention) — unknown
 * periods flow through fallbacks: fallback label, no year-grid slot, never
 * auto-archived.
 */
import type { Term } from '@triton/shared';

/** `${year}|${period}` — the same encoding as the CourseOffering id suffix. */
export type TermKey = string;

export function termKey(term: Term): TermKey {
  return `${term.year}|${term.period}`;
}

export type Season = 'fall' | 'winter' | 'spring' | 'summer1' | 'summer2';

// Grounded mappings ONLY:
//  '2' = Fall   — verified 2026-07 (captured BeginDate 2026-09-24)
//  '3' = Winter — appt fixture carries sessionText 'Winter Quarter' for '3'
const SEASON_BY_PERIOD: Record<string, Season> = {
  '2': 'fall',
  '3': 'winter',
};

export function seasonOf(term: Term): Season | null {
  return SEASON_BY_PERIOD[term.period] ?? null;
}

const SEASON_NAMES: Record<Season, string> = {
  fall: 'Fall',
  winter: 'Winter',
  spring: 'Spring',
  summer1: 'Summer I',
  summer2: 'Summer II',
};

/**
 * Display-year rule (user decision, applied globally): Winter shows the
 * ACADEMIC-year start year — the winter after Fall 2026 displays "Winter 2026"
 * even though it runs Jan–Mar 2027. Other seasons show the calendar year.
 * `term.year` is treated as the quarter's own calendar year until verified
 * against real Winter data.
 */
export function displayYear(term: Term): number {
  const y = Number(term.year);
  return seasonOf(term) === 'winter' ? y - 1 : y;
}

export function displayTermLabel(term: Term): string {
  const season = seasonOf(term);
  if (!season) return term.label || `Period ${term.period} ${term.year}`;
  return `${SEASON_NAMES[season]} ${displayYear(term)}`;
}
