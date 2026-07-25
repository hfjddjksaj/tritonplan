import { describe, it, expect } from 'vitest';
import type { ApptTimes } from '@triton/shared';
import {
  apptWindowStatus,
  formatApptInstant,
  formatApptRangeInZone,
  localZoneIfNotPacific,
  nextRelevantWindow,
  pickDisplayTerm,
} from './appt';

const W1 = { label: 'First Pass', beginsAt: '2026-08-10T21:00:00Z', endsAt: '2026-08-14T05:59:59Z' };
const W2 = { label: 'Second Pass', beginsAt: '2026-08-21T17:00:00Z', endsAt: '2026-08-27T05:59:59Z' };
const term = (over: Partial<ApptTimes>): ApptTimes => ({
  academicYear: '2026', academicSession: '2', yearText: '2026/2027',
  sessionText: 'Fall Quarter', capturedAt: '2026-07-25T12:00:00Z',
  windows: [W1, W2], ...over,
});

describe('apptWindowStatus', () => {
  it('is inclusive at both bounds', () => {
    expect(apptWindowStatus(W1, new Date('2026-08-10T20:59:59Z'))).toBe('upcoming');
    expect(apptWindowStatus(W1, new Date('2026-08-10T21:00:00Z'))).toBe('open');
    expect(apptWindowStatus(W1, new Date('2026-08-14T05:59:59Z'))).toBe('open');
    expect(apptWindowStatus(W1, new Date('2026-08-14T06:00:00Z'))).toBe('ended');
  });
});

describe('nextRelevantWindow', () => {
  it('features the first not-ended window (open beats later upcoming)', () => {
    expect(nextRelevantWindow(term({}), new Date('2026-07-25T00:00:00Z'))!.label).toBe('First Pass');
    expect(nextRelevantWindow(term({}), new Date('2026-08-11T00:00:00Z'))!.label).toBe('First Pass');
    expect(nextRelevantWindow(term({}), new Date('2026-08-15T00:00:00Z'))!.label).toBe('Second Pass');
    expect(nextRelevantWindow(term({}), new Date('2026-09-01T00:00:00Z'))).toBeNull();
  });
});

describe('pickDisplayTerm', () => {
  const fall = term({});
  const winter = term({
    academicSession: '3', sessionText: 'Winter Quarter', capturedAt: '2026-07-26T12:00:00Z',
    windows: [{ label: 'First Pass', beginsAt: '2026-11-10T22:00:00Z', endsAt: '2026-11-13T22:00:00Z' }],
  });

  it('prefers the term whose next window begins soonest', () => {
    expect(pickDisplayTerm([winter, fall], new Date('2026-07-25T00:00:00Z'))).toBe(fall);
  });
  it('skips all-ended terms while any live one exists', () => {
    expect(pickDisplayTerm([fall, winter], new Date('2026-10-01T00:00:00Z'))).toBe(winter);
  });
  it('falls back to the freshest capture when everything ended', () => {
    expect(pickDisplayTerm([fall, winter], new Date('2027-01-01T00:00:00Z'))).toBe(winter);
    expect(pickDisplayTerm([], new Date())).toBeNull();
  });
  it('never features an empty-windows term (spec: treat as no data)', () => {
    const empty = term({ capturedAt: '2026-07-27T12:00:00Z', windows: [] });
    expect(pickDisplayTerm([empty], new Date('2026-07-25T00:00:00Z'))).toBeNull();
  });
  it('prefers an older all-ended term over a freshest-captured empty one', () => {
    const empty = term({ capturedAt: '2026-07-27T12:00:00Z', windows: [] });
    expect(pickDisplayTerm([fall, winter, empty], new Date('2027-01-01T00:00:00Z'))).toBe(winter);
  });
});

describe('formatApptInstant', () => {
  it('renders the Pacific wall clock (PDT in August)', () => {
    expect(formatApptInstant('2026-08-10T21:00:00Z')).toBe('8/10 2:00 PM');
    expect(formatApptInstant('2026-08-14T05:59:59Z')).toBe('8/13 10:59 PM');
  });
  it('returns empty on garbage', () => {
    expect(formatApptInstant('nope')).toBe('');
  });
});

describe('localZoneIfNotPacific', () => {
  it('suppresses Pacific and unknown zones, passes others through', () => {
    expect(localZoneIfNotPacific('America/Los_Angeles')).toBeNull();
    expect(localZoneIfNotPacific(null)).toBeNull();
    expect(localZoneIfNotPacific('Asia/Shanghai')).toBe('Asia/Shanghai');
  });
});

describe('formatApptRangeInZone', () => {
  it('renders the range in the given zone with a GMT-offset label (crosses midnight in Shanghai)', () => {
    expect(
      formatApptRangeInZone('2026-08-10T21:00:00Z', '2026-08-14T05:59:59Z', 'Asia/Shanghai'),
    ).toBe('8/11 5:00 AM – 8/14 1:59 PM GMT+8');
  });
  it('respects DST in the target zone (New York is GMT-4 in August)', () => {
    expect(
      formatApptRangeInZone('2026-08-10T21:00:00Z', '2026-08-14T05:59:59Z', 'America/New_York'),
    ).toBe('8/10 5:00 PM – 8/14 1:59 AM GMT-4');
  });
  it('returns empty on an invalid zone or invalid timestamps', () => {
    expect(formatApptRangeInZone('2026-08-10T21:00:00Z', '2026-08-14T05:59:59Z', 'Not/AZone')).toBe('');
    expect(formatApptRangeInZone('nope', '2026-08-14T05:59:59Z', 'Asia/Shanghai')).toBe('');
  });
});
