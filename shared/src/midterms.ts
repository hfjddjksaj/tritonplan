/**
 * Midterm-exam extraction from TSS `Sched` strings.
 *
 * Grammar (docs/tss-recon/tss-api-notes.md, §Sched line 3, live-verified on
 * CHEM-043A 2026-07-24):
 *   `Midterm Examination <MM/DD/YYYY> <Start> - <End> <Modality>`
 * — the exact shape of a final-exam line. The extension's parser deliberately
 * rejects these from weekly-meeting parsing but keeps the raw text in
 * `Component.rawSched`, so the planner derives midterms at render time from
 * data users already have — no extension release or re-browse needed.
 */

import type { MidtermExam, SectionOption } from './types.js';
import { parse12h } from './time.js';

const TIME = '\\d{1,2}:\\d{2}\\s*[AP]M';
const MIDTERM_RE = new RegExp(
  `^Midterm Examination\\s+(\\d{1,2})/(\\d{1,2})/(\\d{4})\\s+(${TIME})\\s*-\\s*(${TIME})\\s*(.*)$`,
  'i',
);

/** Parse every midterm-exam line out of a `Sched` string (source order). */
export function midtermsFromSched(sched: string | null | undefined): MidtermExam[] {
  if (!sched) return [];
  const out: MidtermExam[] = [];
  for (const rawLine of sched.split('\n')) {
    const m = rawLine.trim().match(MIDTERM_RE);
    if (!m) continue;
    const [, mm = '', dd = '', yyyy = '', s = '', e = '', modality] = m;
    const start = parse12h(s);
    const end = parse12h(e);
    if (!start || !end) continue;
    const exam: MidtermExam = {
      date: `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`,
      start,
      end,
    };
    const mod = modality?.trim();
    if (mod) exam.modality = mod;
    out.push(exam);
  }
  return out;
}

/**
 * A section option's midterms: the explicit `midterms` field when present
 * (share-decoded data has no rawSched), else derived from every component's
 * rawSched — deduped across components (packages repeat the lecture row) and
 * sorted by date then start.
 */
export function optionMidterms(option: SectionOption): MidtermExam[] {
  if (option.midterms !== undefined) return option.midterms;
  const seen = new Set<string>();
  const out: MidtermExam[] = [];
  for (const comp of option.components) {
    for (const exam of midtermsFromSched(comp.rawSched)) {
      const key = `${exam.date}|${exam.start}|${exam.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(exam);
    }
  }
  out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return out;
}
