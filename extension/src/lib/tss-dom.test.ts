import { describe, it, expect } from 'vitest';
import {
  extractModuleRef,
  parsePackageLabel,
  parseEnrollCode,
  findCourseByModuleId,
  resolveOption,
} from './tss-dom.js';
import { CaptureStore } from './capture-to-courses.js';
import { loadNormalizedFixture, denormalize } from '../parser/fixtures.js';
import type { CourseOffering } from '@triton/shared';

const fx = loadNormalizedFixture();

/** Build the real CSE-008A CourseOffering from the recon fixture. */
function cse008(): CourseOffering {
  const store = new CaptureStore();
  store.ingestBody(JSON.stringify({ '@odata.context': '#x', value: denormalize(fx['CSE-008A']) }));
  const c = store.toCourses().find((x) => x.courseCode === 'CSE-008A');
  if (!c) throw new Error('fixture course not built');
  return c;
}

describe('extractModuleRef', () => {
  const hash =
    "#YSchedule-view?sap-ui-tech-hint=&/YUCSD_CON_MODULE(AcademicYear='2026',AcademicPeriod='2',ModuleID='8461')/_sections";

  it('pulls year, period and module id from a TSS hash', () => {
    expect(extractModuleRef(hash)).toEqual({
      academicYear: '2026',
      academicPeriod: '2',
      moduleId: '8461',
    });
  });

  it('is order-independent', () => {
    const reordered = "...ModuleID='9999',AcademicYear='2027',AcademicPeriod='1'...";
    expect(extractModuleRef(reordered)).toEqual({
      academicYear: '2027',
      academicPeriod: '1',
      moduleId: '9999',
    });
  });

  it('tolerates URL-encoded quotes (%27)', () => {
    const enc = 'YUCSD_CON_MODULE(AcademicYear=%272026%27,AcademicPeriod=%272%27,ModuleID=%278461%27)';
    expect(extractModuleRef(enc)?.moduleId).toBe('8461');
  });

  it('returns null when no ModuleID is present', () => {
    expect(extractModuleRef('#YSchedule-view?nothing-here')).toBeNull();
    expect(extractModuleRef('')).toBeNull();
  });
});

describe('parsePackageLabel / parseEnrollCode', () => {
  it('splits "CSE-008A (P-001-001)" into course + package code', () => {
    expect(parsePackageLabel('CSE-008A (P-001-001)')).toEqual({
      courseCode: 'CSE-008A',
      packageCode: 'P-001-001',
    });
  });

  it('returns empty when there is no parenthetical', () => {
    expect(parsePackageLabel('CSE-008A')).toEqual({});
    expect(parsePackageLabel(null)).toEqual({});
  });

  it('extracts an SE enroll code from noisy card text', () => {
    expect(parseEnrollCode('CSE-008A (P-001-001)  SE00154302  Limit: 15')).toBe('SE00154302');
    expect(parseEnrollCode('no code here')).toBeNull();
  });
});

describe('findCourseByModuleId', () => {
  it('matches on CourseOffering.moduleId', () => {
    const c = cse008();
    expect(findCourseByModuleId([c], '8461')).toBe(c);
    expect(findCourseByModuleId([c], '0000')).toBeNull();
    expect(findCourseByModuleId([c], '')).toBeNull();
  });
});

describe('resolveOption', () => {
  it('resolves by enroll code (EventPkgDisplayID) to the right option.id', () => {
    const c = cse008();
    const opt = resolveOption(c, { enrollCode: 'SE00154302' });
    expect(opt?.id).toBe('SE00154302');
    expect(opt?.code).toBe('P-001-001');
  });

  it('resolves by package code ("P-001-009")', () => {
    const c = cse008();
    const opt = resolveOption(c, { packageCode: 'P-001-009' });
    expect(opt?.id).toBe('SE00154310');
  });

  it('prefers the enroll-code match over a mismatched package code', () => {
    const c = cse008();
    const opt = resolveOption(c, { enrollCode: 'SE00154303', packageCode: 'P-999-999' });
    expect(opt?.id).toBe('SE00154303');
  });

  it('returns null when nothing matches', () => {
    const c = cse008();
    expect(resolveOption(c, { enrollCode: 'ZZ99999999' })).toBeNull();
    expect(resolveOption(c, {})).toBeNull();
  });
});
