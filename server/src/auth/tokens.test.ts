import { expect, test } from 'vitest';
import { newId, randomToken, sha256Hex } from './tokens';

test('randomToken is 32 random bytes as base64url', () => {
  const t = randomToken();
  expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(Buffer.from(t, 'base64url')).toHaveLength(32);
  expect(randomToken()).not.toBe(t);
});

test('sha256Hex matches the known vector', () => {
  expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('newId is a uuid', () => {
  expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
