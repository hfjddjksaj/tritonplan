import { describe, it, expect } from 'vitest';
import { ARCHIVE_BOUNDARIES, nextArchiveDays, todayPT } from './archive-boundaries.mjs';
import { archiveBoundary } from '../src/lib/terms';

describe('archive-boundaries script', () => {
  it('lists the same month-days as BOUNDARY in web/src/lib/terms.ts', () => {
    const fall = archiveBoundary({ year: '2026', period: '2', label: '' });
    const winter = archiveBoundary({ year: '2026', period: '3', label: '' });
    expect(ARCHIVE_BOUNDARIES).toContainEqual({ month: fall.getMonth() + 1, day: fall.getDate() });
    expect(ARCHIVE_BOUNDARIES).toContainEqual({ month: winter.getMonth() + 1, day: winter.getDate() });
    expect(ARCHIVE_BOUNDARIES).toHaveLength(4); // Fall, Winter, Spring, Summer (I and II share a day)
  });

  it('nextArchiveDays: the day after each of the next N boundaries strictly after today, crossing the year', () => {
    expect(nextArchiveDays('2026-11-06', 2)).toEqual(['2026-12-21', '2027-03-23']);
    expect(nextArchiveDays('2026-12-20', 2)).toEqual(['2027-03-23', '2027-06-16']); // today's boundary is not upcoming
    expect(nextArchiveDays('2026-12-19', 1)).toEqual(['2026-12-21']);
    expect(nextArchiveDays('2027-09-15', 3)).toEqual(['2027-12-21', '2028-03-23', '2028-06-16']);
  });

  it('todayPT is the Pacific calendar day', () => {
    expect(todayPT(new Date('2026-11-05T06:59:00Z'))).toBe('2026-11-04');
    expect(todayPT(new Date('2026-11-05T08:00:00Z'))).toBe('2026-11-05');
  });
});
