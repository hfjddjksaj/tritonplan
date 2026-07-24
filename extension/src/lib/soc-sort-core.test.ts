import { describe, it, expect } from 'vitest';
import {
  compareCourseKeys,
  courseKeyFromText,
  isIdentityOrder,
  sortedUnitOrder,
} from './soc-sort-core.js';

function sortCodes(codes: string[]): string[] {
  const keys = codes.map(courseKeyFromText);
  const order = sortedUnitOrder(keys);
  if (!order) return codes;
  return order.map((i) => codes[i]!);
}

describe('courseKeyFromText', () => {
  it('parses plain, suffixed, and short-dept codes', () => {
    expect(courseKeyFromText('CHEM-130')).toEqual({ dept: 'CHEM', num: 130, suffix: '' });
    expect(courseKeyFromText('CHEM-040AH')).toEqual({ dept: 'CHEM', num: 40, suffix: 'AH' });
    expect(courseKeyFromText('SE-181')).toEqual({ dept: 'SE', num: 181, suffix: '' });
    expect(courseKeyFromText('AAS-010R more row text 4.00')).toEqual({
      dept: 'AAS',
      num: 10,
      suffix: 'R',
    });
  });

  it('returns null when no code is present, and skips enroll codes', () => {
    expect(courseKeyFromText('Title: Chemical Biology')).toBeNull();
    expect(courseKeyFromText('SE00152180')).toBeNull();
  });
});

describe('compareCourseKeys / sortedUnitOrder', () => {
  it('fixes the real-world CHEM order from TSS (130 before 040A)', () => {
    const tss = ['CHEM-116', 'CHEM-117', 'CHEM-126A', 'CHEM-130', 'CHEM-040A', 'CHEM-040B', 'CHEM-043A', 'CHEM-143B', 'CHEM-152'];
    expect(sortCodes(tss)).toEqual(['CHEM-040A', 'CHEM-040B', 'CHEM-043A', 'CHEM-116', 'CHEM-117', 'CHEM-126A', 'CHEM-130', 'CHEM-143B', 'CHEM-152']);
  });

  it('orders numeric before suffix: 040A < 040AH < 040B < 044', () => {
    expect(sortCodes(['CHEM-044', 'CHEM-040B', 'CHEM-040AH', 'CHEM-040A'])).toEqual([
      'CHEM-040A',
      'CHEM-040AH',
      'CHEM-040B',
      'CHEM-044',
    ]);
    expect(
      compareCourseKeys(courseKeyFromText('CHEM-040')!, courseKeyFromText('CHEM-040A')!),
    ).toBeLessThan(0);
  });

  it('groups by department first', () => {
    expect(sortCodes(['MAE-003', 'CENG-101A', 'BENG-110', 'MAE-101A'])).toEqual([
      'BENG-110',
      'CENG-101A',
      'MAE-003',
      'MAE-101A',
    ]);
  });

  it('sinks unkeyed rows to the end, keeps ties stable', () => {
    expect(sortCodes(['CHEM-006B', 'garbage', 'CHEM-006A', 'more garbage'])).toEqual([
      'CHEM-006A',
      'CHEM-006B',
      'garbage',
      'more garbage',
    ]);
  });

  it('returns null (leave DOM alone) with fewer than two keyed units', () => {
    expect(sortedUnitOrder([courseKeyFromText('CHEM-006A'), null])).toBeNull();
    expect(sortedUnitOrder([null, null])).toBeNull();
  });

  it('identity order is detected so a sorted list is never touched', () => {
    const order = sortedUnitOrder(['CHEM-006A', 'CHEM-006B', 'CHEM-007L'].map(courseKeyFromText));
    expect(order).toEqual([0, 1, 2]);
    expect(isIdentityOrder(order!)).toBe(true);
  });
});
