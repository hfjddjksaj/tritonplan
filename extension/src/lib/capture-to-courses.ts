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
  enrolled?: Record<string, string[]>;                 // moduleId → TSS EventIDs the student is in
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

/** The booked feed's one entity set, as it appears in a plain GET's URL. */
const URL_NAMES_SET = /ModuleSet/;

/** Is the WHOLE body one OData v2 document, rather than a document found inside a
 *  multipart $batch? Only the whole-body shape is trusted to report zero bookings. */
function isWholeV2Body(body: string): boolean {
  return body.trimStart().startsWith('{');
}

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
   * Which EVENTS the student is enrolled in, by module — "E 00001078" style ids, the
   * same space as `Component.id`. From the timetable feed, which the home page loads
   * beside the booked feed. This is the only thing TSS gives us that names a SECTION:
   * the booked feed itself is module-level and could never answer "is my plan on the
   * section I actually booked?".
   */
  private enrolled = new Map<string, string[]>();

  /**
   * Ingest one captured OData response body (plain or $batch). Returns true if anything
   * new. The optional source URL disambiguates section captures: a paged continuation
   * merges into the rows already held (so page 2 doesn't wipe page 1), while a fresh
   * browse replaces them (freshest seats/status win).
   */
  ingestBody(body: string, url?: string): boolean {
    const { moduleRows, sectionRows, prereqTrees, apptPeriods, bookedRows, timetableRows, isV2Doc } =
      classifyCapture(body);
    let changed = false;
    if (timetableRows.length) {
      // The feed carries every dated occurrence of every event, across terms, in one
      // response — so one capture is the whole truth and replaces what we held. Rows
      // for a module the student dropped simply stop appearing.
      const byModule = new Map<string, Set<string>>();
      for (const row of timetableRows) {
        if (row.EventIsExam) continue; // exams are their own events, never in a package
        // Ids stay VERBATIM as TSS wrote them ("00001078"). The planner matches them
        // against its own "E 00001078" by digits, so neither side has to guess at a
        // prefix convention it only ever saw on one campus.
        const moduleId = (row.ModuleId ?? '').replace(/^0+(?=.)/, '');
        const eventId = (row.EventId ?? '').trim();
        if (!moduleId || !eventId) continue;
        const set = byModule.get(moduleId);
        if (set) set.add(eventId);
        else byModule.set(moduleId, new Set([eventId]));
      }
      if (byModule.size) {
        this.enrolled = new Map([...byModule].map(([k, v]) => [k, [...v].sort()]));
        changed = true;
      }
    }
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
    // Rows always replace the list. A report of ZERO rows is the dangerous case: it is
    // real news when a student has dropped everything, and it destroys good data when
    // we read it out of something that wasn't the booked list at all.
    //
    // So an empty report only counts in the exact shape verified live on 2026-08-11: a
    // whole-body OData v2 document, fetched from a URL naming this service's ModuleSet.
    // Anything else — a $batch body, another entity set riding the same endpoint, a
    // $metadata XML doc, an HTML error page — leaves the list alone. Reading v2 out of
    // batches (added 2026-08-19) made those bodies eligible to clear, and a student's
    // captured bookings went to zero; batched captures now only ever ADD.
    const clearsOnEmpty =
      isV2Doc &&
      isWholeV2Body(body) &&
      (url?.includes('BC_OVP_BOOKED_MODULES_SRV') ?? false) &&
      URL_NAMES_SET.test(url ?? '');
    const understood = bookedRows
      .map(bookedRowToModule)
      .filter((m): m is BookedModule => m !== null);
    // Rows we could not read are not bookings we do not have. Writing them out as an
    // empty list — stamped with a fresh time, so the planner reports it with full
    // confidence — turns "this build didn't understand the payload" into "TSS says you
    // are enrolled in nothing". Only an understood row, or an authoritative report that
    // genuinely carried no rows at all, may write here; anything else leaves the last
    // real answer (or "never captured") standing.
    if (understood.length > 0 || (bookedRows.length === 0 && clearsOnEmpty)) {
      this.booked = understood;
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
    if (this.booked === null) return null;
    // The two feeds are captured separately and can arrive in either order, so they
    // are joined here rather than at ingest. A module with no timetable rows keeps
    // `eventIds` ABSENT — "we don't know which section", never "no sections".
    return this.booked.map((m) => {
      const eventIds = this.enrolled.get(m.moduleId);
      return eventIds && eventIds.length ? { ...m, eventIds } : m;
    });
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
      ...(this.enrolled.size ? { enrolled: Object.fromEntries(this.enrolled) } : {}),
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
    fillMap(store.enrolled, shape.enrolled);
    // A stored EMPTY list is dropped rather than loaded, so it reads as "never
    // captured" instead of "TSS says you have none". Stores written before the clear
    // rule was narrowed can hold an empty list that no student ever earned, and that
    // one is indistinguishable from an honest zero. Nothing is lost by re-reading:
    // the next home-page load reports zero again in a single step, and meanwhile the
    // planner asks to be checked instead of stating something it can't stand behind.
    if (Array.isArray(shape.booked) && shape.booked.length > 0) store.booked = shape.booked;
    if (store.booked !== null && typeof shape.bookedAt === 'string') {
      store.bookedAt = shape.bookedAt;
    }
    return store;
  }
}
