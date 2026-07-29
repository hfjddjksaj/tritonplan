import { describe, it, expect } from 'vitest';
import { midtermsFromSched, optionMidterms } from './midterms.js';
import type { Component, SectionOption } from './types.js';

// The real CHEM-043A lecture Sched (user TSS screenshot, 2026-07-24).
const CHEM_43A_SCHED =
  'F 09:00 AM - 09:50 AM In Person @ York Hall Room 2622\n' +
  'Midterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person\n' +
  'Final Examination 12/05/2026 11:30 AM - 02:29 PM In Person';

function comp(rawSched: string, id = 'E 1'): Component {
  return {
    id,
    type: 'LE',
    typeText: 'Lecture',
    sectionCode: '001-000-LE',
    instructors: [],
    meetings: [],
    unscheduled: false,
    rawSched,
  };
}

function option(components: Component[], midterms?: SectionOption['midterms']): SectionOption {
  return { id: 'SM 1', code: 'P-001-001', enrollCode: 'SE00000001', components, ...(midterms !== undefined ? { midterms } : {}) };
}

describe('midtermsFromSched', () => {
  it('parses the real CHEM-043A midterm line (and only that line)', () => {
    expect(midtermsFromSched(CHEM_43A_SCHED)).toEqual([
      { date: '2026-10-31', start: '10:00', end: '11:50', modality: 'In Person' },
    ]);
  });

  it('parses multiple midterm lines in source order; modality optional', () => {
    const sched =
      'MW 10:00 AM - 10:50 AM In Person\n' +
      'Midterm Examination 11/20/2026 08:00 PM - 09:50 PM Live Online\n' +
      'Midterm Examination 10/17/2026 08:00 PM - 09:50 PM';
    expect(midtermsFromSched(sched)).toEqual([
      { date: '2026-11-20', start: '20:00', end: '21:50', modality: 'Live Online' },
      { date: '2026-10-17', start: '20:00', end: '21:50' },
    ]);
  });

  it('returns [] for schedules without midterms, TBA, empty and garbage input', () => {
    expect(midtermsFromSched('TuTh 11:00 AM - 12:20 PM In Person @ CENTR Room 119')).toEqual([]);
    expect(midtermsFromSched('Schedule Not Defined')).toEqual([]);
    expect(midtermsFromSched('')).toEqual([]);
    expect(midtermsFromSched(undefined)).toEqual([]);
    expect(midtermsFromSched('Midterm Examination someday 10:00 AM - 11:50 AM')).toEqual([]);
  });
});

describe('optionMidterms', () => {
  it('derives from components, dedupes the repeated lecture row, sorts by date+start', () => {
    const later =
      'Midterm Examination 11/14/2026 10:00 AM - 11:50 AM In Person';
    const o = option([comp(later, 'E 2'), comp(CHEM_43A_SCHED, 'E 1'), comp(CHEM_43A_SCHED, 'E 1b')]);
    expect(optionMidterms(o)).toEqual([
      { date: '2026-10-31', start: '10:00', end: '11:50', modality: 'In Person' },
      { date: '2026-11-14', start: '10:00', end: '11:50', modality: 'In Person' },
    ]);
  });

  it('prefers an explicit midterms field (share-decoded data has no rawSched)', () => {
    const explicit = [{ date: '2026-10-31', start: '10:00', end: '11:50' }];
    expect(optionMidterms(option([comp(CHEM_43A_SCHED)], explicit))).toEqual(explicit);
    expect(optionMidterms(option([comp(CHEM_43A_SCHED)], []))).toEqual([]);
  });

  it('returns [] for options with no components or empty rawSched', () => {
    expect(optionMidterms(option([]))).toEqual([]);
    expect(optionMidterms(option([comp('')]))).toEqual([]);
  });
});
