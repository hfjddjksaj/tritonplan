/**
 * "Am I enrolled in this course?" — per-term booked status.
 *
 * Three id lists on TermWorkspace: `bookedAuto` (the extension's capture of the
 * TSS homepage "Booked Courses" feed, replaced wholesale per push), plus manual
 * overrides `bookedOn` / `bookedOff`. Verdict: (auto ∪ on) − off.
 *
 * PERSONAL data — never part of PlanState, share payloads, QR or JSON export.
 */
import type { TermWorkspace } from './terms-state';

export function bookedSet(ws: TermWorkspace): ReadonlySet<string> {
  const out = new Set(ws.bookedAuto ?? []);
  for (const id of ws.bookedOn ?? []) out.add(id);
  for (const id of ws.bookedOff ?? []) out.delete(id);
  return out;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Apply a fresh auto capture. Self-healing keeps overrides from rotting:
 * a manual mark the feed now confirms and a manual unmark the feed no longer
 * contradicts both dissolve — state converges back to pure auto, and a real
 * drop (course gone from the feed) clears the badge by itself.
 */
export function applyAutoBooked(ws: TermWorkspace, ids: readonly string[]): TermWorkspace {
  const auto = [...new Set(ids)];
  const autoSet = new Set(auto);
  const on = (ws.bookedOn ?? []).filter((id) => !autoSet.has(id));
  const off = (ws.bookedOff ?? []).filter((id) => autoSet.has(id));
  if (
    sameList(ws.bookedAuto ?? [], auto) &&
    sameList(ws.bookedOn ?? [], on) &&
    sameList(ws.bookedOff ?? [], off)
  ) {
    return ws;
  }
  return { ...ws, bookedAuto: auto, bookedOn: on, bookedOff: off };
}

/** Manual "mark booked" / "unmark" — the auto list itself is never edited by hand. */
export function toggleBooked(ws: TermWorkspace, courseId: string): TermWorkspace {
  const auto = ws.bookedAuto ?? [];
  const on = new Set(ws.bookedOn ?? []);
  const off = new Set(ws.bookedOff ?? []);
  if (bookedSet(ws).has(courseId)) {
    on.delete(courseId);
    if (auto.includes(courseId)) off.add(courseId);
  } else {
    off.delete(courseId);
    if (!auto.includes(courseId)) on.add(courseId);
  }
  return { ...ws, bookedOn: [...on], bookedOff: [...off] };
}
