// UCSD academic calendar, one table for the planner and the .ics feed. Add each new term here (and its holidays in
// server/src/calendar/holidays.ts) or that term's calendar shows finals only.
//
// Each row: SAP term key (`${year}|${period}`, like the course ids), the day enrollment opens (ISO, America/Los_Angeles
// calendar day; absent when not needed), and the weeks of instruction. The live TSS feed leaves BeginDate / EndDate off
// its sections (extension/src/parser/tss-types.ts), so a weekly meeting without them recurs over its term's span from
// here; a term not listed keeps such meetings out.
// Source: UCSD "Academic and Administrative Calendar 2026-2027" (the page holidays.ts cites), checked 2026-10-29:
//   Fall 2026 instruction Thursday, September 24 - Friday, December 4 (the 2026-07 captures' own dates agree);
//   Winter 2027 Monday, January 4 - Friday, March 12; Spring 2027 Monday, March 29 - Friday, June 4.
// Period codes only as web/src/lib/terms.ts grounds them: '2' = Fall, '3' = Winter. The year in the key is SAP's
// ACADEMIC year, so Winter 2027 is '2026|3' (live TSS sends AcademicYear='2026',AcademicPeriod='3', checked
// 2026-11-05). Spring's code has not been seen yet: add it, and the next academic year, once known.

export interface AcademicTerm {
  year: string;
  period: string;
  /** ISO day (Pacific) enrollment opens for this term. */
  enrollmentOpens?: string;
  /** First and last ISO day of instruction. */
  begin: string;
  end: string;
}

export const UCSD_TERMS: readonly AcademicTerm[] = [
  { year: '2026', period: '2', begin: '2026-09-24', end: '2026-12-04' },
  { year: '2026', period: '3', enrollmentOpens: '2026-11-05', begin: '2027-01-04', end: '2027-03-12' },
];

export function academicTermKey(t: AcademicTerm): string {
  return `${t.year}|${t.period}`;
}

const PT_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/** The America/Los_Angeles calendar day of `now`, as YYYY-MM-DD. Built from the parts, not a locale's layout. */
export function todayPT(now: Date): string {
  const p: Record<string, string> = {};
  for (const part of PT_DAY.formatToParts(now)) if (part.type !== 'literal') p[part.type] = part.value;
  return `${p.year!.padStart(4, '0')}-${p.month!.padStart(2, '0')}-${p.day!.padStart(2, '0')}`;
}

/** The term whose enrollment opened most recently (on or before today, Pacific); null if none has opened. */
export function upcomingTerm(now: Date): AcademicTerm | null {
  const today = todayPT(now);
  let best: AcademicTerm | null = null;
  for (const t of UCSD_TERMS) {
    if (t.enrollmentOpens === undefined || t.enrollmentOpens > today) continue;
    if (best === null || t.enrollmentOpens > (best.enrollmentOpens as string)) best = t;
  }
  return best;
}

/** Weeks of instruction by term key. */
export function instructionSpans(): Readonly<Record<string, { begin: string; end: string }>> {
  return Object.fromEntries(UCSD_TERMS.map((t) => [academicTermKey(t), { begin: t.begin, end: t.end }]));
}
