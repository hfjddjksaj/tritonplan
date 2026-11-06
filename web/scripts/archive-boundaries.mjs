// The planner's archive boundaries as plain month-days, for the future-clock
// test runs (test-future-clocks.mjs). They mirror `BOUNDARY` in
// web/src/lib/terms.ts — a term counts as archived from its boundary day on —
// and archive-boundaries.test.mjs keeps the two tables in step. Plain JS so the
// runner can import it from node without a TypeScript loader.

/** Fall 12/20, Winter 3/22, Spring 6/15, Summer I and II 9/15 (one entry). */
export const ARCHIVE_BOUNDARIES = Object.freeze([
  { month: 12, day: 20 },
  { month: 3, day: 22 },
  { month: 6, day: 15 },
  { month: 9, day: 15 },
]);

const pad = (n, width) => String(n).padStart(width, '0');
const ymd = (y, m, d) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

/** The calendar day after a `YYYY-MM-DD` day (UTC arithmetic on a date-only value). */
function dayAfter(day) {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return ymd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/**
 * The day AFTER each of the next `count` boundaries strictly after `today`
 * (`YYYY-MM-DD`): the first day the term is archived in every timezone, so a
 * run pinned there sees the sweep, the default term and the next term's
 * creation the way a student will.
 */
export function nextArchiveDays(today, count) {
  const sorted = [...ARCHIVE_BOUNDARIES].sort((a, b) => a.month - b.month || a.day - b.day);
  const startYear = Number(today.slice(0, 4));
  const out = [];
  for (let year = startYear; out.length < count; year++) {
    for (const { month, day } of sorted) {
      const boundary = ymd(year, month, day);
      if (boundary > today) out.push(dayAfter(boundary));
      if (out.length === count) break;
    }
  }
  return out;
}

const PT_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** `YYYY-MM-DD` of `now` in America/Los_Angeles — the same rule as shared's `todayPT`. */
export function todayPT(now) {
  const parts = Object.fromEntries(PT_DAY.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
