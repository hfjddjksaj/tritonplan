import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Term } from '@triton/shared';
import type { NamedPlan } from '../plans';
import type { TermsState } from '../terms-state';
import {
  clearPendingShare,
  consumeSaves,
  dropPendingHash,
  forgetSaves,
  makeBoot,
  peekPendingSave,
  peekPendingShare,
  pendingSaves,
  PENDING_HASH_KEY,
  PENDING_SAVE_KEY,
  PENDING_SHARE_KEY,
  restorePendingHash,
  stashPendingHash,
  stashPendingSave,
  stashPendingShare,
} from './boot';
import { splitTerms, type WebSnapshot } from './records';

const FA: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const np = (id: string): NamedPlan =>
  ({ id, name: id, plan: { version: 1, term: FA, entries: [] }, createdAt: 'c', updatedAt: 'u', browsed: [] });
const state = (name = 'a'): TermsState => ({
  version: 1, activeTermKey: '2026|2',
  terms: { '2026|2': { term: FA, plans: { activeId: 'a', plans: [{ ...np('a'), name }] } } },
});
function snap(s: TermsState | null): WebSnapshot {
  if (!s) return { terms: {}, plans: {}, pool: [], appt: null };
  const { terms, plans } = splitTerms(s);
  return {
    terms: Object.fromEntries(Object.entries(terms).map(([k, data]) => [k, { version: 3, data }])),
    plans: Object.fromEntries(Object.entries(plans).map(([id, p]) => [id, { version: 4, termKey: p.termKey, data: p.plan }])),
    pool: [{ id: 'c1' } as never],
    appt: [{ academicYear: '2026' } as never],
  };
}
const me = { email: 'a@b.c', hasPassword: true, hasGoogle: false };

describe('makeBoot', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('assembles the snapshot into the planner state', () => {
    const boot = makeBoot(me, snap(state()));
    expect(boot.me).toBe(me);
    expect(boot.terms).toEqual(state());
    expect(boot.pool).toEqual([{ id: 'c1' }]);
    expect(boot.appt).toEqual([{ academicYear: '2026' }]);
    boot.engine.dispose();
  });

  it('an empty account has no terms', () => {
    const boot = makeBoot(me, snap(null));
    expect(boot.terms).toBeNull();
    expect(boot.appt).toBeNull();
    boot.engine.dispose();
  });

  it('the engine saves through POST /api/sync', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, versions: { terms: {}, plans: { a: 9 } } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const boot = makeBoot(me, snap(state()));
    boot.engine.setTerms(state('renamed'));
    await boot.engine.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sync');
    expect(JSON.parse(init!.body as string).ops[0]).toMatchObject({ op: 'putPlan', planId: 'a', baseVersion: 4 });
    boot.engine.dispose();
  });
});

describe('pending hash', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it('stashes only a hash that carries a plan', () => {
    stashPendingHash('#foo=1');
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBeNull();
    stashPendingHash('');
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBeNull();
    stashPendingHash('#m=xyz');
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBe('#m=xyz');
    stashPendingHash('#p=abc');
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBe('#p=abc');
  });

  it('restore puts the stashed hash back into the address bar without a hashchange, then forgets it', () => {
    window.history.replaceState(null, '', '/?x=1');
    sessionStorage.setItem(PENDING_HASH_KEY, '#p=abc');
    const onHash = vi.fn();
    window.addEventListener('hashchange', onHash);
    restorePendingHash();
    window.removeEventListener('hashchange', onHash);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/?x=1#p=abc');
    expect(onHash).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBeNull();
  });

  it('a plan link already in the address bar wins over a stale stash', () => {
    window.history.replaceState(null, '', '/#p=newer');
    sessionStorage.setItem(PENDING_HASH_KEY, '#p=older');
    restorePendingHash();
    expect(window.location.hash).toBe('#p=newer');
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBeNull();
  });

  it('blocked storage is not an error', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => stashPendingHash('#p=abc')).not.toThrow();
    expect(() => restorePendingHash()).not.toThrow();
    expect(() => dropPendingHash()).not.toThrow();
  });

  it('drop forgets the stash without touching the address bar', () => {
    window.history.replaceState(null, '', '/');
    sessionStorage.setItem(PENDING_HASH_KEY, '#p=abc');
    dropPendingHash();
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBeNull();
    expect(window.location.hash).toBe('');
  });
});

describe('pending short link', () => {
  const HOUR = 3_600_000;
  const T0 = Date.parse('2026-10-26T12:00:00.000Z');
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('is kept in localStorage as {code, at}, so a verify mail opened in another tab still finds it', () => {
    stashPendingShare('AbCdEfGh12', new Date(T0));
    expect(JSON.parse(localStorage.getItem(PENDING_SHARE_KEY)!)).toEqual({ code: 'AbCdEfGh12', at: '2026-10-26T12:00:00.000Z' });
  });

  it('stays, with its first time, until it is cleared: a failed fetch leaves it for the next load', () => {
    stashPendingShare('AbCdEfGh12', new Date(T0));
    expect(peekPendingShare(T0 + HOUR)).toBe('AbCdEfGh12');
    expect(peekPendingShare(T0 + 2 * HOUR)).toBe('AbCdEfGh12');
    expect(JSON.parse(localStorage.getItem(PENDING_SHARE_KEY)!).at).toBe('2026-10-26T12:00:00.000Z');
    clearPendingShare();
    expect(localStorage.getItem(PENDING_SHARE_KEY)).toBeNull();
    expect(peekPendingShare(T0 + 2 * HOUR)).toBeNull();
  });

  it('older than 24 h is ignored, and dropped', () => {
    stashPendingShare('AbCdEfGh12', new Date(T0));
    expect(peekPendingShare(T0 + 24 * HOUR)).toBe('AbCdEfGh12');
    expect(peekPendingShare(T0 + 24 * HOUR + 1)).toBeNull();
    expect(localStorage.getItem(PENDING_SHARE_KEY)).toBeNull();
  });

  it.each(['not json', '{"code":7,"at":"2026-10-26T12:00:00.000Z"}', '{"code":"AbCdEfGh12","at":"yesterday"}', 'null'])(
    'a damaged entry %j is dropped',
    (raw) => {
      localStorage.setItem(PENDING_SHARE_KEY, raw);
      expect(peekPendingShare(T0)).toBeNull();
      expect(localStorage.getItem(PENDING_SHARE_KEY)).toBeNull();
    },
  );

  it('blocked storage is not an error', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => stashPendingShare('AbCdEfGh12')).not.toThrow();
    expect(peekPendingShare()).toBeNull();
    expect(() => clearPendingShare()).not.toThrow();
  });
});

describe('pending Saves', () => {
  const HOUR = 3_600_000;
  const T0 = Date.parse('2026-10-26T12:00:00.000Z');
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("this tab's Save, short link or #p=, is kept in sessionStorage with its time and lasts a day", () => {
    stashPendingSave({ hash: '#p=abc' }, new Date(T0));
    expect(JSON.parse(sessionStorage.getItem(PENDING_SAVE_KEY)!)).toEqual({ hash: '#p=abc', at: '2026-10-26T12:00:00.000Z' });
    expect(peekPendingSave(T0 + 24 * HOUR)).toEqual({ hash: '#p=abc' });
    expect(peekPendingSave(T0 + 24 * HOUR + 1)).toBeNull();
    expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
  });

  it.each(['not json', '{"at":"2026-10-26T12:00:00.000Z"}', '{"code":"AbCdEfGh12","at":"yesterday"}', 'null'])(
    'a damaged entry %j is dropped',
    (raw) => {
      sessionStorage.setItem(PENDING_SAVE_KEY, raw);
      expect(peekPendingSave(T0)).toBeNull();
      expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
    },
  );

  it("lists this tab's Save and another tab's short link, once each", () => {
    vi.useFakeTimers({ now: T0 });
    expect(pendingSaves()).toEqual([]);
    stashPendingSave({ code: 'AbCdEfGh12' });
    stashPendingShare('AbCdEfGh12');
    expect(pendingSaves()).toEqual([{ code: 'AbCdEfGh12' }]);
    stashPendingShare('ZyXwVuTs98'); // another tab saved a second link since
    expect(pendingSaves()).toEqual([{ code: 'AbCdEfGh12' }, { code: 'ZyXwVuTs98' }]);
  });

  it('consuming the honored Saves leaves one stashed meanwhile', () => {
    vi.useFakeTimers({ now: T0 });
    stashPendingSave({ hash: '#p=abc' });
    stashPendingShare('ZyXwVuTs98');
    consumeSaves([{ hash: '#p=abc' }]);
    expect(peekPendingSave()).toBeNull();
    expect(peekPendingShare()).toBe('ZyXwVuTs98');
  });

  it('a turned-off link takes only its own Saves with it', () => {
    vi.useFakeTimers({ now: T0 });
    stashPendingSave({ code: 'AbCdEfGh12' });
    stashPendingShare('ZyXwVuTs98');
    forgetSaves('AbCdEfGh12');
    expect(peekPendingSave()).toBeNull();
    expect(peekPendingShare()).toBe('ZyXwVuTs98');
    forgetSaves('ZyXwVuTs98');
    expect(peekPendingShare()).toBeNull();
  });
});
