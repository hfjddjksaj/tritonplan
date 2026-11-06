import type { ApptTimes } from './types.js';

/** The term an appointment-times capture belongs to (same code space as `Term.year|period`). */
export function apptTermKey(a: ApptTimes): string {
  return `${a.academicYear}|${a.academicSession}`;
}

/**
 * Merge two lists of appointment times per term: for each term the capture
 * with the later `capturedAt` wins (ties keep `existing`). Sorted by term key.
 * Devices that each saw only some terms therefore never erase each other.
 */
export function mergeApptTimes(existing: readonly ApptTimes[], incoming: readonly ApptTimes[]): ApptTimes[] {
  const byKey = new Map<string, ApptTimes>();
  for (const a of existing) byKey.set(apptTermKey(a), a);
  for (const a of incoming) {
    const key = apptTermKey(a);
    const cur = byKey.get(key);
    if (!cur || a.capturedAt > cur.capturedAt) byKey.set(key, a);
  }
  return [...byKey.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, v]) => v);
}
