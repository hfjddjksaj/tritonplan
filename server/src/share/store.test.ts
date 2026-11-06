import { expect, test } from 'vitest';
import { SHARED_PLAN_TTL_MS, type PlanState } from '@triton/shared';
import { createUser } from '../auth/users';
import { testDeps } from '../test-helpers';
import {
  createShared, listShared, MAX_LIVE_SHARED_PER_USER, newShareCode, readShared, selectInShared,
  sharedVersion, sweepExpiredShared,
} from './store';

const now = new Date('2026-01-15T12:00:00.000Z');
const at = (ms: number) => new Date(now.getTime() + ms);
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TERM = { year: '2026', period: '010', label: 'Winter 2026' };
const plan: PlanState = {
  version: 1,
  term: TERM,
  entries: [{
    course: { id: 'c1', options: [{ id: 'o1' }, { id: 'o2' }] } as never,
    selectedOptionId: 'o1',
  }],
};
const planJson = JSON.stringify(plan);

function setup() {
  const deps = testDeps();
  const user = (email: string) => createUser(deps.db, { email, verified: true, passwordHash: null, googleSub: null }, now);
  return { db: deps.db, user };
}

test('newShareCode is 10 base62 chars and not biased toward low symbols', () => {
  const N = 100_000;
  const freq = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const code = newShareCode();
    expect(code).toMatch(/^[0-9A-Za-z]{10}$/);
    for (const ch of code) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  const expected = (N * 10) / 62;
  for (const ch of ALPHABET) {
    const f = freq.get(ch) ?? 0;
    expect(f, `symbol ${ch}`).toBeGreaterThan(expected * 0.85);
    expect(f, `symbol ${ch}`).toBeLessThan(expected * 1.15);
  }
});

test('create then read round-trips with version 1 and a 7-day expiry', () => {
  const { db, user } = setup();
  const u = user('a@ucsd.edu');
  const made = createShared(db, u.id, 'My plan', '2026|010', planJson, now)!;
  expect(made.expiresAt).toBe(at(SHARED_PLAN_TTL_MS).toISOString());
  expect(readShared(db, made.code, now)).toEqual({ name: 'My plan', plan, version: 1, expiresAt: made.expiresAt });
  expect(sharedVersion(db, made.code, now)).toBe(1);
  expect(listShared(db, u.id, now)).toEqual([
    { code: made.code, name: 'My plan', termKey: '2026|010', createdAt: now.toISOString(), expiresAt: made.expiresAt },
  ]);
});

test('read and version are gone at the exact expiry instant', () => {
  const { db, user } = setup();
  const made = createShared(db, user('a@ucsd.edu').id, 'p', 'k', planJson, now)!;
  const justBefore = at(SHARED_PLAN_TTL_MS - 1);
  const expiry = at(SHARED_PLAN_TTL_MS);
  expect(readShared(db, made.code, justBefore)).not.toBeNull();
  expect(readShared(db, made.code, expiry)).toBeNull();
  expect(sharedVersion(db, made.code, justBefore)).toBe(1);
  expect(sharedVersion(db, made.code, expiry)).toBeNull();
  expect(selectInShared(db, made.code, 'c1', 'o2', expiry)).toBe('not-found');
});

test('list omits expired and other owners, newest first', () => {
  const { db, user } = setup();
  const u = user('a@ucsd.edu');
  const o = user('o@ucsd.edu');
  const old = createShared(db, u.id, 'old', 'k', planJson, at(-1000))!;
  const fresh = createShared(db, u.id, 'new', 'k', planJson, now)!;
  createShared(db, u.id, 'gone', 'k', planJson, at(-SHARED_PLAN_TTL_MS - 1))!;
  createShared(db, o.id, 'theirs', 'k', planJson, now)!;
  expect(listShared(db, u.id, now).map((s) => s.code)).toEqual([fresh.code, old.code]);
});

test('the 51st live share is refused, and expired ones do not count', () => {
  const { db, user } = setup();
  const u = user('a@ucsd.edu');
  createShared(db, u.id, 'expired', 'k', planJson, at(-SHARED_PLAN_TTL_MS - 1))!;
  for (let i = 0; i < MAX_LIVE_SHARED_PER_USER; i++) expect(createShared(db, u.id, `s${i}`, 'k', planJson, now)).not.toBeNull();
  expect(createShared(db, u.id, 'one too many', 'k', planJson, now)).toBeNull();
  expect(createShared(db, user('o@ucsd.edu').id, 'other user', 'k', planJson, now)).not.toBeNull();
});

test('create redraws on a code collision and gives up after 5 tries', () => {
  const { db, user } = setup();
  const u = user('a@ucsd.edu');
  expect(createShared(db, u.id, 'one', 'k', planJson, now, () => 'AAAAAAAAAA')!.code).toBe('AAAAAAAAAA');
  const codes = ['AAAAAAAAAA', 'AAAAAAAAAA', 'BBBBBBBBBB'];
  expect(createShared(db, u.id, 'two', 'k', planJson, now, () => codes.shift()!)!.code).toBe('BBBBBBBBBB');
  let calls = 0;
  expect(() => createShared(db, u.id, 'three', 'k', planJson, now, () => (calls++, 'AAAAAAAAAA'))).toThrow();
  expect(calls).toBe(5);
});

test('selectInShared bumps the version and persists; invalid leaves it alone', () => {
  const { db, user } = setup();
  const { code, expiresAt } = createShared(db, user('a@ucsd.edu').id, 'p', 'k', planJson, now)!;
  expect(selectInShared(db, code, 'c1', 'o2', now)).toEqual({ version: 2 });
  const read = readShared(db, code, now)!;
  expect(read.version).toBe(2);
  expect(read.plan.entries[0]!.selectedOptionId).toBe('o2');
  expect(read.expiresAt).toBe(expiresAt);
  expect(selectInShared(db, code, 'c1', 'nope', now)).toBe('invalid');
  expect(selectInShared(db, code, 'nope', 'o1', now)).toBe('invalid');
  expect(sharedVersion(db, code, now)).toBe(2);
  expect(selectInShared(db, 'missing000', 'c1', 'o1', now)).toBe('not-found');
});

test('sweep deletes only expired rows', () => {
  const { db, user } = setup();
  const u = user('a@ucsd.edu');
  const live = createShared(db, u.id, 'live', 'k', planJson, now)!;
  createShared(db, u.id, 'dead', 'k', planJson, at(-SHARED_PLAN_TTL_MS - 1))!;
  expect(sweepExpiredShared(db, now)).toBe(1);
  expect(readShared(db, live.code, now)).not.toBeNull();
  expect(sweepExpiredShared(db, now)).toBe(0);
});

test('deleting the user cascades; the old shares table is gone', () => {
  const { db, user } = setup();
  const u = user('a@ucsd.edu');
  const { code } = createShared(db, u.id, 'p', 'k', planJson, now)!;
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  expect(readShared(db, code, now)).toBeNull();
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='shares'").all()).toEqual([]);
});
