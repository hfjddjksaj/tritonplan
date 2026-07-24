/** Small display helpers used across the calendar + finals views. */
import type { Weekday } from '@triton/shared';

const DOW_LONG: Record<Weekday, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

export function weekdayLong(day: Weekday): string {
  return DOW_LONG[day];
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
/** JS `Date.getDay()` index (0 = Sun … 6 = Sat) → our Weekday code. */
const WEEKDAY_BY_DOW: Weekday[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DateParts {
  dow: string; // "Wed"
  day: string; // "09"
  month: string; // "Dec"
}

/** Parse an ISO "YYYY-MM-DD" (as a local date) into display parts. */
export function dateParts(iso: string): DateParts {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return {
    dow: WEEKDAY_BY_DOW[dt.getDay()] ?? '',
    day: String(d ?? 0).padStart(2, '0'),
    month: MONTHS[(m ?? 1) - 1] ?? '',
  };
}

/** Today's weekday code in the browser's local time (weekends included — the grid
 * simply has no such column to highlight unless weekend meetings exist). */
export function todayWeekday(now = new Date()): Weekday {
  return WEEKDAY_BY_DOW[now.getDay()] ?? 'Mon';
}

/** English pluralize a noun by count: pluralize(1, 'course') → 'course', pluralize(2, 'course') → 'courses'. */
export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return n === 1 ? singular : plural;
}

/** Compact staleness label for a past ISO timestamp: "just now", "5m ago",
 * "3h ago", "2d ago". Empty string when the timestamp doesn't parse. */
export function relativeTime(iso: string, now = new Date()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const sec = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
