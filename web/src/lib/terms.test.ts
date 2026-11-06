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
  calendarYear,
  buildSwitcherRows,
  layoutRows,
  liveUpcomingTerm,
} from './terms';

const FALL26: Term = { year: '2026', period: '2', label: 'Fall 2026' };
// SAP's AcYear is the ACADEMIC year: Winter 2027 (Jan–Mar) arrives as AcYear 2026.
const WINTER27: Term = { year: '2026', period: '3', label: 'Period 3 2026' };
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
  it('Winter shows the ACADEMIC-year start year', () => {
    // Jan–Mar 2027 belongs to AY 2026–27 → displays "Winter 2026".
    expect(displayYear(WINTER27)).toBe(2026);
    expect(displayTermLabel(WINTER27)).toBe('Winter 2026');
  });
  it('Winter runs in the calendar year after its academic year starts', () => {
    expect(calendarYear(WINTER27)).toBe(2027);
    expect(calendarYear(FALL26)).toBe(2026);
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
    const w27 = chronoIndex({ year: '2026', period: '3', label: '' })!;
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
  it('Winter of AY 2026 (Jan–Mar 2027) archives on Mar 22 2027', () => {
    expect(isArchived(WINTER27, new Date(2027, 2, 21))).toBe(false);
    expect(isArchived(WINTER27, new Date(2027, 2, 22))).toBe(true);
  });
  it('Winter is live while its registration runs in November', () => {
    // TSS's own URL for a Winter 2027 class: AcademicYear='2026',AcademicPeriod='3'.
    expect(isArchived(WINTER27, new Date(2026, 10, 5))).toBe(false);
  });
  it('unknown periods NEVER auto-archive', () => {
    expect(isArchived({ year: '2020', period: '9', label: '' }, new Date(2030, 0, 1))).toBe(false);
    expect(archiveBoundary({ year: '2020', period: '9', label: '' })).toBeNull();
  });
});

const K = (y: string, p: string) => `${y}|${p}`;

describe('buildSwitcherRows', () => {
  it('one AY row: Fall present, Winter/Spring placeholders with correct labels', () => {
    const rows = buildSwitcherRows([{ year: '2026', period: '2', label: 'Fall 2026' }], K('2026', '2'), new Date(2026, 9, 1));
    expect(rows.quarterRows).toHaveLength(1);
    const [fall, winter, spring] = rows.quarterRows[0]!;
    expect(fall).toMatchObject({ key: '2026|2', label: 'Fall 2026', selectable: true, current: true, archived: false });
    expect(winter).toMatchObject({ key: null, label: 'Winter 2026', selectable: false });
    expect(spring).toMatchObject({ key: null, label: 'Spring 2027', selectable: false });
    expect(rows.summerRows).toHaveLength(0);
    expect(rows.otherRows).toHaveLength(0);
  });

  it('Winter of AY 2026 lands in the Fall-2026 row and marks archived terms', () => {
    const rows = buildSwitcherRows(
      [
        { year: '2026', period: '2', label: 'Fall 2026' },
        { year: '2026', period: '3', label: '' },
      ],
      K('2026', '3'),
      new Date(2027, 0, 10), // Jan 2027: Fall archived (>=12/20/2026), Winter live
    );
    expect(rows.quarterRows).toHaveLength(1);
    const [fall, winter] = rows.quarterRows[0]!;
    expect(fall).toMatchObject({ key: '2026|2', archived: true, selectable: true, current: false });
    expect(winter).toMatchObject({ key: '2026|3', label: 'Winter 2026', current: true, archived: false });
  });

  it('rows sort ascending by academic year', () => {
    const rows = buildSwitcherRows(
      [
        { year: '2027', period: '2', label: 'Fall 2027' },
        { year: '2026', period: '2', label: 'Fall 2026' },
      ],
      K('2027', '2'),
      new Date(2027, 9, 1),
    );
    expect(rows.quarterRows[0]![0]!.label).toBe('Fall 2026');
    expect(rows.quarterRows[1]![0]!.label).toBe('Fall 2027');
  });

  it('unknown periods go to otherRows with fallback labels', () => {
    const rows = buildSwitcherRows([{ year: '2027', period: '9', label: 'Period 9 2027' }], K('2027', '9'), new Date(2027, 0, 1));
    expect(rows.quarterRows).toHaveLength(0);
    expect(rows.otherRows).toEqual([
      { key: '2027|9', label: 'Period 9 2027', selectable: true, current: true, archived: false },
    ]);
  });
});

describe('layoutRows (summer, via the test seam until real codes exist)', () => {
  it('summer rows appear per calendar year with a placeholder for the unused session', () => {
    const s1: Term = { year: '2027', period: 'S1', label: '' };
    const rows = layoutRows(
      [
        { term: { year: '2026', period: '2', label: 'Fall 2026' }, season: 'fall' },
        { term: s1, season: 'summer1' },
      ],
      K('2026', '2'),
      new Date(2026, 9, 1),
    );
    expect(rows.summerRows).toHaveLength(1);
    const [a, b] = rows.summerRows[0]!;
    expect(a).toMatchObject({ key: '2027|S1', label: 'Summer I 2027', selectable: true });
    expect(b).toMatchObject({ key: null, label: 'Summer II 2027', selectable: false });
  });
});

describe('creatable placeholders', () => {
  it('liveUpcomingTerm: Winter 2026 from Nov 5 2026, null before, null once archived', () => {
    // UTC instants at PT noon: the machine's own timezone must not move the day (the dev box may be far east of PT)
    expect(liveUpcomingTerm(new Date('2026-11-05T20:00:00Z'))).toEqual({ year: '2026', period: '3', label: 'Winter 2026' });
    expect(liveUpcomingTerm(new Date('2026-11-04T20:00:00Z'))).toBeNull();
    expect(liveUpcomingTerm(new Date('2027-03-22T20:00:00Z'))).toBeNull();
  });
  it('a missing Winter of a used AY is creatable while live; Spring never; an archived Fall never (Review Focus 5)', () => {
    const rows = buildSwitcherRows([FALL26], '2026|2', new Date('2026-11-06T20:00:00Z'));
    expect(rows.quarterRows[0]![1]).toMatchObject({ key: null, selectable: false, create: { year: '2026', period: '3', label: 'Winter 2026' } });
    expect(rows.quarterRows[0]![2]!.create).toBeUndefined();
    const later = buildSwitcherRows([WINTER27], '2026|3', new Date('2026-12-21T20:00:00Z'));
    expect(later.quarterRows[0]![0]!.create).toBeUndefined();
  });
});
