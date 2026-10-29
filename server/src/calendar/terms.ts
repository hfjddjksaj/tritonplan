// UCSD weeks of instruction per term, as ISO dates (America/Los_Angeles calendar days), keyed `${year}|${period}`
// like the course ids. The live TSS feed leaves BeginDate / EndDate off its sections (extension/src/parser/tss-types.ts),
// so a weekly meeting without them recurs over its term's span from here; a term not listed keeps such meetings out.
// Source: UCSD "Academic and Administrative Calendar 2026-2027" (the page holidays.ts cites), checked 2026-10-29:
//   Fall 2026 instruction Thursday, September 24 - Friday, December 4 (the 2026-07 captures' own dates agree);
//   Winter 2027 Monday, January 4 - Friday, March 12; Spring 2027 Monday, March 29 - Friday, June 4.
// Period codes only as web/src/lib/terms.ts grounds them: '2' = Fall, '3' = Winter, whose year that file takes to be
// the calendar year the quarter runs in (to be checked against the first real Winter capture). Spring's code has not
// been seen yet: add it, and the next academic year, once known.
export const UCSD_INSTRUCTION: Readonly<Record<string, { begin: string; end: string }>> = {
  '2026|2': { begin: '2026-09-24', end: '2026-12-04' },
  '2027|3': { begin: '2027-01-04', end: '2027-03-12' },
};
