/**
 * Turn a raw captured OData response body (either a plain OData JSON collection OR a
 * multipart `$batch` body with embedded JSON) into typed collections, and classify
 * each as a module-list or a section-list by SHAPE (robust to context-string changes).
 * Grounded in real captured payloads — see docs/tss-recon/tss-api-notes.md.
 */

import type { TssModuleRow, TssSectionRow } from '../parser/tss-types.js';

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
      const obj = JSON.parse(body) as ODataCollection;
      if (obj && Array.isArray(obj.value)) return [obj];
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
      const obj = JSON.parse(body.slice(start, end + 1)) as ODataCollection;
      if (obj && Array.isArray(obj.value)) out.push(obj);
    } catch {
      /* skip malformed block */
    }
    idx = end + 1;
  }
  return out;
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

export interface ClassifiedCapture {
  moduleRows: TssModuleRow[];
  sectionRows: TssSectionRow[];
}

/** Classify all collections found in a body into module rows vs section rows. */
export function classifyCapture(body: string): ClassifiedCapture {
  const moduleRows: TssModuleRow[] = [];
  const sectionRows: TssSectionRow[] = [];
  for (const coll of extractODataCollections(body)) {
    const first = coll.value?.[0];
    if (looksLikeSectionRow(first)) sectionRows.push(...(coll.value as TssSectionRow[]));
    else if (looksLikeModuleRow(first)) moduleRows.push(...(coll.value as TssModuleRow[]));
  }
  return { moduleRows, sectionRows };
}
