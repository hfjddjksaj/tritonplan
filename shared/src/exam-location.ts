/**
 * Exam-location display helpers.
 *
 * TSS added an optional `@ <Location>` tail to `Final Examination` /
 * `Midterm Examination` Sched lines (first seen live 2026-08-11 — see
 * docs/tss-recon/tss-api-notes.md). Older parser builds stored that whole tail
 * in `modality`, so the location survives INSIDE existing captured data and
 * share payloads. These helpers split it back out at render time — no
 * re-browse, re-capture, or extension update needed for display.
 */
import type { FinalExam } from './types.js';

export interface ExamLocation {
  modality?: string;
  location?: string;
  building?: string;
  room?: string;
}

/** Split a raw location like "York Hall Room 2622" into building + room. */
export function splitLocationText(location: string): { building?: string; room?: string } {
  const idx = location.lastIndexOf(' Room ');
  if (idx === -1) return { building: location.trim() || undefined };
  return {
    building: location.slice(0, idx).trim() || undefined,
    room: location.slice(idx + ' Room '.length).trim() || undefined,
  };
}

/** Split a stored modality tail ("In Person @ York Hall Room 2622") at " @ ".
 *  Also recognizes a tail that STARTS with "@ " (no modality, e.g. share-v3's
 *  wireExamModality emits "@ <location>" when an exam has a location but an
 *  empty/undefined modality) — that yields no modality, all location. */
export function splitModalityLocation(tail: string | undefined): ExamLocation {
  const t = tail?.trim();
  if (!t) return {};
  const out: ExamLocation = {};
  let locText: string;
  if (t.startsWith('@ ')) {
    locText = t.slice('@ '.length).trim();
  } else {
    const at = t.indexOf(' @ ');
    const head = at === -1 ? t : t.slice(0, at).trim();
    locText = at === -1 ? '' : t.slice(at + 3).trim();
    if (head) out.modality = head;
  }
  if (locText) {
    out.location = locText;
    const { building, room } = splitLocationText(locText);
    if (building) out.building = building;
    if (room) out.room = room;
  }
  return out;
}

/** Display fields for an exam: structured fields when the parser provided them,
 *  else derived by splitting the modality tail. */
export function examDisplay(
  exam: Pick<FinalExam, 'modality' | 'location' | 'building' | 'room'>,
): ExamLocation {
  if (!exam.location) return splitModalityLocation(exam.modality);
  const split = splitLocationText(exam.location);
  const out: ExamLocation = { location: exam.location };
  if (exam.modality) out.modality = exam.modality;
  const building = exam.building ?? split.building;
  const room = exam.room ?? split.room;
  if (building) out.building = building;
  if (room) out.room = room;
  return out;
}
