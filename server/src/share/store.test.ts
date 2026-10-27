import { expect, test } from 'vitest';
import { createUser } from '../auth/users';
import { testDeps } from '../test-helpers';
import { createShare, deleteShare, getShare, listShares, MAX_SHARES_PER_USER, newShareCode } from './store';

const now = new Date('2026-01-15T12:00:00.000Z');
const T = now.toISOString();
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

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

test('createShare redraws on a code collision and gives up after 5 tries', () => {
  const { db, user } = setup();
  const u = user('a@ucsd.edu');
  const first = createShare(db, u.id, 'one', '{}', T, () => 'AAAAAAAAAA');
  expect(first).toBe('AAAAAAAAAA');
  const codes = ['AAAAAAAAAA', 'AAAAAAAAAA', 'BBBBBBBBBB'];
  expect(createShare(db, u.id, 'two', '{}', T, () => codes.shift()!)).toBe('BBBBBBBBBB');
  expect(codes).toEqual([]);
  let calls = 0;
  expect(() => createShare(db, u.id, 'three', '{}', T, () => (calls++, 'AAAAAAAAAA'))).toThrow();
  expect(calls).toBe(5);
  expect(listShares(db, u.id)).toHaveLength(2);
});

test('createShare stops at 500 live shares per user, and revoking frees a slot', () => {
  const { db, user } = setup();
  const u = user('a@ucsd.edu');
  const o = user('o@ucsd.edu');
  for (let i = 0; i < MAX_SHARES_PER_USER; i++) expect(createShare(db, u.id, `s${i}`, '{}', T)).toBeTruthy();
  expect(createShare(db, u.id, 'one too many', '{}', T)).toBeNull();
  expect(createShare(db, o.id, 'other user is unaffected', '{}', T)).toBeTruthy();
  deleteShare(db, u.id, listShares(db, u.id)[0]!.code);
  expect(createShare(db, u.id, 'fits again', '{}', T)).toBeTruthy();
});

test('list is newest first; delete and read are by code, delete only for the owner', () => {
  const { db, user } = setup();
  const u = user('a@ucsd.edu');
  const o = user('o@ucsd.edu');
  const a = createShare(db, u.id, 'old', '{"version":1}', '2026-01-01T00:00:00.000Z')!;
  const b = createShare(db, u.id, 'new', '{"version":1}', '2026-01-02T00:00:00.000Z')!;
  expect(listShares(db, u.id).map((s) => s.code)).toEqual([b, a]);
  expect(listShares(db, o.id)).toEqual([]);
  expect(deleteShare(db, o.id, a)).toBe(false);
  expect(getShare(db, a)).toEqual({ name: 'old', plan: { version: 1 }, createdAt: '2026-01-01T00:00:00.000Z' });
  expect(deleteShare(db, u.id, a)).toBe(true);
  expect(getShare(db, a)).toBeNull();
});
