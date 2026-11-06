import { describe, expect, it } from 'vitest';
import { instructionSpans, todayPT, upcomingTerm } from './academic-calendar.js';

describe('academic calendar', () => {
  it('todayPT is the Pacific calendar day', () => {
    expect(todayPT(new Date('2026-11-05T06:59:00Z'))).toBe('2026-11-04'); // 22:59 PST Nov 4
    expect(todayPT(new Date('2026-11-05T08:00:00Z'))).toBe('2026-11-05');
  });
  it('upcomingTerm is null before any enrollmentOpens, Winter 2027 from Nov 5 PT on, and has no end', () => {
    expect(upcomingTerm(new Date('2026-11-05T06:59:00Z'))).toBeNull();
    expect(upcomingTerm(new Date('2026-11-05T08:00:00Z'))).toMatchObject({ year: '2026', period: '3' });
    expect(upcomingTerm(new Date('2027-06-01T12:00:00Z'))).toMatchObject({ year: '2026', period: '3' });
  });
  it('rows without enrollmentOpens never win', () => {
    // Fall 2026 has none, so even well into its term nothing is upcoming.
    expect(upcomingTerm(new Date('2026-10-01T19:00:00Z'))).toBeNull();
  });
  it('instructionSpans equals the former server table', () => {
    expect(instructionSpans()).toEqual({
      '2026|2': { begin: '2026-09-24', end: '2026-12-04' },
      '2026|3': { begin: '2027-01-04', end: '2027-03-12' },
    });
  });
});
