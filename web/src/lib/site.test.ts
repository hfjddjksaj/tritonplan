import { describe, expect, it } from 'vitest';
import { OLD_SITE_ORIGIN, OLD_SITE_URL, SITE_ORIGIN } from './site';

describe('site origins', () => {
  it('default to the production sites when the build sets nothing', () => {
    expect(SITE_ORIGIN).toBe('https://tritonplan.cn');
    expect(OLD_SITE_ORIGIN).toBe('https://hfjddjksaj.github.io');
    expect(OLD_SITE_URL).toBe('https://hfjddjksaj.github.io/tritonplan/');
  });
});
