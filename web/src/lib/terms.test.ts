import { describe, it, expect } from 'vitest';
import type { Term } from '@triton/shared';
import { termKey, seasonOf, displayYear, displayTermLabel } from './terms';

const FALL26: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WINTER27: Term = { year: '2027', period: '3', label: 'Period 3 2027' }; // calendar year 2027
const UNKNOWN: Term = { year: '2027', period: '9', label: 'Period 9 2027' };

describe('termKey', () => {
  it('matches the CourseOffering id suffix encoding', () => {
    expect(termKey(FALL26)).toBe('2026|2');
  });
});

describe('seasonOf', () => {
  it('maps only the grounded codes', () => {
    expect(seasonOf(FALL26)).toBe('fall');
    expect(seasonOf(WINTER27)).toBe('winter');
    expect(seasonOf(UNKNOWN)).toBeNull();
  });
});

describe('displayTermLabel', () => {
  it('Fall shows the calendar year', () => {
    expect(displayTermLabel(FALL26)).toBe('Fall 2026');
  });
  it('Winter shows the ACADEMIC-year start year (user decision)', () => {
    // Jan–Mar 2027 belongs to AY 2026–27 → displays "Winter 2026".
    expect(displayYear(WINTER27)).toBe(2026);
    expect(displayTermLabel(WINTER27)).toBe('Winter 2026');
  });
  it('unknown period falls back to the captured label', () => {
    expect(displayTermLabel(UNKNOWN)).toBe('Period 9 2027');
  });
  it('unknown period with empty label synthesizes the fallback', () => {
    expect(displayTermLabel({ year: '2027', period: '9', label: '' })).toBe('Period 9 2027');
  });
});
