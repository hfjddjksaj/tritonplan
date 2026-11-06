import { describe, expect, it } from 'vitest';
import type { ApptTimes } from './types.js';
import { apptTermKey, mergeApptTimes } from './appt.js';

const appt = (academicSession: string, capturedAt: string): ApptTimes => ({
  academicYear: '2026',
  academicSession,
  yearText: '2026',
  sessionText: `S${academicSession}`,
  windows: [],
  capturedAt,
});

describe('mergeApptTimes', () => {
  it('keys a term by year and session', () => {
    expect(apptTermKey(appt('3', 'x'))).toBe('2026|3');
  });
  it('adds a term the account does not have', () => {
    const fall = appt('2', '2026-09-01T00:00:00Z');
    const winter = appt('3', '2026-11-01T00:00:00Z');
    expect(mergeApptTimes([fall], [winter]).map(apptTermKey)).toEqual(['2026|2', '2026|3']);
  });
  it('replaces a term with a newer capture', () => {
    const merged = mergeApptTimes([appt('3', '2026-09-01T00:00:00Z')], [appt('3', '2026-10-01T00:00:00Z')]);
    expect(merged).toEqual([appt('3', '2026-10-01T00:00:00Z')]);
  });
  it('keeps the existing entry when the incoming capture is older or equal', () => {
    const cur = appt('3', '2026-09-01T00:00:00Z');
    expect(mergeApptTimes([cur], [appt('3', '2026-08-01T00:00:00Z')])[0]).toBe(cur);
    const tie = { ...cur, sessionText: 'other' };
    expect(mergeApptTimes([cur], [tie])[0]).toBe(cur);
  });
  it('returns the existing entries for an empty push', () => {
    const cur = [appt('3', '2026-09-01T00:00:00Z')];
    expect(mergeApptTimes(cur, [])).toEqual(cur);
  });
  it('sorts by key', () => {
    const a = appt('2', '2026-09-01T00:00:00Z');
    const b = appt('3', '2026-09-01T00:00:00Z');
    expect(mergeApptTimes([b], [a]).map(apptTermKey)).toEqual(['2026|2', '2026|3']);
  });
});
