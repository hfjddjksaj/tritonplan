/**
 * Test helper: load the captured NORMALIZED recon fixtures and rebuild the
 * DENORMALIZED `_sections` rows (one row per Event×Package) that the real TSS
 * OData returns — so the parser is exercised against real captured data.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { TssSectionRow } from './tss-types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = resolve(here, '../../../docs/tss-recon/fixtures');

interface NormEvent {
  EventID: string; EventKey: string; EventAbbr: string;
  TeachingMethod: string; TeachingMethod_Text: string;
  InstructorName: string; InstructorEmail: string;
  Status: string; Limit: string; LocationText: string;
  BeginDate: string; EndDate: string; Sched: string;
}
interface NormPkg {
  pkg: string; text: string; displayId: string;
  limit: string; seatsAvailable: string; waitl: number; statusText: string;
  events: string[];
}
interface NormCourse {
  moduleId: string; acYear: string; acPeriod: string;
  events: NormEvent[]; packages: NormPkg[];
}

export function loadNormalizedFixture(): Record<string, NormCourse> {
  const raw = JSON.parse(readFileSync(resolve(FIX_DIR, 'cse-sections-normalized.json'), 'utf8'));
  delete raw._comment;
  return raw;
}

/** Rebuild the denormalized `_sections` rows for one fixture course. */
export function denormalize(course: NormCourse): TssSectionRow[] {
  const byId = new Map(course.events.map((e) => [e.EventID, e]));
  const rows: TssSectionRow[] = [];
  for (const pkg of course.packages) {
    for (const eid of pkg.events) {
      const e = byId.get(eid);
      if (!e) continue;
      rows.push({
        AcYear: course.acYear,
        AcPeriod: course.acPeriod,
        ModuleID: course.moduleId,
        EventID: e.EventID,
        EventKey: e.EventKey,
        EventAbbr: e.EventAbbr,
        TeachingMethod: e.TeachingMethod,
        TeachingMethod_Text: e.TeachingMethod_Text,
        InstructorName: e.InstructorName,
        InstructorEmail: e.InstructorEmail,
        LocationText: e.LocationText,
        Status: e.Status,
        Limit: e.Limit,
        BeginDate: e.BeginDate,
        EndDate: e.EndDate,
        Sched: e.Sched,
        EventPkgOtjid: pkg.pkg,
        EventPkgDisplayID: pkg.displayId,
        EventPkgText: pkg.text,
        EventPkgLimit: pkg.limit,
        EventPkgSeatsAvailable: pkg.seatsAvailable,
        EventPkgNumOnWaitl: pkg.waitl,
        EventPkgStatusText: pkg.statusText,
      });
    }
  }
  return rows;
}
