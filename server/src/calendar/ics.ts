import { optionMidterms, type Component, type CourseOffering, type FinalExam, type Meeting, type PlanState, type Weekday } from '@triton/shared';

const TZID = 'America/Los_Angeles';
const CRLF = '\r\n';

// Fixed text from the spec: clients that don't know the zone use it, and it keeps DTSTART;TZID series on local clock time across DST.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const BYDAY: Record<Weekday, string> = { Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR', Sat: 'SA', Sun: 'SU' };
// Index = Date#getUTCDay().
const DAY_BY_INDEX: Weekday[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- Los Angeles wall-clock date math. Dates are 'YYYY-MM-DD' strings and never pass through the host time zone. ----

function parseIso(date: string): [number, number, number] {
  const [y = 0, m = 0, d = 0] = date.split('-').map(Number);
  return [y, m, d];
}

function weekdayOf(date: string): Weekday {
  const [y, m, d] = parseIso(date);
  return DAY_BY_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = parseIso(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const laParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TZID, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

/** Offset of Los Angeles from UTC at an instant, in ms (negative: -8h in winter, -7h in summer). */
function laOffsetMs(instantMs: number): number {
  const p: Record<string, number> = {};
  for (const part of laParts.formatToParts(new Date(instantMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The UTC instant at which Los Angeles clocks read `date` `hh:mm:ss`. */
function laInstant(date: string, hh: number, mm: number, ss: number): Date {
  const [y, m, d] = parseIso(date);
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss);
  // Two passes settle the offset when the wall time is near a DST switch; the day-end times used here never sit in the gap.
  const first = wall - laOffsetMs(wall + 8 * 3_600_000);
  return new Date(wall - laOffsetMs(first));
}

function icsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
const icsDate = (date: string) => date.replace(/-/g, '');
const icsLocal = (date: string, hhmm: string) => `${icsDate(date)}T${hhmm.replace(':', '')}00`;

// ---- input checks: plans come from /api/sync, which stores whatever a client sent (a crafted share saved as a plan) ----

/** A real calendar date written 'YYYY-MM-DD'. Anything else would throw in the date math or land raw in the feed. */
function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = parseIso(v);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const isHhmm = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isWeekdays = (v: unknown): v is Weekday[] =>
  Array.isArray(v) && v.length > 0 && v.every((d) => typeof d === 'string' && Object.hasOwn(BYDAY, d));
const isExam = (x: FinalExam | undefined): x is FinalExam =>
  !!x && typeof x === 'object' && isIsoDate(x.date) && isHhmm(x.start) && isHhmm(x.end);

// ---- text ----

/** RFC 5545 TEXT escaping. */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold at 75 octets; continuation lines start with one space (counted in the 75). Never splits a UTF-8 character. */
function fold(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > 75) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out;
}

const uidPart = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');
const shortNumber = (n: string) => n.replace(/^0+(?=\d)/, '');

// ---- term end ----

/**
 * The one place that decides a term has finished and leaves the subscription (spec 5.5; the rule may change).
 * Over = now is past 23:59 (Los Angeles) of the latest final date or component end date among the picked options.
 */
export function calendarTermIsOver(plan: PlanState, now: Date): boolean {
  let last = '';
  for (const entry of plan.entries) {
    const opt = entry.course.options.find((o) => o.id === entry.selectedOptionId);
    if (!opt) continue;
    const dates = [opt.final?.date, ...opt.components.map((c) => c.endDate)];
    for (const d of dates) if (isIsoDate(d) && d > last) last = d;
  }
  if (!last) return false;
  return now.getTime() > laInstant(last, 23, 59, 59).getTime();
}

// ---- events ----

function eventLines(uid: string, now: Date, props: string[]): string[] {
  return ['BEGIN:VEVENT', `UID:${uid}@tritonplan.cn`, `DTSTAMP:${icsUtc(now)}`, ...props, 'END:VEVENT'];
}

function meetingEvent(course: CourseOffering, comp: Component, m: Meeting, index: number, holidays: readonly string[], now: Date): string[] | null {
  const begin = comp.beginDate;
  const end = comp.endDate;
  // Never guess at a value that isn't well formed: the meeting is left out.
  if (!isIsoDate(begin) || !isIsoDate(end) || !m || !isHhmm(m.start) || !isHhmm(m.end) || !isWeekdays(m.days)) return null;
  let first = begin;
  for (let i = 0; i < 7 && !m.days.includes(weekdayOf(first)); i++) first = addDays(first, 1);
  if (!m.days.includes(weekdayOf(first)) || first > end) return null;

  const props = [
    `DTSTART;TZID=${TZID}:${icsLocal(first, m.start)}`,
    `DTEND;TZID=${TZID}:${icsLocal(first, m.end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${m.days.map((d) => BYDAY[d]).join(',')};UNTIL=${icsUtc(laInstant(end, 23, 59, 59))}`,
  ];
  const ex = holidays.filter((h) => h >= begin && h <= end && m.days.includes(weekdayOf(h))).map((h) => icsLocal(h, m.start));
  if (ex.length) props.push(`EXDATE;TZID=${TZID}:${ex.join(',')}`);
  props.push(`SUMMARY:${esc(`${course.subject} ${shortNumber(course.number)} ${comp.typeText}`)}`);
  const where = [m.building, m.room].filter(Boolean).join(' ') || m.location;
  if (where) props.push(`LOCATION:${esc(where)}`);
  const names = Array.isArray(comp.instructors) ? comp.instructors.filter((n) => typeof n === 'string') : [];
  const desc = [`Section ${comp.sectionCode}`, ...(names.length ? [names.join(', ')] : [])].join('\n');
  props.push(`DESCRIPTION:${esc(desc)}`);
  return eventLines(`${uidPart(course.id)}-${uidPart(comp.id)}-${index}`, now, props);
}

/** `x` must have passed isExam. */
function examEvent(course: CourseOffering, kind: 'Final' | 'Midterm', uid: string, x: FinalExam, now: Date): string[] {
  const props = [
    `DTSTART;TZID=${TZID}:${icsLocal(x.date, x.start)}`,
    `DTEND;TZID=${TZID}:${icsLocal(x.date, x.end)}`,
    `SUMMARY:${esc(`${course.subject} ${shortNumber(course.number)} ${kind}`)}`,
  ];
  const where = [x.building, x.room].filter(Boolean).join(' ') || x.location;
  if (where) props.push(`LOCATION:${esc(where)}`);
  return eventLines(uid, now, props);
}

export function buildCalendar(input: { plans: { plan: PlanState }[]; now: Date; holidays: readonly string[] }): string {
  const { now, holidays } = input;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TritonPlan//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:TritonPlan',
    `X-WR-TIMEZONE:${TZID}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
  ];
  // The same course could appear in two picked plans; a UID may appear once per feed.
  const seen = new Set<string>();
  const add = (ev: string[]) => {
    const uid = ev[1]!;
    if (seen.has(uid)) return;
    seen.add(uid);
    lines.push(...ev);
  };

  for (const { plan } of input.plans) {
    let events: string[][];
    try {
      if (calendarTermIsOver(plan, now)) continue;
      events = planEvents(plan, holidays, now);
    } catch {
      // A plan whose shape is broken drops out whole; the student's other terms still reach their calendar.
      continue;
    }
    for (const ev of events) add(ev);
  }
  lines.push('END:VCALENDAR');
  return lines.flatMap(fold).join(CRLF) + CRLF;
}

/** Every event of one plan. Collected before any of them is added, so a plan that throws halfway adds nothing. */
function planEvents(plan: PlanState, holidays: readonly string[], now: Date): string[][] {
  const out: string[][] = [];
  const push = (ev: string[] | null) => { if (ev) out.push(ev); };
  for (const entry of plan.entries) {
    const course = entry.course;
    const opt = course.options.find((o) => o.id === entry.selectedOptionId);
    if (!opt) continue;
    for (const comp of opt.components) {
      if (comp.unscheduled || !comp.beginDate || !comp.endDate || !Array.isArray(comp.meetings)) continue;
      comp.meetings.forEach((m, i) => push(meetingEvent(course, comp, m, i, holidays, now)));
    }
    const id = uidPart(course.id);
    if (isExam(opt.final)) push(examEvent(course, 'Final', `final-${id}`, opt.final, now));
    optionMidterms(opt).forEach((x, i) => {
      if (isExam(x)) push(examEvent(course, 'Midterm', `midterm-${id}-${icsDate(x.date)}-${i}`, x, now));
    });
  }
  return out;
}
