import { expect, test } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from './passwords';

test('password round trip and rejection', async () => {
  const h = await hashPassword('correct horse');
  expect(h.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  expect(await verifyPassword('correct horse', h)).toBe(true);
  expect(await verifyPassword('wrong', h)).toBe(false);
  expect(await verifyPassword('x', 'garbage')).toBe(false);
});

test('each hash gets a fresh salt', async () => {
  expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
});

test('malformed PHC strings return false instead of throwing', async () => {
  for (const bad of ['', '$argon2id$', '$argon2id$v=19$m=19456,t=2,p=1$onlysalt', '$argon2i$v=19$m=19456,t=2,p=1$AAAA$AAAA', '$argon2id$v=19$m=x,t=2,p=1$AAAA$AAAA']) {
    expect(await verifyPassword('pw', bad)).toBe(false);
  }
});

test('passwordProblem enforces 8..200', () => {
  expect(passwordProblem('1234567')).toBe('too-short');
  expect(passwordProblem('12345678')).toBeNull();
  expect(passwordProblem('a'.repeat(200))).toBeNull();
  expect(passwordProblem('a'.repeat(201))).toBe('too-long');
});
