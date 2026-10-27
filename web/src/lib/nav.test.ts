import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBfcacheReload, nav } from './nav';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('nav', () => {
  it('assign navigates the page (a hash-only URL is the one navigation jsdom performs)', () => {
    nav.assign('/#nav-test');
    expect(window.location.hash).toBe('#nav-test');
  });
});

describe('installBfcacheReload', () => {
  const show = (persisted: boolean) => {
    const ev = new Event('pageshow') as Event & { persisted: boolean };
    ev.persisted = persisted;
    window.dispatchEvent(ev);
  };

  it('reloads a page restored from the back/forward cache, and only that', () => {
    const reload = vi.fn();
    const off = installBfcacheReload(reload);
    show(false); // an ordinary load
    expect(reload).not.toHaveBeenCalled();
    show(true); // Back after sign-out: the old planner must not reappear without asking the server
    expect(reload).toHaveBeenCalledTimes(1);
    off();
    show(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
