import { describe, it, expect } from 'vitest';
import { relativeTime } from './format';

const NOW = new Date('2026-07-24T12:00:00Z');

describe('relativeTime', () => {
  it('buckets past timestamps into now / minutes / hours / days', () => {
    expect(relativeTime('2026-07-24T11:59:30Z', NOW)).toBe('just now');
    expect(relativeTime('2026-07-24T11:55:00Z', NOW)).toBe('5m ago');
    expect(relativeTime('2026-07-24T09:00:00Z', NOW)).toBe('3h ago');
    expect(relativeTime('2026-07-22T12:00:00Z', NOW)).toBe('2d ago');
  });

  it('clamps future timestamps (clock skew) to "just now"', () => {
    expect(relativeTime('2026-07-24T12:05:00Z', NOW)).toBe('just now');
  });

  it('returns an empty string for garbage input', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('');
  });
});
