import { describe, it, expect } from 'vitest';
import type { BookedModule, Term } from '@triton/shared';
import { bookedTitle } from './CoursePanel';

const FALL: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WINTER: Term = { year: '2027', period: '1', label: 'Winter 2027' };

function row(courseCode: string, term: Term = FALL): BookedModule {
  return { courseCode, moduleId: '2077', term };
}
const idOf = (r: BookedModule): string => `${r.courseCode}|${r.term.year}|${r.term.period}`;
const idsOf = (rows: BookedModule[]): Set<string> => new Set(rows.map(idOf));
const NOW = new Date().toISOString();

describe('bookedTitle: what TSS said vs what this plan shows', () => {
  it('reports the plain agreeing case', () => {
    const rows = [row('CHEM-114A'), row('CHEM-152')];
    const t = bookedTitle(true, idsOf(rows), NOW, rows, FALL);
    expect(t).toMatch(/^2 booked in Fall 2026, read /);
  });

  it('still names the other term when every booking is elsewhere', () => {
    const rows = [row('CHEM-114A', WINTER)];
    const t = bookedTitle(true, new Set<string>(), NOW, rows, FALL);
    expect(t).toMatch(/but in Winter 2027 — none in Fall 2026/);
  });

  it('matches terms on year+period, not on the display label', () => {
    // Same label text, different term: the rows are NOT this term's.
    const odd: Term = { year: '2027', period: '2', label: 'Fall 2026' };
    const rows = [row('CHEM-114A', odd)];
    const t = bookedTitle(true, new Set<string>(), NOW, rows, FALL);
    expect(t).not.toMatch(/you unmarked/);
  });

  it('reports a genuine zero only when the feed carried nothing', () => {
    expect(bookedTitle(true, new Set<string>(), NOW, [], FALL)).toMatch(/no bookings at all/);
  });

  it('speaks for no report it did not receive this session', () => {
    expect(bookedTitle(false, new Set<string>(), null, [], FALL)).toMatch(/not read yet/);
    expect(bookedTitle(true, new Set<string>(), null, [], FALL)).toMatch(
      /Nothing read from TSS this session/,
    );
  });
});
