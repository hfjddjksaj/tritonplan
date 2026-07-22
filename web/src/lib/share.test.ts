import { describe, it, expect } from 'vitest';
import {
  encodePlan,
  decodePlan,
  planToHash,
  planFromHash,
  shareUrl,
  parsePlanJson,
} from './share';
import { makePlan } from './fixtures';

describe('encode/decode round-trip', () => {
  it('restores an identical plan through lz-string', () => {
    const plan = makePlan();
    const token = encodePlan(plan);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(decodePlan(token)).toEqual(plan);
  });

  it('returns null for a corrupt token', () => {
    expect(decodePlan('!!!not-valid!!!')).toBeNull();
    expect(decodePlan('')).toBeNull();
  });
});

describe('hash helpers', () => {
  it('round-trips through a location hash', () => {
    const plan = makePlan();
    const hash = `#${planToHash(plan)}`;
    expect(hash.startsWith('#p=')).toBe(true);
    expect(planFromHash(hash)).toEqual(plan);
  });

  it('returns null when the hash has no plan token', () => {
    expect(planFromHash('')).toBeNull();
    expect(planFromHash('#foo=bar')).toBeNull();
  });

  it('builds an absolute share URL carrying the plan', () => {
    const plan = makePlan();
    const url = shareUrl(plan, 'https://plan.example/app/');
    expect(url.startsWith('https://plan.example/app/#p=')).toBe(true);
    expect(planFromHash(new URL(url).hash)).toEqual(plan);
  });
});

describe('parsePlanJson', () => {
  it('parses a valid plan and rejects junk', () => {
    const plan = makePlan();
    expect(parsePlanJson(JSON.stringify(plan))).toEqual(plan);
    expect(parsePlanJson('{"nope":true}')).toBeNull();
    expect(parsePlanJson('not json')).toBeNull();
  });
});
