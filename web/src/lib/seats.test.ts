import { describe, it, expect } from 'vitest';
import type { CourseOffering, SectionOption } from '@triton/shared';
import { optionFull, courseFull, optionWaitlistOnly } from './seats';

/** A section option carrying only what the seat rule looks at. */
function opt(seatsAvailable?: number): SectionOption {
  return {
    id: 'SE1',
    code: 'P-001-001',
    enrollCode: 'SE1',
    components: [],
    ...(seatsAvailable === undefined ? {} : { seatsAvailable }),
  };
}

function course(...options: SectionOption[]): CourseOffering {
  return {
    id: 'CSE-008A|2026|2',
    moduleId: '8461',
    subject: 'CSE',
    number: '008A',
    courseCode: 'CSE-008A',
    title: 'Introduction to Programming',
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    options,
  };
}

describe('optionFull', () => {
  it('is full at zero seats and below', () => {
    expect(optionFull(opt(0))).toBe(true);
    expect(optionFull(opt(-3))).toBe(true); // TSS has been seen reporting overfill
  });

  it('is not full with seats left', () => {
    expect(optionFull(opt(1))).toBe(false);
    expect(optionFull(opt(15))).toBe(false);
  });

  it('is NOT full when the seat count is unknown', () => {
    // Older captures and some decoded links carry no seat count. Painting
    // "we don't know" as "no seats left" would be a claim the user acts on.
    expect(optionFull(opt(undefined))).toBe(false);
  });
});

/** A section option carrying only what the waitlist-only rule looks at. */
function statusOpt(status?: string, seatsAvailable?: number): SectionOption {
  return {
    id: 'SE1',
    code: 'P-001-001',
    enrollCode: 'SE1',
    components: [],
    ...(status === undefined ? {} : { status }),
    ...(seatsAvailable === undefined ? {} : { seatsAvailable }),
  };
}

describe('optionWaitlistOnly', () => {
  it('reads the status TSS actually writes', () => {
    expect(optionWaitlistOnly(statusOpt('Waitlist Only'))).toBe(true);
  });

  it('is true WITH seats left — that is the whole point', () => {
    // TSS gates 13 of CHEM-043A's 21 packages this way. Seats remain and the
    // student still cannot enroll, so fullness can never express this state.
    expect(optionWaitlistOnly(statusOpt('Waitlist Only', 5))).toBe(true);
  });

  it('ignores case and surrounding space', () => {
    expect(optionWaitlistOnly(statusOpt('waitlist only'))).toBe(true);
    expect(optionWaitlistOnly(statusOpt('  Waitlist Only  '))).toBe(true);
  });

  it('is false when TSS said nothing', () => {
    // "" is what a merely-full package carries; older captures have no field.
    expect(optionWaitlistOnly(statusOpt(undefined))).toBe(false);
    expect(optionWaitlistOnly(statusOpt(''))).toBe(false);
  });

  it('is false for any wording we have not verified', () => {
    // Only the one string seen live earns the mark. A near-miss like
    // "Waitlist Closed" means the opposite, and guessing costs the student a
    // section they could have taken.
    expect(optionWaitlistOnly(statusOpt('Scheduled'))).toBe(false);
    expect(optionWaitlistOnly(statusOpt('Waitlist Closed'))).toBe(false);
    expect(optionWaitlistOnly(statusOpt('Waitlist'))).toBe(false);
  });
});

describe('courseFull', () => {
  it('is full only when every section is full', () => {
    expect(courseFull(course(opt(0), opt(0)))).toBe(true);
    expect(courseFull(course(opt(0), opt(4)))).toBe(false);
  });

  it('is not full when any section has an unknown seat count', () => {
    expect(courseFull(course(opt(0), opt(undefined)))).toBe(false);
  });

  it('is not full with no sections at all', () => {
    expect(courseFull(course())).toBe(false);
  });
});
