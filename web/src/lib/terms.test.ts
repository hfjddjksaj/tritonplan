import { describe, it, expect } from 'vitest';
import type { Term } from '@triton/shared';
import {
  termKey,
  seasonOf,
  displayYear,
  displayTermLabel,
  chronoIndex,
  archiveBoundary,
  isArchived,
} from './terms';

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

describe('chronoIndex', () => {
  it('orders winter < spring < fall within a calendar year, across years by year', () => {
    const w27 = chronoIndex({ year: '2027', period: '3', label: '' })!;
    const f26 = chronoIndex({ year: '2026', period: '2', label: '' })!;
    const f27 = chronoIndex({ year: '2027', period: '2', label: '' })!;
    expect(f26).toBeLessThan(w27); // Fall 2026 precedes Winter (Jan–Mar) 2027
    expect(w27).toBeLessThan(f27);
  });
  it('is null for unknown periods (they cannot join the timeline)', () => {
    expect(chronoIndex({ year: '2027', period: '9', label: '' })).toBeNull();
  });
});

describe('isArchived (fixed month-day boundaries: Fall 12/20, Winter 3/22, Spring 6/15, Summer 9/15)', () => {
  it('Fall 2026 archives on Dec 20 2026, not before', () => {
    expect(isArchived(FALL26, new Date(2026, 11, 19))).toBe(false);
    expect(isArchived(FALL26, new Date(2026, 11, 20))).toBe(true);
  });
  it('Winter (calendar 2027) archives on Mar 22 2027', () => {
    const w: Term = { year: '2027', period: '3', label: '' };
    expect(isArchived(w, new Date(2027, 2, 21))).toBe(false);
    expect(isArchived(w, new Date(2027, 2, 22))).toBe(true);
  });
  it('unknown periods NEVER auto-archive', () => {
    expect(isArchived({ year: '2020', period: '9', label: '' }, new Date(2030, 0, 1))).toBe(false);
    expect(archiveBoundary({ year: '2020', period: '9', label: '' })).toBeNull();
  });
});
