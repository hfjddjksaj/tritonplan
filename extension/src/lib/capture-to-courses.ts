/**
 * Accumulates passively-captured OData (module-list rows + per-module section rows)
 * and produces normalized CourseOffering[] for the planner. Only ever reflects data
 * the student themselves browsed — nothing is fetched here.
 */

import type { ApptTimes, BookedModule, CourseOffering } from '@triton/shared';
import type { TssModuleRow, TssPrereqRow, TssSectionRow } from '../parser/tss-types.js';
import { apptPeriodsToApptTimes, bookedRowToModule, normalizeSections, prereqTreeToGroups, type CourseMeta } from '../parser/normalize.js';
import { classifyCapture } from './extract-odata.js';

interface StoreShape {
  modules: Record<string, TssModuleRow>;               // by ModuleID
  sections: Record<string, TssSectionRow[]>;           // by ModuleID
  capturedAt?: Record<string, string>;                 // by ModuleID; absent in old stores
  prereqs?: Record<string, TssPrereqRow[]>;            // by ModuleID; absent in old stores
  apptTimes?: Record<string, ApptTimes>;               // by "<year>|<session>"; absent in old stores
  booked?: BookedModule[];                             // homepage feed; absent in old stores
  bookedAt?: string;                                   // ISO time of that capture; absent in old stores
}

function creditsToUnits(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/** courseCode fallback from a section row's EventPkgText "CSE-008A (P-001-001)" → "CSE-008A". */
function courseCodeFromSections(rows: TssSectionRow[]): string | undefined {
  for (const r of rows) {
    const m = r.EventPkgText?.match(/^([A-Za-z]+-?\w+)\s*\(/);
    if (m) return m[1];
  }
  return undefined;
}

/** True when the captured URL is a paged continuation (`$skip=N`, N>0) whose first
 * page the store may already hold — TSS serves `_sections` 30-ish rows at a time. */
function isPagedContinuation(url: string | undefined): boolean {
  if (!url) return false;
  const m = url.match(/(?:\$|%24)skip=(\d+)/i);
  return !!m && Number(m[1]) > 0;
}

function sectionRowKey(r: TssSectionRow): string {
  return `${r.EventPkgOtjid}|${r.EventID}`;
}

/** Load a serialized record back into its Map (no-op for absent sections of old stores). */
function fillMap<V>(map: Map<string, V>, record: Record<string, V> | undefined): void {
  if (!record) return;
  for (const [k, v] of Object.entries(record)) map.set(k, v);
}

/** The booked feed's one entity set. Named in the URL on a plain GET, and in the
 *  embedded request line when the launchpad batches the read. */
const URL_NAMES_SET = /ModuleSet/;
const BODY_NAMES_SET = /ModuleSet/;

export class CaptureStore {
  private modules = new Map<string, TssModuleRow>();
  private sections = new Map<string, TssSectionRow[]>();
  /** When each module's section rows (seat counts!) were last captured. */
  private capturedAt = new Map<string, string>();
  /** Raw YUCSD_I_PREREQ_TREE rows by ModuleID ([] = confirmed no requirements). */
  private prereqs = new Map<string, TssPrereqRow[]>();
  /** Student's enrollment windows by term — normalized (PII already stripped). */
  private apptTimes = new Map<string, ApptTimes>();
  /** Student's booked modules (homepage feed). null = never captured; [] = captured,
   *  zero bookings. PERSONAL — never merged into course data. */
  private booked: BookedModule[] | null = null;
  /** ISO time the booked list above was last reported. null whenever booked is null. */
  private bookedAt: string | null = null;

  /**
   * Ingest one captured OData response body (plain or $batch). Returns true if anything
   * new. The optional source URL disambiguates section captures: a paged continuation
   * merges into the rows already held (so page 2 doesn't wipe page 1), while a fresh
   * browse replaces them (freshest seats/status win).
   */
  ingestBody(body: string, url?: string): boolean {
    const { moduleRows, sectionRows, prereqTrees, apptPeriods, bookedRows, isV2Doc } = classifyCapture(body);
    let changed = false;
    for (const m of moduleRows) {
      this.modules.set(m.ModuleID, m);
      changed = true;
    }
    for (const tree of prereqTrees) {
      this.prereqs.set(tree.moduleId, tree.rows); // latest browse wins, empty set included
      changed = true;
    }
    for (const row of apptPeriods) {
      const appt = apptPeriodsToApptTimes(row, new Date().toISOString());
      if (!appt) continue;
      // latest capture of a term wins (the student re-opened the TSS tile)
      this.apptTimes.set(`${appt.academicYear}|${appt.academicSession}`, appt);
      changed = true;
    }
    if (sectionRows.length) {
      // Group incoming section rows by ModuleID (a response is for one module, but be safe).
      const byModule = new Map<string, TssSectionRow[]>();
      for (const r of sectionRows) {
        const arr = byModule.get(r.ModuleID);
        if (arr) arr.push(r);
        else byModule.set(r.ModuleID, [r]);
      }
      const paged = isPagedContinuation(url);
      for (const [moduleId, rows] of byModule) {
        const existing = paged ? this.sections.get(moduleId) : undefined;
        if (existing) {
          const merged = new Map<string, TssSectionRow>();
          for (const r of existing) merged.set(sectionRowKey(r), r);
          for (const r of rows) merged.set(sectionRowKey(r), r); // incoming wins
          this.sections.set(moduleId, [...merged.values()]);
        } else {
          this.sections.set(moduleId, rows); // latest capture wins (freshest seats/status)
        }
        this.capturedAt.set(moduleId, new Date().toISOString());
        changed = true;
      }
    }
    // An empty v2 body from the booked feed itself CLEARS (zero bookings is real news);
    // an empty body from any other feed must not touch a list it has nothing to do with.
    // The same feed URL also serves a $metadata XML doc (and can serve error/HTML
    // bodies) — only a REAL v2 JSON document (isV2Doc) counts as "the feed reported
    // its list", even when that report is zero rows.
    //
    // Naming the service is NOT enough on its own. Since v2 documents began being read
    // out of $batch bodies too, any other v2 payload riding that service's endpoint
    // would satisfy "the feed reported" and wipe a good list to empty. So the capture
    // must also be about ModuleSet — named in the URL for a plain GET, or in the
    // embedded request line of a batch. Anything less keeps what we already had.
    const namesFeed = url?.includes('BC_OVP_BOOKED_MODULES_SRV') ?? false;
        const reportsModuleSet =
      namesFeed && (URL_NAMES_SET.test(url ?? '') || BODY_NAMES_SET.test(body));
    if (bookedRows.length || (reportsModuleSet && isV2Doc)) {
      this.booked = bookedRows
        .map(bookedRowToModule)
        .filter((m): m is BookedModule => m !== null);
      this.bookedAt = new Date().toISOString();
      changed = true;
    }
    return changed;
  }

  /**
   * Permanently drop everything captured for the given modules (the student removed
   * them from the planner's browsed list). Re-browsing the course in TSS captures it
   * afresh. Term-level apptTimes are untouched — they aren't course data. `booked` is
   * also deliberately untouched — it reflects TSS enrollment, not browsed data. Returns
   * true if anything was actually removed.
   */
  forgetModules(moduleIds: string[]): boolean {
    let changed = false;
    for (const id of moduleIds) {
      changed = this.modules.delete(id) || changed;
      changed = this.sections.delete(id) || changed;
      changed = this.capturedAt.delete(id) || changed;
      changed = this.prereqs.delete(id) || changed;
    }
    return changed;
  }

  private metaFor(moduleId: string, rows: TssSectionRow[]): CourseMeta | null {
    const mod = this.modules.get(moduleId);
    if (mod) {
      return {
        courseCode: mod.CourseAbbr,
        title: mod.CourseTitle,
        units: creditsToUnits(mod.CreditsDisplay),
        academicLevel: mod.AcademicLevel,
        department: mod.DepartmentText,
      };
    }
    const code = courseCodeFromSections(rows);
    if (code) return { courseCode: code, title: code };
    return null;
  }

  /** Build CourseOffering[] for every module we have sections for. */
  toCourses(): CourseOffering[] {
    const out: CourseOffering[] = [];
    for (const [moduleId, rows] of this.sections) {
      if (!rows.length) continue;
      const meta = this.metaFor(moduleId, rows);
      if (!meta) continue;
      try {
        let course = normalizeSections(rows, meta);
        const at = this.capturedAt.get(moduleId);
        if (at !== undefined) course = { ...course, capturedAt: at };
        const prereqRows = this.prereqs.get(moduleId);
        if (prereqRows !== undefined) {
          course = { ...course, prereqs: prereqTreeToGroups(prereqRows) };
        }
        out.push(course);
      } catch {
        /* skip a module we can't normalize */
      }
    }
    out.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
    return out;
  }

  /** The student's captured appointment times, one per term, term-sorted. */
  getApptTimes(): ApptTimes[] {
    return [...this.apptTimes.values()].sort(
      (a, b) =>
        a.academicYear.localeCompare(b.academicYear) ||
        a.academicSession.localeCompare(b.academicSession),
    );
  }

  /** The student's booked modules. null = homepage never captured; [] = captured, zero bookings. */
  getBooked(): BookedModule[] | null {
    return this.booked;
  }

  /** When that list was last reported by TSS. null whenever getBooked() is null. */
  getBookedAt(): string | null {
    return this.bookedAt;
  }

  serialize(): StoreShape {
    return {
      modules: Object.fromEntries(this.modules),
      sections: Object.fromEntries(this.sections),
      capturedAt: Object.fromEntries(this.capturedAt),
      prereqs: Object.fromEntries(this.prereqs),
      apptTimes: Object.fromEntries(this.apptTimes),
      ...(this.booked !== null ? { booked: this.booked } : {}),
      ...(this.bookedAt !== null ? { bookedAt: this.bookedAt } : {}),
    };
  }

  static deserialize(data: unknown): CaptureStore {
    const store = new CaptureStore();
    const shape = (data ?? {}) as Partial<StoreShape>;
    fillMap(store.modules, shape.modules);
    fillMap(store.sections, shape.sections);
    fillMap(store.capturedAt, shape.capturedAt);
    fillMap(store.prereqs, shape.prereqs);
    fillMap(store.apptTimes, shape.apptTimes);
    if (Array.isArray(shape.booked)) store.booked = shape.booked;
    if (typeof shape.bookedAt === 'string') store.bookedAt = shape.bookedAt;
    return store;
  }
}
