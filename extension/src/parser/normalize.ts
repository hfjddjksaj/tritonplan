/**
 * Turn the DENORMALIZED TSS `_sections` rows (one row per Event×EventPackage) for a
 * single module into our normalized CourseOffering:
 *   group rows by EventPackage → each package is a bookable SectionOption whose
 *   member Events (deduped by EventID) become Components; each Event's `Sched`
 *   is parsed into meetings + an optional final. The package's final is taken from
 *   its lecture component.
 */

import type {
  ApptTimes,
  ApptWindow,
  BookedModule,
  Component,
  CourseOffering,
  FinalExam,
  PrereqGroup,
  SectionOption,
  TeachingMethod,
  Term,
} from '@triton/shared';
import type {
  TssApptPeriodsRow,
  TssBookedModuleRow,
  TssMyModuleRow,
  TssPrereqRow,
  TssSectionRow,
} from './tss-types.js';
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

/** Live feeds send counts as JSON numbers, older captures as strings — accept both. */
function toNum(s: string | number | undefined): number | undefined {
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
  const email = cleanEmail(row.InstructorEmail);
  return {
    id: row.EventID,
    type: row.TeachingMethod as TeachingMethod,
    typeText: row.TeachingMethod_Text,
    sectionCode: row.EventAbbr,
    instructors: row.InstructorName ? [row.InstructorName] : [],
    instructorEmails: email ? [email] : undefined,
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
    if (c.type !== 'LE') continue;
    const row = rows.find((r) => r.EventID === c.id);
    if (!row) continue;
    const f = parseSched(row.Sched).final;
    if (f) return f;
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

/**
 * Flatten a YUCSD_I_PREREQ_TREE row set into display groups: each root
 * (`parent_id: ""`) is one AND-ed group whose descendants (any depth, document
 * order) are its OR options. Defensive: an orphan row (parent not in the set)
 * becomes its own childless group rather than vanishing.
 */
export function prereqTreeToGroups(rows: TssPrereqRow[]): PrereqGroup[] {
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<string, TssPrereqRow[]>();
  const roots: TssPrereqRow[] = [];
  for (const row of rows) {
    if (row.parent_id && ids.has(row.parent_id)) {
      const arr = children.get(row.parent_id);
      if (arr) arr.push(row);
      else children.set(row.parent_id, [row]);
    } else {
      roots.push(row);
    }
  }
  return roots.map((root) => {
    const options: string[] = [];
    const walk = (id: string) => {
      for (const child of children.get(id) ?? []) {
        options.push(child.text);
        walk(child.id);
      }
    };
    walk(root.id);
    return { label: root.text, options };
  });
}

export function splitCourseCode(code: string): [string, string] {
  const m = code.match(/^([A-Za-z]+)-?(\w+)$/);
  if (!m) return [code, ''];
  return [m[1]!, m[2]!];
}

/** Map a captured ysd_appttimes `apptPeriods` row to the shared ApptTimes shape.
 *  WHITELIST mapping: only the fields below survive — the wire row also carries
 *  student PII (studentNumber etc.) which must never reach storage or the page.
 *  Returns null when the row is structurally unusable. */
export function apptPeriodsToApptTimes(
  row: TssApptPeriodsRow,
  capturedAt: string,
): ApptTimes | null {
  if (!row || typeof row.academicYear !== 'string' || typeof row.academicSession !== 'string') {
    return null;
  }
  const src = Array.isArray(row.appointmentTimes) ? row.appointmentTimes : [];
  const caps = Array.isArray(row.maxUnits) ? row.maxUnits : [];
  const windows: ApptWindow[] = [];
  for (const at of src) {
    if (typeof at.beginTimestamp !== 'string' || typeof at.endTimestamp !== 'string') continue;
    const cap = caps.find(
      (mu) => mu.Perid === row.academicSession && mu.Timelimit === at.timelimit,
    );
    const w: ApptWindow = {
      label: at.timelimit_Text || 'Enrollment window',
      beginsAt: at.beginTimestamp,
      endsAt: at.endTimestamp,
    };
    if (cap?.MaxUnits) w.unitCap = cap.MaxUnits;
    if (at.waitlists) w.waitlists = at.waitlists;
    windows.push(w);
  }
  windows.sort((a, b) => Date.parse(a.beginsAt) - Date.parse(b.beginsAt));
  const first = src[0];
  return {
    academicYear: row.academicYear,
    academicSession: row.academicSession,
    yearText: first?.academicYear_Text || row.academicYear,
    sessionText: first?.academicSession_Text || `Period ${row.academicSession}`,
    windows,
    capturedAt,
  };
}

const stripLeadingZeros = (s: string): string => s.replace(/^0+(?=.)/, '');

/** Homepage booked row → BookedModule. moduleId/period are zero-padded in this
 *  feed ("00002077"/"002") but must match course-capture keys ("2077"/"2"). */
/**
 * A "My Courses" row → the same BookedModule, plus the package it was booked on.
 *
 * This one feed says what the home page needs two feeds and a deduction to say.
 *
 * Two kinds of row are read, and only two. An enrolment is `SmStatus === '01'`
 * ("Booked"). A waitlist booking is whatever row says so in a field whose meaning is
 * not in doubt — `WaitlistBooking`, or the display text. Everything else (a withdrawal,
 * say) is still refused.
 *
 * Both halves are now confirmed against a real waitlisted student (2026-08-21, two
 * queued courses beside three booked ones):
 *
 * | field              | waitlisted        | booked        |
 * |--------------------|-------------------|---------------|
 * | `SmStatus`         | `'00'`            | `'01'`        |
 * | `SmStatusText`     | `'Waitlisted'`    | `'Booked'`    |
 * | `WaitlistBooking`  | `true`            | `false`       |
 * | `WaitlistPosition` | `2` / `11`        | `0`           |
 * | `SemanticState`    | `'Warning'`       | `'Information'` |
 *
 * The rule still does NOT read `SmStatus === '00'`, now that the code is known: `'00'`
 * has only ever been seen on rows that also said `WaitlistBooking: true`, so it adds no
 * case, while the statuses nobody has captured (a withdrawal, a pending request) would
 * be free to collide with it. The semantic fields say what they mean; the code does not.
 */
export function myModuleRowToBooked(
  row: TssMyModuleRow,
): { module: BookedModule; optionCode: string } | null {
  const waitlisted = row.WaitlistBooking === true || /wait\s*list/i.test(row.SmStatusText ?? '');
  if (!waitlisted && row.SmStatus !== undefined && row.SmStatus !== '01') return null;
  const courseCode = row.SmShort?.trim();
  const moduleId = stripLeadingZeros(row.SmObjid ?? '');
  const year = row.AcademicYear?.trim();
  const period = stripLeadingZeros(row.AcademicSession ?? '');
  if (!courseCode || !moduleId || !year || !period) return null;
  // A position of 0 is TSS's empty value, not first in line: every BOOKED row carries 0,
  // and the queued rows carried 2 and 11 (2026-08-21). Whether a real queue starts at 1
  // can only be settled by a student who is actually first, so 0 stays unprintable.
  const position = row.WaitlistPosition;
  const hasPosition = waitlisted && typeof position === 'number' && position > 0;
  return {
    module: {
      courseCode,
      moduleId,
      term: termFromRow(year, period),
      ...(waitlisted ? { waitlisted: true } : {}),
      ...(hasPosition ? { waitlistPosition: position } : {}),
    },
    optionCode: row.EventPackageAbbr?.trim() ?? '',
  };
}

export function bookedRowToModule(row: TssBookedModuleRow): BookedModule | null {
  const courseCode = row.SmShort?.trim();
  const moduleId = stripLeadingZeros(row.SmObjid ?? '');
  const year = row.AcademicYear?.trim();
  const period = stripLeadingZeros(row.AcademicSession ?? '');
  if (!courseCode || !moduleId || !year || !period) return null;
  return { courseCode, moduleId, term: termFromRow(year, period) };
}
