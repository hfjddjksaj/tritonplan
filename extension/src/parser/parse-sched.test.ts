import { describe, it, expect } from 'vitest';
import { parseSched } from './parse-sched.js';

describe('parseSched — real captured TSS strings', () => {
  it('in-person lecture with final exam', () => {
    const r = parseSched(
      'Tu, Th 11:00 AM - 12:20 PM In Person @ Galbraith Hall Room 242\nFinal Examination 12/09/2026 11:30 AM - 02:29 PM In Person',
    );
    expect(r.unscheduled).toBe(false);
    expect(r.meetings).toHaveLength(1);
    expect(r.meetings[0]).toMatchObject({
      days: ['Tue', 'Thu'],
      start: '11:00',
      end: '12:20',
      modality: 'In Person',
      building: 'Galbraith Hall',
      room: '242',
    });
    expect(r.final).toEqual({ date: '2026-12-09', start: '11:30', end: '14:29', modality: 'In Person' });
  });

  it('single-day lab, truncated building name, no final', () => {
    const r = parseSched('W 09:00 AM - 09:50 AM In Person @ Computer Science and Engineering Buildin Room B260');
    expect(r.meetings).toHaveLength(1);
    expect(r.meetings[0]).toMatchObject({
      days: ['Wed'],
      start: '09:00',
      end: '09:50',
      building: 'Computer Science and Engineering Buildin',
      room: 'B260',
    });
    expect(r.final).toBeUndefined();
  });

  it('live-online meeting has no @location', () => {
    const r = parseSched('W 09:00 AM - 09:50 AM Live Online');
    expect(r.meetings).toHaveLength(1);
    expect(r.meetings[0]).toMatchObject({ days: ['Wed'], start: '09:00', end: '09:50', modality: 'Live Online' });
    expect(r.meetings[0].building).toBeUndefined();
    expect(r.meetings[0].room).toBeUndefined();
    expect(r.meetings[0].location).toBeUndefined();
  });

  it('"Schedule Not Defined" is unscheduled/TBA', () => {
    const r = parseSched('Schedule Not Defined');
    expect(r.unscheduled).toBe(true);
    expect(r.meetings).toHaveLength(0);
    expect(r.final).toBeUndefined();
  });

  it('MW evening lecture, PM times and final', () => {
    const r = parseSched(
      'M, W 06:30 PM - 07:50 PM In Person @ Center Hall Room 115\nFinal Examination 12/07/2026 07:00 PM - 09:59 PM In Person',
    );
    expect(r.meetings[0]).toMatchObject({ days: ['Mon', 'Wed'], start: '18:30', end: '19:50' });
    expect(r.final).toEqual({ date: '2026-12-07', start: '19:00', end: '21:59', modality: 'In Person' });
  });

  it('handles multiple meeting lines before a final (defensive)', () => {
    const r = parseSched(
      'M 10:00 AM - 10:50 AM In Person @ Peterson Hall Room 108\n' +
        'W 02:00 PM - 03:00 PM In Person @ Center Hall Room 220\n' +
        'Final Examination 12/11/2026 08:00 AM - 10:59 AM In Person',
    );
    expect(r.meetings).toHaveLength(2);
    expect(r.meetings[0].days).toEqual(['Mon']);
    expect(r.meetings[1]).toMatchObject({ days: ['Wed'], start: '14:00', end: '15:00', room: '220' });
    expect(r.final?.date).toBe('2026-12-11');
  });

  it('empty / nullish is unscheduled, not a crash', () => {
    expect(parseSched('').unscheduled).toBe(true);
    expect(parseSched(undefined).unscheduled).toBe(true);
    expect(parseSched(null).unscheduled).toBe(true);
  });
});
