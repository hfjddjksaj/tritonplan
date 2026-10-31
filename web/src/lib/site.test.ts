import { describe, expect, it } from 'vitest';
import { OLD_SITE_ORIGIN, OLD_SITE_URL, SITE_ORIGIN, safeReturnTo } from './site';

describe('site origins', () => {
  it('default to the production sites when the build sets nothing', () => {
    expect(SITE_ORIGIN).toBe('https://tritonplan.cn');
    expect(OLD_SITE_ORIGIN).toBe('https://hfjddjksaj.github.io');
    expect(OLD_SITE_URL).toBe('https://hfjddjksaj.github.io/tritonplan/');
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['/a\\b', '/'],
    ['/\tx', '/'],
    ['https://evil.com', '/'],
    ['evil.com', '/'],
    ['', '/'],
    ['/reset', '/'],
    ['/reset/', '/'],
    ['/verify', '/'],
    ['/verify/?x=1', '/'],
    ['/migrate', '/migrate'],
    ['/s/AbCdEfGh12', '/s/AbCdEfGh12'], // a short link: "Save to my account" signs in and comes back to it
    ['/x?y=1', '/x?y=1'],
    ['/', '/'],
  ])('%j → %j', (input, out) => {
    expect(safeReturnTo(input)).toBe(out);
  });
});
