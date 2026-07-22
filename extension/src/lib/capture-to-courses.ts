/**
 * Accumulates passively-captured OData (module-list rows + per-module section rows)
 * and produces normalized CourseOffering[] for the planner. Only ever reflects data
 * the student themselves browsed — nothing is fetched here.
 */

import type { CourseOffering } from '@triton/shared';
import type { TssModuleRow, TssSectionRow } from '../parser/tss-types.js';
import { normalizeSections, type CourseMeta } from '../parser/normalize.js';
import { classifyCapture } from './extract-odata.js';

interface StoreShape {
  modules: Record<string, TssModuleRow>;               // by ModuleID
  sections: Record<string, TssSectionRow[]>;           // by ModuleID
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

export class CaptureStore {
  private modules = new Map<string, TssModuleRow>();
  private sections = new Map<string, TssSectionRow[]>();

  /** Ingest one captured OData response body (plain or $batch). Returns true if anything new. */
  ingestBody(body: string): boolean {
    const { moduleRows, sectionRows } = classifyCapture(body);
    let changed = false;
    for (const m of moduleRows) {
      this.modules.set(m.ModuleID, m);
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
      for (const [moduleId, rows] of byModule) {
        this.sections.set(moduleId, rows); // latest capture wins (freshest seats/status)
        changed = true;
      }
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
        out.push(normalizeSections(rows, meta));
      } catch {
        /* skip a module we can't normalize */
      }
    }
    out.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
    return out;
  }

  serialize(): StoreShape {
    return {
      modules: Object.fromEntries(this.modules),
      sections: Object.fromEntries(this.sections),
    };
  }

  static deserialize(data: Partial<StoreShape> | undefined): CaptureStore {
    const store = new CaptureStore();
    if (data?.modules) for (const [k, v] of Object.entries(data.modules)) store.modules.set(k, v);
    if (data?.sections) for (const [k, v] of Object.entries(data.sections)) store.sections.set(k, v);
    return store;
  }
}
