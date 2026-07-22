/**
 * Turn the DENORMALIZED TSS `_sections` rows (one row per Event×EventPackage) for a
 * single module into our normalized CourseOffering:
 *   group rows by EventPackage → each package is a bookable SectionOption whose
 *   member Events (deduped by EventID) become Components; each Event's `Sched`
 *   is parsed into meetings + an optional final. The package's final is taken from
 *   its lecture component.
 */

import type {
  Component,
  CourseOffering,
  FinalExam,
  SectionOption,
  TeachingMethod,
  Term,
} from '@triton/shared';
import type { TssSectionRow } from './tss-types.js';
import { parseSched } from './parse-sched.js';

export interface CourseMeta {
  courseCode: string;       // "CSE-008A"
  title: string;            // "Introduction to Programming ..."
  units?: number;
  academicLevel?: string;
  department?: string;
}

const PERIOD_SEASON: Record<string, string> = {
  // Grounded: AcPeriod "2" = Fall (captured BeginDate 2026-09-24). Others TBD as captured.
  '2': 'Fall',
};

export function termFromRow(year: string, period: string): Term {
  const season = PERIOD_SEASON[period];
  const label = season ? `${season} ${year}` : `Period ${period} ${year}`;
  return { year, period, label };
}

const TYPE_ORDER: Record<string, number> = { LE: 0, SE: 1, DI: 2, LA: 3, ST: 4, IN: 5 };
function typeRank(t: string): number {
  return TYPE_ORDER[t] ?? 9;
}

function toNum(s: string | undefined): number | undefined {
  if (s == null || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function cleanEmail(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.replace(/^mailto:\s*/i, '').trim().toLowerCase() || undefined;
}

function rowToComponent(row: TssSectionRow): Component {
  const parsed = parseSched(row.Sched);
  return {
    id: row.EventID,
    type: row.TeachingMethod as TeachingMethod,
    typeText: row.TeachingMethod_Text,
    sectionCode: row.EventAbbr,
    instructors: row.InstructorName ? [row.InstructorName] : [],
    instructorEmails: cleanEmail(row.InstructorEmail) ? [cleanEmail(row.InstructorEmail)!] : undefined,
    meetings: parsed.meetings,
    unscheduled: parsed.unscheduled,
    beginDate: row.BeginDate,
    endDate: row.EndDate,
    rawSched: row.Sched,
  };
}

/** Pick the package final from its lecture component(s). */
function packageFinal(components: Component[], rows: TssSectionRow[]): FinalExam | undefined {
  // Re-parse lecture rows for finals (component drops the final; keep parse here).
  for (const c of components) {
    if (c.type === 'LE') {
      const row = rows.find((r) => r.EventID === c.id);
      if (row) {
        const f = parseSched(row.Sched).final;
        if (f) return f;
      }
    }
  }
  // Fallback: any component with a final.
  for (const row of rows) {
    const f = parseSched(row.Sched).final;
    if (f) return f;
  }
  return undefined;
}

/** Short code from EventPkgText "CSE-008A (P-001-001)" → "P-001-001". */
function pkgCode(text: string | undefined, fallback: string): string {
  if (!text) return fallback;
  const m = text.match(/\(([^)]+)\)\s*$/);
  return m?.[1] ?? text;
}

export function normalizeSections(rows: TssSectionRow[], meta: CourseMeta): CourseOffering {
  if (rows.length === 0) {
    throw new Error('normalizeSections: no rows');
  }
  const first = rows[0]!; // rows.length checked above
  const term = termFromRow(first.AcYear, first.AcPeriod);

  // Group rows by EventPackage.
  const byPkg = new Map<string, TssSectionRow[]>();
  for (const row of rows) {
    const arr = byPkg.get(row.EventPkgOtjid);
    if (arr) arr.push(row);
    else byPkg.set(row.EventPkgOtjid, [row]);
  }

  const options: SectionOption[] = [];
  for (const [pkgId, pkgRows] of byPkg) {
    // Dedupe events within a package by EventID.
    const seen = new Set<string>();
    const components: Component[] = [];
    for (const row of pkgRows) {
      if (seen.has(row.EventID)) continue;
      seen.add(row.EventID);
      components.push(rowToComponent(row));
    }
    components.sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.sectionCode.localeCompare(b.sectionCode));

    const sample = pkgRows[0]!; // byPkg groups are never empty
    options.push({
      id: pkgId,
      code: pkgCode(sample.EventPkgText, pkgId),
      enrollCode: sample.EventPkgDisplayID ?? pkgId,
      limit: toNum(sample.EventPkgLimit),
      seatsAvailable: toNum(sample.EventPkgSeatsAvailable),
      waitlist: typeof sample.EventPkgNumOnWaitl === 'number' ? sample.EventPkgNumOnWaitl : undefined,
      status: sample.EventPkgStatusText || undefined,
      components,
      final: packageFinal(components, pkgRows),
    });
  }

  options.sort((a, b) => a.code.localeCompare(b.code));

  const [subject, number] = splitCourseCode(meta.courseCode);
  return {
    id: `${meta.courseCode}|${term.year}|${term.period}`,
    moduleId: first.ModuleID,
    subject,
    number,
    courseCode: meta.courseCode,
    title: meta.title,
    term,
    units: meta.units,
    academicLevel: meta.academicLevel,
    department: meta.department,
    options,
  };
}

export function splitCourseCode(code: string): [string, string] {
  const m = code.match(/^([A-Za-z]+)-?(\w+)$/);
  if (!m) return [code, ''];
  return [m[1]!, m[2]!];
}
