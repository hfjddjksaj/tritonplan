import { expect, test } from 'vitest';
import type { CourseOffering, PlanState, SectionOption } from '@triton/shared';
import { buildCalendar, calendarTermIsOver } from './ics';

const NOW = new Date('2026-10-26T20:00:00.000Z');
const HOLIDAYS = ['2026-11-11', '2026-11-26', '2026-11-27'];

function option(over: Partial<SectionOption> = {}): SectionOption {
  return {
    id: 'SE1', code: 'A00', enrollCode: 'SE1',
    components: [{
      id: 'E 1', type: 'LE', typeText: 'Lecture', sectionCode: '001-000-LE', instructors: ['Leo Porter'],
      meetings: [{ days: ['Tue', 'Thu'], start: '11:00', end: '12:20', modality: 'In Person', building: 'Galbraith Hall', room: '242' }],
      unscheduled: false, beginDate: '2026-09-24', endDate: '2026-12-04', rawSched: '',
    }],
    final: { date: '2026-12-08', start: '11:30', end: '14:29' },
    ...over,
  };
}
function plan(opt: SectionOption | null = option(), over: Partial<CourseOffering> = {}): PlanState {
  const course: CourseOffering = {
    id: 'CSE 8A|2026|2', moduleId: '1', subject: 'CSE', number: '008A', courseCode: 'CSE-008A', title: 'Intro',
    term: { year: '2026', period: '2', label: 'Fall 2026' }, options: opt ? [opt] : [], ...over,
  };
  return { version: 1, term: course.term, entries: [{ course, selectedOptionId: opt ? opt.id : null }] };
}
const build = (p: PlanState[], now = NOW) => buildCalendar({ plans: p.map((plan) => ({ plan })), now, holidays: HOLIDAYS });
const events = (ics: string) => ics.split('BEGIN:VEVENT\r\n').slice(1).map((e) => e.split('END:VEVENT')[0]!);

test('a weekly meeting becomes one recurring event in Los Angeles time', () => {
  const ics = build([plan()]);
  const [e] = events(ics);
  expect(e).toContain('DTSTART;TZID=America/Los_Angeles:20260924T110000\r\n');
  expect(e).toContain('DTEND;TZID=America/Los_Angeles:20260924T122000\r\n');
  expect(e).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261205T075959Z\r\n');
  expect(e).toContain('SUMMARY:CSE 8A Lecture\r\n');
  expect(e).toContain('LOCATION:Galbraith Hall 242\r\n');
  expect(e).toContain('UID:CSE_8A_2026_2-E_1-0@tritonplan.cn\r\n');
  expect(e).toContain('DTSTAMP:20261026T200000Z\r\n');
  expect(e).toContain('DESCRIPTION:Section 001-000-LE\\nLeo Porter\r\n');
});

test('a course spanning the end of daylight time keeps its local clock time', () => {
  const ics = build([plan()]);
  // 2026-11-01 (Sunday) is the day DST ends: the series is anchored in local time, never in a fixed UTC instant.
  expect(ics).toContain('DTSTART;TZID=America/Los_Angeles:20260924T110000');
  expect(ics).not.toMatch(/DTSTART:[0-9T]+Z/);
  expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:America/Los_Angeles\r\nBEGIN:DAYLIGHT\r\nTZOFFSETFROM:-0800\r\nTZOFFSETTO:-0700\r\nTZNAME:PDT\r\nDTSTART:19700308T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nEND:DAYLIGHT\r\nBEGIN:STANDARD\r\nTZOFFSETFROM:-0700\r\nTZOFFSETTO:-0800\r\nTZNAME:PST\r\nDTSTART:19701101T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n');
  // A spring series ends in PDT: 23:59:59 PDT = 06:59:59Z the next day.
  const spring = option();
  spring.components[0]!.beginDate = '2027-03-30';
  spring.components[0]!.endDate = '2027-06-04';
  expect(build([plan(spring)], new Date('2027-03-01T00:00:00Z'))).toContain('UNTIL=20270605T065959Z');
});

test('holidays on meeting days are excluded, others are not', () => {
  const [e] = events(build([plan()]));
  expect(e).toContain('EXDATE;TZID=America/Los_Angeles:20261126T110000\r\n'); // Thursday
  expect(e).not.toContain('20261111'); // Wednesday, not a TuTh day
  expect(e).not.toContain('20261127'); // Friday
});

test('finals and midterms are single events', () => {
  const o = option();
  o.components[0]!.rawSched = 'Midterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person';
  const evs = events(build([plan(o)]));
  expect(evs).toHaveLength(3);
  const fin = evs.find((e) => e.includes('SUMMARY:CSE 8A Final'))!;
  expect(fin).toContain('DTSTART;TZID=America/Los_Angeles:20261208T113000\r\n');
  expect(fin).toContain('DTEND;TZID=America/Los_Angeles:20261208T142900\r\n');
  expect(fin).toContain('UID:final-CSE_8A_2026_2@tritonplan.cn\r\n');
  expect(fin).not.toContain('RRULE');
  const mid = evs.find((e) => e.includes('SUMMARY:CSE 8A Midterm'))!;
  expect(mid).toContain('DTSTART;TZID=America/Los_Angeles:20261031T100000\r\n');
  expect(mid).toContain('UID:midterm-CSE_8A_2026_2-20261031-0@tritonplan.cn\r\n');
  expect(mid).not.toContain('RRULE');
});

test('unscheduled or undated components are skipped', () => {
  const o = option({ final: undefined });
  const c = o.components[0]!;
  o.components = [
    { ...c, id: 'u', unscheduled: true },
    { ...c, id: 'nb', beginDate: undefined },
    { ...c, id: 'ne', endDate: undefined },
    { ...c, id: 'nm', meetings: [] },
    { ...c, id: 'ok' },
  ];
  const evs = events(build([plan(o)]));
  expect(evs).toHaveLength(1);
  expect(evs[0]).toContain('UID:CSE_8A_2026_2-ok-0@tritonplan.cn');
  expect(events(build([plan(null)]))).toEqual([]);
});

test('a term whose last final is past drops out of the feed', () => {
  const p = plan();
  expect(calendarTermIsOver(p, new Date('2026-12-08T23:58:00-08:00'))).toBe(false);
  expect(calendarTermIsOver(p, new Date('2026-12-09T09:00:00-08:00'))).toBe(true);
  expect(calendarTermIsOver(plan(option({ final: undefined, components: [] })), new Date('2030-01-01'))).toBe(false);
  const ics = build([p], new Date('2026-12-09T09:00:00-08:00'));
  expect(ics).toContain('BEGIN:VTIMEZONE');
  expect(ics).not.toContain('BEGIN:VEVENT');
  expect(ics).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/TritonPlan\/\/Calendar\/\/EN\r\n/);
  expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
});

test('lines are CRLF, folded at 75 octets and text is escaped', () => {
  const o = option();
  const m = o.components[0]!.meetings[0]!;
  m.building = undefined;
  m.room = undefined;
  m.location = '中心大楼, 北翼; Room A\\B ' + '教室'.repeat(40);
  const ics = build([plan(o)]);
  expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  const lines = ics.split('\r\n');
  for (const l of lines) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
  const unfolded = ics.replace(/\r\n /g, '');
  expect(unfolded).toContain('LOCATION:中心大楼\\, 北翼\\; Room A\\\\B 教室教室');
  // Folding never splits a character: every physical line is valid UTF-8 on its own.
  for (const l of lines) expect(Buffer.from(l, 'utf8').toString('utf8')).toBe(l);
  expect(lines.some((l) => l.startsWith(' '))).toBe(true);
});
