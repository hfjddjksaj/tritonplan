/**
 * Parse a TSS `Sched` string into structured meetings + an optional final exam.
 *
 * Grammar (see docs/tss-recon/tss-api-notes.md), either:
 *   "Schedule Not Defined"                                  → TBA/async, no placeable time
 * or one-or-more `\n`-separated lines, each either:
 *   meeting: `<Days> <Start> - <End> <Modality>[ @ <Location>]`
 *   final:   `Final Examination <MM/DD/YYYY> <Start> - <End> <Modality>`
 *
 * Robustness: modality is multi-word ("Live Online"), and `@ <Location>` is optional
 * (absent for online). We anchor on the time range regex rather than splitting by spaces.
 */

import type { Meeting, FinalExam, Weekday } from '@triton/shared';
import { parse12h } from '@triton/shared';

export const TBA_SCHED = 'Schedule Not Defined';

const DAY_MAP: Record<string, Weekday> = {
  M: 'Mon',
  Tu: 'Tue',
  W: 'Wed',
  Th: 'Thu',
  F: 'Fri',
  Sa: 'Sat',
  Su: 'Sun',
};

const TIME = '\\d{1,2}:\\d{2}\\s*[AP]M';
const TIME_RANGE = new RegExp(`(${TIME})\\s*-\\s*(${TIME})`, 'i');
const FINAL_RE = new RegExp(
  `^Final Examination\\s+(\\d{1,2})/(\\d{1,2})/(\\d{4})\\s+(${TIME})\\s*-\\s*(${TIME})\\s*(.*)$`,
  'i',
);

export interface ParsedSched {
  meetings: Meeting[];
  final?: FinalExam;
  unscheduled: boolean;   // true when the whole Sched is TBA/async
  unparsedLines: string[]; // any lines we couldn't interpret (kept for diagnostics)
}

function parseDays(daysPart: string): Weekday[] {
  return daysPart
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((tok) => DAY_MAP[tok])
    .filter((d): d is Weekday => Boolean(d));
}

/** Split a raw location like "Galbraith Hall Room 242" into building + room. */
function splitLocation(location: string): { building?: string; room?: string } {
  const idx = location.lastIndexOf(' Room ');
  if (idx === -1) return { building: location.trim() || undefined };
  return {
    building: location.slice(0, idx).trim() || undefined,
    room: location.slice(idx + ' Room '.length).trim() || undefined,
  };
}

function parseMeetingLine(line: string): Meeting | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Peel off "@ <Location>" (optional).
  let head = trimmed;
  let location: string | undefined;
  const atIdx = trimmed.indexOf(' @ ');
  if (atIdx !== -1) {
    head = trimmed.slice(0, atIdx).trim();
    location = trimmed.slice(atIdx + 3).trim();
  }

  const tm = head.match(TIME_RANGE);
  if (!tm) return null; // not a meeting line we understand

  const start = parse12h(tm[1]);
  const end = parse12h(tm[2]);
  if (!start || !end) return null;

  const daysPart = head.slice(0, tm.index).trim();
  const modality = head.slice((tm.index ?? 0) + tm[0].length).trim();
  const days = parseDays(daysPart);

  const loc = location ? splitLocation(location) : {};
  return {
    days,
    start,
    end,
    modality: modality || 'Unknown',
    building: loc.building,
    room: loc.room,
    location,
  };
}

function parseFinalLine(line: string): FinalExam | null {
  const m = line.trim().match(FINAL_RE);
  if (!m) return null;
  const [, mm, dd, yyyy, s, e, modality] = m;
  const start = parse12h(s);
  const end = parse12h(e);
  if (!start || !end) return null;
  const date = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  return { date, start, end, modality: modality?.trim() || undefined };
}

export function parseSched(sched: string | null | undefined): ParsedSched {
  const result: ParsedSched = { meetings: [], unscheduled: false, unparsedLines: [] };
  if (!sched || !sched.trim() || sched.trim() === TBA_SCHED) {
    result.unscheduled = true;
    return result;
  }

  for (const rawLine of sched.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^Final Examination/i.test(line)) {
      const f = parseFinalLine(line);
      if (f) result.final = f;
      else result.unparsedLines.push(line);
      continue;
    }
    const meeting = parseMeetingLine(line);
    if (meeting) result.meetings.push(meeting);
    else result.unparsedLines.push(line);
  }

  // A Sched that yielded neither meetings nor a final is effectively unscheduled.
  if (result.meetings.length === 0 && !result.final && result.unparsedLines.length === 0) {
    result.unscheduled = true;
  }
  return result;
}
