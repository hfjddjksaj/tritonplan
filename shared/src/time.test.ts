import { describe, it, expect } from 'vitest';
import { parse12h, toMinutes, rangesOverlap, formatDisplay } from './time.js';

describe('parse12h', () => {
  it('handles AM/PM and 12 o’clock boundaries', () => {
    expect(parse12h('11:00 AM')).toBe('11:00');
    expect(parse12h('12:20 PM')).toBe('12:20');
    expect(parse12h('12:00 AM')).toBe('00:00');
    expect(parse12h('02:29 PM')).toBe('14:29');
    expect(parse12h('06:30 PM')).toBe('18:30');
  });
  it('returns null on garbage', () => {
    expect(parse12h('nope')).toBeNull();
  });
});

describe('rangesOverlap', () => {
  it('touching endpoints do not conflict', () => {
    expect(rangesOverlap(600, 660, 660, 720)).toBe(false);
  });
  it('overlapping ranges conflict', () => {
    expect(rangesOverlap(600, 700, 660, 720)).toBe(true);
  });
});

describe('formatDisplay', () => {
  it('formats 24h to 12h', () => {
    expect(formatDisplay('13:05')).toBe('1:05 PM');
    expect(formatDisplay('00:00')).toBe('12:00 AM');
    expect(toMinutes('13:05')).toBe(785);
  });
});
