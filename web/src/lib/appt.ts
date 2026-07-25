/** Pure logic for the student's enrollment-appointment windows: status by
 *  clock, which term/window the topbar capsule features, PT-anchored display.
 *  Comparisons use the UTC instants; display uses America/Los_Angeles (with an
 *  explicit "PT" label appended by callers) — matching how TSS shows them,
 *  regardless of the device's timezone. Status is computed from timestamps,
 *  never from TSS's timelimitStatus (only 'U' was ever observed). */
import type { ApptTimes, ApptWindow } from '@triton/shared';

export type ApptStatus = 'upcoming' | 'open' | 'ended';

/** Window status at `now` — [beginsAt, endsAt] inclusive is open. */
export function apptWindowStatus(w: ApptWindow, now: Date): ApptStatus {
  const t = now.getTime();
  if (t < Date.parse(w.beginsAt)) return 'upcoming';
  if (t <= Date.parse(w.endsAt)) return 'open';
  return 'ended';
}

/** The window the capsule features: the earliest not-yet-ended one (windows are
 *  begin-sorted, so an open window wins over a later upcoming one). */
export function nextRelevantWindow(appt: ApptTimes, now: Date): ApptWindow | null {
  for (const w of appt.windows) {
    if (apptWindowStatus(w, now) !== 'ended') return w;
  }
  return null;
}

/** Which captured term to show: the one whose next not-ended window begins
 *  soonest; if every term is over, the most recently captured all-ended term.
 *  A term with an empty `windows[]` never displays — spec treats it as
 *  no-data (stored, but the capsule stays hidden), not as "ended". */
export function pickDisplayTerm(list: ApptTimes[], now: Date): ApptTimes | null {
  let best: ApptTimes | null = null;
  let bestBegin = Infinity;
  for (const a of list) {
    const next = nextRelevantWindow(a, now);
    if (!next) continue;
    const begin = Date.parse(next.beginsAt);
    if (begin < bestBegin) {
      best = a;
      bestBegin = begin;
    }
  }
  if (best) return best;
  const ended = list.filter((a) => a.windows.length > 0);
  return [...ended].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0] ?? null;
}

const PT_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', month: 'numeric', day: 'numeric',
});
const PT_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit',
});

/** "8/10 2:00 PM" — Pacific wall clock; callers append the "PT" label. */
export function formatApptInstant(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${PT_DATE.format(d)} ${PT_TIME.format(d)}`;
}

/** The device's IANA timezone, or null when the environment can't say. */
export function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** The zone to show a secondary "your time" line in — null when the device is
 *  already on Pacific time (or unknown), so the line stays hidden. */
export function localZoneIfNotPacific(zone: string | null): string | null {
  return zone && zone !== 'America/Los_Angeles' ? zone : null;
}

/** "8/11 5:00 AM – 8/14 1:59 PM GMT+8" — a window's range on the given zone's
 *  wall clock, labeled with its GMT offset (DST handled by Intl). Empty string
 *  on an invalid zone or timestamps — callers skip rendering. */
export function formatApptRangeInZone(beginsAt: string, endsAt: string, zone: string): string {
  const b = Date.parse(beginsAt);
  const e = Date.parse(endsAt);
  if (!Number.isFinite(b) || !Number.isFinite(e)) return '';
  try {
    const date = new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'numeric', day: 'numeric' });
    const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
    const label = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date(b))
      .find((p) => p.type === 'timeZoneName')?.value;
    const bd = new Date(b);
    const ed = new Date(e);
    const range = `${date.format(bd)} ${time.format(bd)} – ${date.format(ed)} ${time.format(ed)}`;
    return label ? `${range} ${label}` : range;
  } catch {
    return ''; // invalid IANA zone
  }
}
