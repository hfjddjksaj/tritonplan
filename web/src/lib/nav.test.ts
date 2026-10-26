import { afterEach, describe, expect, it } from 'vitest';
import { nav } from './nav';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('nav', () => {
  it('assign navigates the page (a hash-only URL is the one navigation jsdom performs)', () => {
    nav.assign('/#nav-test');
    expect(window.location.hash).toBe('#nav-test');
  });
});
