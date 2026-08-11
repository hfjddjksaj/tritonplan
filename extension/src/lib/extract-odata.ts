/**
 * Turn a raw captured OData response body (either a plain OData JSON collection OR a
 * multipart `$batch` body with embedded JSON) into typed collections, and classify
 * each as a module-list or a section-list by SHAPE (robust to context-string changes).
 * Grounded in real captured payloads — see docs/tss-recon/tss-api-notes.md.
 */

import type {
  TssModuleRow,
  TssPrereqRow,
  TssSectionRow,
  TssApptPeriodsRow,
  TssBookedModuleRow,
} from '../parser/tss-types.js';

interface ODataCollection {
  '@odata.context'?: string;
  value?: unknown[];
}

/** Extract every `{"@odata.context"...}` collection from a body (plain or $batch). */
export function extractODataCollections(body: string): ODataCollection[] {
  if (!body) return [];
  // Fast path: a plain OData JSON document.
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const coll = asCollection(JSON.parse(body));
      if (coll) return [coll];
    } catch {
      /* fall through to batch scan */
    }
  }
  // $batch / multipart: brace-match each embedded collection.
  const out: ODataCollection[] = [];
  let idx = 0;
  for (;;) {
    const start = body.indexOf('{"@odata.context"', idx);
    if (start === -1) break;
    const end = matchBrace(body, start);
    if (end === -1) break;
    try {
      const coll = asCollection(JSON.parse(body.slice(start, end + 1)));
      if (coll) out.push(coll);
    } catch {
      /* skip malformed block */
    }
    idx = end + 1;
  }
  return out;
}

/**
 * Normalize one parsed OData document into a collection, or null if it carries
 * no rows we understand.
 *
 * A collection response wraps its rows in `value`. A SINGLE-ENTITY response
 * (`@odata.context` ending in `/$entity`) puts one row's fields at the top level
 * with no `value` at all — that is what TSS returns when a course page is opened
 * by deep link, including from this planner's own "open in TSS" button. Dropping
 * those left a deep-linked course with sections but no title and no credits
 * (real report: PHYS-002CL, 2026-08-10).
 */
function asCollection(parsed: unknown): ODataCollection | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const doc = parsed as ODataCollection;
  if (Array.isArray(doc.value)) return doc;
  if (looksLikeModuleRow(doc) || looksLikeSectionRow(doc) || looksLikePrereqRow(doc)) {
    const ctx = doc['@odata.context'];
    return { ...(ctx !== undefined ? { '@odata.context': ctx } : {}), value: [doc] };
  }
  return null;
}

/** Index of the `}` matching the `{` at `start` (string/escape aware). */
function matchBrace(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function looksLikeSectionRow(v: unknown): v is TssSectionRow {
  return !!v && typeof v === 'object' && 'EventPkgOtjid' in v && 'Sched' in v;
}
function looksLikeModuleRow(v: unknown): v is TssModuleRow {
  return !!v && typeof v === 'object' && 'CourseAbbr' in v && 'ModuleID' in v && 'CourseTitle' in v;
}
function looksLikePrereqRow(v: unknown): v is TssPrereqRow {
  return !!v && typeof v === 'object' && 'id' in v && 'parent_id' in v && 'text' in v;
}

function looksLikeApptPeriodsRow(v: unknown): v is TssApptPeriodsRow {
  return (
    !!v && typeof v === 'object' &&
    'appointmentTimes' in v && 'academicYear' in v && 'academicSession' in v
  );
}

/** OData v2 wraps rows in {"d":{"results":[...]}} (the booked feed is v2).
 *  Returns null when the body isn't a real v2 document at all (not JSON, JSON
 *  but not `{`-rooted, or missing/malformed `d.results`) — as opposed to a
 *  genuine v2 document reporting zero rows (`d.results: []`), which returns
 *  `[]`. Callers need to tell these apart: the same service URL also serves a
 *  `$metadata` XML document and can serve error/HTML bodies, and those must
 *  never be read as "captured, zero rows". */
function extractV2Results(body: string): unknown[] | null {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(body) as { d?: { results?: unknown[] } };
    return Array.isArray(parsed.d?.results) ? parsed.d.results : null;
  } catch {
    return null;
  }
}

function looksLikeBookedRow(v: unknown): v is TssBookedModuleRow {
  return !!v && typeof v === 'object' && 'ModregId' in v && 'SmShort' in v && 'SmObjid' in v;
}

/** The requirements tree can be EMPTY (course without prereqs), so it's recognized
 *  by its @odata.context — which is also the only place the owning moduleid lives:
 *  `…$metadata#YUCSD_I_PREREQ_TREE(moduleid='2117',keydate=2026-09-21)/Set`. */
const PREREQ_CONTEXT_RE = /YUCSD_I_PREREQ_TREE\(moduleid='(\w+)'/i;

/** ysd_appttimes payload: `…$metadata#apptPeriods(appointmentTimes(),maxUnits())`.
 *  Like prereqs it's recognized by @odata.context; the row shape is checked too. */
const APPT_CONTEXT_RE = /#apptPeriods\(/i;

export interface PrereqTreeCapture {
  moduleId: string;
  rows: TssPrereqRow[];
}

export interface ClassifiedCapture {
  moduleRows: TssModuleRow[];
  sectionRows: TssSectionRow[];
  prereqTrees: PrereqTreeCapture[];
  apptPeriods: TssApptPeriodsRow[];
  bookedRows: TssBookedModuleRow[];
  /** True when the body was a genuine OData-v2 JSON document (`{"d":{"results":[...]}}`),
   *  including a real zero-row document. False for anything else (XML `$metadata`,
   *  malformed/truncated JSON, HTML error pages, ...) — callers must not treat those
   *  as "the feed reported zero rows". */
  isV2Doc: boolean;
}

/** Classify all collections found in a body into module / section / prereq-tree rows. */
export function classifyCapture(body: string): ClassifiedCapture {
  const moduleRows: TssModuleRow[] = [];
  const sectionRows: TssSectionRow[] = [];
  const prereqTrees: PrereqTreeCapture[] = [];
  const apptPeriods: TssApptPeriodsRow[] = [];
  const bookedRows: TssBookedModuleRow[] = [];
  for (const coll of extractODataCollections(body)) {
    const ctx = coll['@odata.context'];
    if (typeof ctx === 'string' && APPT_CONTEXT_RE.test(ctx)) {
      apptPeriods.push(...((coll.value ?? []).filter(looksLikeApptPeriodsRow)));
      continue;
    }
    const prereqMatch = typeof ctx === 'string' ? ctx.match(PREREQ_CONTEXT_RE) : null;
    if (prereqMatch) {
      prereqTrees.push({
        moduleId: prereqMatch[1]!,
        rows: (coll.value ?? []).filter(looksLikePrereqRow),
      });
      continue;
    }
    const first = coll.value?.[0];
    if (looksLikeSectionRow(first)) sectionRows.push(...(coll.value as TssSectionRow[]));
    else if (looksLikeModuleRow(first)) moduleRows.push(...(coll.value as TssModuleRow[]));
  }
  const v2Results = extractV2Results(body);
  const isV2Doc = v2Results !== null;
  bookedRows.push(...(v2Results ?? []).filter(looksLikeBookedRow));
  return { moduleRows, sectionRows, prereqTrees, apptPeriods, bookedRows, isV2Doc };
}
