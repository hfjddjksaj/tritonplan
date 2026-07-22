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
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
    dow: DOW_SHORT[dt.getDay()] ?? '',
    day: String(d ?? 0).padStart(2, '0'),
    month: MONTHS[(m ?? 1) - 1] ?? '',
  };
}

/** Today's weekday code in the browser's local time (weekends included — the grid
 * simply has no such column to highlight unless weekend meetings exist). */
export function todayWeekday(now = new Date()): Weekday {
  const map: Weekday[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return map[now.getDay()] ?? 'Mon';
}
