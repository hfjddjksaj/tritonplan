/**
 * Calendar geometry — pure functions mapping meeting times to grid positions and
 * resolving side-by-side lanes for overlapping meetings on the same day.
 * All conflict/time semantics come from @triton/shared; this file only does layout.
 */
import { type Weekday, WEEKDAYS, toMinutes, rangesOverlap } from '@triton/shared';

export interface GridConfig {
  /** first hour shown, e.g. 7 => 07:00 */
  startHour: number;
  /** last hour shown (exclusive-ish label), e.g. 22 => 22:00 */
  endHour: number;
  /** vertical pixels per minute */
  pxPerMinute: number;
}

/** 8:00–22:00 — UCSD schedules no classes before 8 AM or past 10 PM.
 * 1.3 px/min ⇒ a standard 50-min class is ~65px tall, enough for its full details. */
export const DEFAULT_GRID: GridConfig = { startHour: 8, endHour: 22, pxPerMinute: 1.3 };

/** A meeting flattened together with the course + component it belongs to. */
export interface MeetingInstance {
  courseId: string;
  courseCode: string;
  /** "Lecture" | "Discussion" | "Laboratory" ... */
  typeText: string;
  hue: number;
  instructor?: string;
  /** Combined display text, e.g. "Galbraith Hall 242". */
  location?: string;
  /** Raw building name (possibly TSS-truncated) — drives the building popover. */
  building?: string;
  room?: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  day: Weekday;
}

/** A positioned block ready to render. top/height are pixels from the grid top. */
export interface PositionedBlock extends MeetingInstance {
  key: string;
  top: number;
  height: number;
  /** column index within an overlapping cluster */
  lane: number;
  /** total columns in this block's cluster */
  laneCount: number;
  conflict: boolean;
}

export function gridStartMinutes(cfg: GridConfig): number {
  return cfg.startHour * 60;
}

export function gridTotalMinutes(cfg: GridConfig): number {
  return (cfg.endHour - cfg.startHour) * 60;
}

export function gridHeightPx(cfg: GridConfig): number {
  return gridTotalMinutes(cfg) * cfg.pxPerMinute;
}

/** Vertical geometry for a single [start,end) time on the grid, clamped to the visible window. */
export function blockGeometry(
  start: string,
  end: string,
  cfg: GridConfig,
): { top: number; height: number } {
  const startMin = gridStartMinutes(cfg);
  const totalMin = gridTotalMinutes(cfg);
  const s = Math.max(0, toMinutes(start) - startMin);
  const e = Math.min(totalMin, toMinutes(end) - startMin);
  const top = s * cfg.pxPerMinute;
  const height = Math.max(0, e - s) * cfg.pxPerMinute;
  return { top, height };
}

/** Hour marks (integers) inside the visible window, inclusive of the last hour. */
export function hourMarks(cfg: GridConfig): number[] {
  const out: number[] = [];
  for (let h = cfg.startHour; h <= cfg.endHour; h++) out.push(h);
  return out;
}

/** Y-pixel of the top of hour `h`'s line/label on the grid. */
export function hourMarkTop(h: number, cfg: GridConfig): number {
  return (h - cfg.startHour) * 60 * cfg.pxPerMinute;
}

/**
 * Assign lane (column) + laneCount to a day's meetings so that overlapping
 * meetings sit side by side. Classic interval-partitioning within each maximal
 * cluster of transitively-overlapping meetings.
 */
export function assignLanes<T extends { start: string; end: string }>(
  meetings: T[],
): Array<T & { lane: number; laneCount: number }> {
  const sorted = [...meetings].sort((a, b) => {
    const d = toMinutes(a.start) - toMinutes(b.start);
    return d !== 0 ? d : toMinutes(a.end) - toMinutes(b.end);
  });

  const result: Array<T & { lane: number; laneCount: number }> = [];
  let cluster: Array<T & { lane: number }> = [];
  let clusterMaxEnd = -1;
  let laneEnds: number[] = []; // last end-minute per open lane in the cluster

  const flush = () => {
    const laneCount = laneEnds.length;
    for (const m of cluster) result.push({ ...m, laneCount });
    cluster = [];
    laneEnds = [];
    clusterMaxEnd = -1;
  };

  for (const m of sorted) {
    const s = toMinutes(m.start);
    const e = toMinutes(m.end);
    // A new cluster starts when this meeting begins at/after everything so far ended.
    if (cluster.length > 0 && s >= clusterMaxEnd) flush();

    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else {
      laneEnds[lane] = e;
    }
    cluster.push({ ...m, lane });
    clusterMaxEnd = Math.max(clusterMaxEnd, e);
  }
  if (cluster.length > 0) flush();
  return result;
}

/** True if two placed items from different courses overlap in time (same day/date assumed). */
function overlapsDifferentCourse(
  a: { courseId: string; start: string; end: string },
  b: { courseId: string; start: string; end: string },
): boolean {
  if (a.courseId === b.courseId) return false;
  return rangesOverlap(
    toMinutes(a.start),
    toMinutes(a.end),
    toMinutes(b.start),
    toMinutes(b.end),
  );
}

/**
 * Build positioned blocks for every visible weekday.
 * Returns a map day -> blocks and the set of weekdays that actually carry meetings
 * (so the grid can hide empty weekend columns).
 */
export function layoutWeek(
  instances: MeetingInstance[],
  cfg: GridConfig,
): { byDay: Record<Weekday, PositionedBlock[]>; usedDays: Set<Weekday> } {
  const byDay = {} as Record<Weekday, PositionedBlock[]>;
  const usedDays = new Set<Weekday>();
  for (const day of WEEKDAYS) byDay[day] = [];

  for (const inst of instances) {
    byDay[inst.day].push(inst as PositionedBlock);
    usedDays.add(inst.day);
  }

  for (const day of WEEKDAYS) {
    const dayInstances = byDay[day];
    if (dayInstances.length === 0) continue;

    const laned = assignLanes(dayInstances);
    byDay[day] = laned.map((m) => {
      const { top, height } = blockGeometry(m.start, m.end, cfg);
      const conflict = dayInstances.some((other) => overlapsDifferentCourse(m, other));
      return {
        ...(m as MeetingInstance),
        key: `${m.courseId}:${m.typeText}:${day}:${m.start}`,
        top,
        height,
        lane: m.lane,
        laneCount: m.laneCount,
        conflict,
      };
    });
  }

  return { byDay, usedDays };
}

/** Which columns to render: Mon–Fri always; a weekend day only if it carries meetings. */
export function visibleDays(usedDays: Set<Weekday>): Weekday[] {
  const base: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const out = [...base];
  if (usedDays.has('Sat')) out.push('Sat');
  if (usedDays.has('Sun')) out.push('Sun');
  return out;
}

/* ---- finals-week calendar (columns are concrete dates, weekends included) ---- */

/** Grid for the finals calendar — same 8:00–22:00 window, lower density (finals run ~3h). */
export const FINALS_GRID: GridConfig = { startHour: 8, endHour: 22, pxPerMinute: 0.75 };

/** A final exam flattened for placement on the finals calendar. */
export interface FinalInstance {
  courseId: string;
  courseCode: string;
  hue: number;
  date: string; // "YYYY-MM-DD"
  start: string;
  end: string;
  modality?: string;
}

const ISO_DOW: Weekday[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday of an ISO "YYYY-MM-DD" date (parsed as a local date). */
export function isoWeekday(iso: string): Weekday {
  const [y, m, d] = iso.split('-').map(Number);
  return ISO_DOW[new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay()] ?? 'Mon';
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Continuous ISO date range spanning every finals date, earliest → latest, so
 * exam-free days (and weekends) still show as columns. Falls back to just the
 * distinct dates if the span is implausibly long (bad data guard).
 */
export function finalsDateRange(dates: string[]): string[] {
  const uniq = [...new Set(dates)].sort();
  if (uniq.length === 0) return [];
  const first = uniq[0]!;
  const last = uniq[uniq.length - 1]!;
  const spanDays = Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000);
  if (spanDays > 13) return uniq;
  const out: string[] = [];
  for (let d = first; d <= last; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/**
 * Build positioned blocks for the finals calendar: one column per date in the
 * continuous range, lanes for same-day overlaps, and a conflict flag when two
 * different courses' finals overlap in time.
 */
export function layoutFinalsWeek(
  items: FinalInstance[],
  cfg: GridConfig,
): { dates: string[]; byDate: Record<string, PositionedBlock[]> } {
  const dates = finalsDateRange(items.map((i) => i.date));
  const byDate: Record<string, PositionedBlock[]> = {};
  for (const date of dates) byDate[date] = [];

  const grouped = new Map<string, FinalInstance[]>();
  for (const it of items) {
    const arr = grouped.get(it.date);
    if (arr) arr.push(it);
    else grouped.set(it.date, [it]);
  }

  for (const [date, dayItems] of grouped) {
    if (!byDate[date]) continue; // outside the (capped) range
    const laned = assignLanes(dayItems);
    byDate[date] = laned.map((m) => {
      const { top, height } = blockGeometry(m.start, m.end, cfg);
      const conflict = dayItems.some((o) => overlapsDifferentCourse(m, o));
      return {
        courseId: m.courseId,
        courseCode: m.courseCode,
        typeText: 'Final',
        hue: m.hue,
        location: m.modality,
        start: m.start,
        end: m.end,
        day: isoWeekday(date),
        key: `${m.courseId}:${date}`,
        top,
        height,
        lane: m.lane,
        laneCount: m.laneCount,
        conflict,
      };
    });
  }

  return { dates, byDate };
}
