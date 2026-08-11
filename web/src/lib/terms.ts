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

/** Label for a term whose season is already known (the layoutRows test seam
 *  passes seasons explicitly, before the real SAP codes are mapped). */
function labelFor(term: Term, season: Season | null): string {
  if (!season) return term.label || `Period ${term.period} ${term.year}`;
  const y = Number(term.year);
  return `${SEASON_NAMES[season]} ${season === 'winter' ? y - 1 : y}`;
}

export function displayTermLabel(term: Term): string {
  return labelFor(term, seasonOf(term));
}

/** Season order within ONE calendar year: Winter(Jan) < Spring < Summer I/II < Fall(Sep). */
const SEASON_ORDER: Record<Season, number> = {
  winter: 0,
  spring: 1,
  summer1: 2,
  summer2: 3,
  fall: 4,
};

/** Sortable timeline index; null for unknown seasons. */
export function chronoIndex(term: Term): number | null {
  const season = seasonOf(term);
  if (!season) return null;
  return Number(term.year) * 10 + SEASON_ORDER[season];
}

// Fixed month-day archive boundaries (spec §6): a term is archived once `now`
// reaches the boundary after its finals week. Real dates drift ±1 week per
// year; the boundary only decides default display + freeze timing, so a fixed
// approximation is deliberately chosen over a per-year calendar table.
const BOUNDARY: Record<Season, { month: number; day: number }> = {
  fall: { month: 12, day: 20 },
  winter: { month: 3, day: 22 },
  spring: { month: 6, day: 15 },
  summer1: { month: 9, day: 15 },
  summer2: { month: 9, day: 15 },
};

/** The boundary falls in the quarter's own calendar year (= term.year). */
export function archiveBoundary(term: Term): Date | null {
  const season = seasonOf(term);
  if (!season) return null;
  const { month, day } = BOUNDARY[season];
  return new Date(Number(term.year), month - 1, day);
}

export function isArchived(term: Term, now: Date): boolean {
  const b = archiveBoundary(term);
  return b !== null && now.getTime() >= b.getTime();
}

export interface SwitcherCell {
  key: TermKey | null; // null = grey placeholder, not clickable
  label: string;
  selectable: boolean;
  current: boolean;
  archived: boolean;
}

export interface SwitcherRows {
  quarterRows: SwitcherCell[][]; // rows of 3: Fall | Winter | Spring, ascending AY
  summerRows: SwitcherCell[][]; // rows of 2: Summer I | Summer II, ascending year
  otherRows: SwitcherCell[]; // unknown-period terms, fallback label
}

function cellFor(term: Term, season: Season | null, activeKey: TermKey, now: Date): SwitcherCell {
  const key = termKey(term);
  return {
    key,
    label: labelFor(term, season),
    selectable: true,
    current: key === activeKey,
    archived: isArchived(term, now),
  };
}

function placeholder(label: string): SwitcherCell {
  return { key: null, label, selectable: false, current: false, archived: false };
}

/**
 * Layout core, parameterized by season so summer rows are testable before the
 * real SAP summer codes are known. Production callers use buildSwitcherRows.
 */
export function layoutRows(
  items: { term: Term; season: Season | null }[],
  activeKey: TermKey,
  now: Date,
): SwitcherRows {
  // Academic-year start for a quarter: fall → its year; winter/spring → year − 1.
  const ayOf = (season: Season, year: number) => (season === 'fall' ? year : year - 1);

  const byAy = new Map<number, Partial<Record<'fall' | 'winter' | 'spring', Term>>>();
  const bySummerYear = new Map<number, Partial<Record<'summer1' | 'summer2', Term>>>();
  const otherRows: SwitcherCell[] = [];

  for (const { term, season } of items) {
    const year = Number(term.year);
    if (season === 'fall' || season === 'winter' || season === 'spring') {
      const ay = ayOf(season, year);
      const row = byAy.get(ay) ?? {};
      row[season] = term;
      byAy.set(ay, row);
    } else if (season === 'summer1' || season === 'summer2') {
      const row = bySummerYear.get(year) ?? {};
      row[season] = term;
      bySummerYear.set(year, row);
    } else {
      otherRows.push(cellFor(term, null, activeKey, now));
    }
  }

  const quarterRows = [...byAy.keys()].sort((a, b) => a - b).map((ay) => {
    const row = byAy.get(ay)!;
    return [
      row.fall ? cellFor(row.fall, 'fall', activeKey, now) : placeholder(`Fall ${ay}`),
      row.winter ? cellFor(row.winter, 'winter', activeKey, now) : placeholder(`Winter ${ay}`),
      row.spring ? cellFor(row.spring, 'spring', activeKey, now) : placeholder(`Spring ${ay + 1}`),
    ];
  });

  const summerRows = [...bySummerYear.keys()].sort((a, b) => a - b).map((y) => {
    const row = bySummerYear.get(y)!;
    return [
      row.summer1 ? cellFor(row.summer1, 'summer1', activeKey, now) : placeholder(`Summer I ${y}`),
      row.summer2 ? cellFor(row.summer2, 'summer2', activeKey, now) : placeholder(`Summer II ${y}`),
    ];
  });

  return { quarterRows, summerRows, otherRows };
}

export function buildSwitcherRows(terms: Term[], activeKey: TermKey, now: Date): SwitcherRows {
  return layoutRows(terms.map((term) => ({ term, season: seasonOf(term) })), activeKey, now);
}
